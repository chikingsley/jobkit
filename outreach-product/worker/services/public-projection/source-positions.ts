import { z } from "zod";
import {
  type SourcePositionIdentity,
  SourcePositionIdentityError,
  sourcePositionIdentities,
} from "../../../src/features/public/source-position-identity";
import {
  EXACT_PROJECTION_ANALYSIS_GUARD_SQL,
  exactProjectionAnalysisGuardBindings,
} from "./analysis-guard";
import { canonicalJson, canonicalSha256, sha256Hex } from "./hash";
import {
  assertClaimedUpdate,
  assertClaimLease,
  type ClaimedProjectionListing,
  claimedListingUpdateStatement,
  projectionRunCounterStatement,
} from "./listing-items";
import {
  type ExactProjectionListingSnapshot,
  ProjectionListingSnapshotError,
  readExactProjectionListingSnapshot,
} from "./listing-snapshot";
import {
  type ProjectionAnalysisGuard,
  readProjectionAnalysisPrerequisites,
} from "./prerequisites";

const SealedPrerequisiteCheckpointSchema = z
  .object({
    analyses: z
      .object({
        content: z
          .object({
            payloadHash: z.string().length(64),
            recordFingerprint: z.string().length(64),
          })
          .passthrough(),
        matchFacts: z
          .object({
            payloadHash: z.string().length(64),
            recordFingerprint: z.string().length(64),
          })
          .passthrough(),
        position: z
          .object({
            payloadHash: z.string().length(64),
            recordFingerprint: z.string().length(64),
          })
          .passthrough(),
      })
      .passthrough(),
    materialSnapshot: z
      .object({
        analysisSourceHash: z.string().length(64),
        board: z.string().min(1),
        inputHash: z.string().length(64),
        listingId: z.string().min(1),
        materialHash: z.string().length(64),
        materialHashVersion: z.literal(1),
        materialVersion: z.number().int().positive(),
        state: z.literal("validated"),
      })
      .passthrough(),
    prerequisiteState: z.literal("validated"),
  })
  .passthrough();

interface ListingCheckpointRow {
  checkpoint_json: string;
}

const SOURCE_POSITION_EXPANSION_PAGE_SIZE = 20;

interface SourcePositionExpansionProgress {
  inputDigest: string;
  nextOrdinal: number;
  state: "expanding";
  totalPositions: number;
}

export async function processProjectionSourcePositionClaim(
  db: D1Database,
  claim: ClaimedProjectionListing,
  timestamp: string
) {
  const previousCheckpoint = await readSealedCheckpoint(db, claim.id);
  let snapshot: ExactProjectionListingSnapshot;
  try {
    snapshot = await readExactProjectionListingSnapshot(db, claim.id);
  } catch (error) {
    if (error instanceof ProjectionListingSnapshotError) {
      return blockClaim(
        db,
        claim,
        timestamp,
        error.code,
        error.message,
        previousCheckpoint
      );
    }
    throw error;
  }
  const prerequisites = await readProjectionAnalysisPrerequisites(db, snapshot);
  if (prerequisites.terminalFailure) {
    return blockClaim(
      db,
      claim,
      timestamp,
      prerequisites.terminalFailure.code,
      prerequisites.terminalFailure.detail,
      {
        ...previousCheckpoint,
        observedAnalyses: prerequisites.checkpoint,
      }
    );
  }
  if (!prerequisites.ready) {
    const results = await db.batch([
      claimedListingUpdateStatement(db, claim, {
        checkpoint: {
          ...previousCheckpoint,
          sourcePositions: {
            observedAnalyses: prerequisites.checkpoint,
            observedMaterial: sealedMaterialCheckpoint(snapshot),
            state: "waiting_analysis",
          },
        },
        completedAt: null,
        stage: "source_positions",
        status: "waiting_analysis",
        timestamp,
      }),
      projectionRunCounterStatement(db, claim.runId, timestamp),
    ]);
    assertClaimedUpdate(results[0], "source-position prerequisite wait");
    return { blocked: 0, expanded: 0, waiting: 1 };
  }
  const analysisHashes = {
    content: prerequisites.checkpoint.content.payloadHash,
    matchFacts: prerequisites.checkpoint.matchFacts.payloadHash,
    position: prerequisites.checkpoint.position.payloadHash,
  };
  if (
    previousCheckpoint.materialSnapshot.analysisSourceHash !==
      snapshot.analysisSourceHash ||
    previousCheckpoint.materialSnapshot.board !== snapshot.board ||
    previousCheckpoint.materialSnapshot.inputHash !== snapshot.inputHash ||
    previousCheckpoint.materialSnapshot.listingId !== snapshot.listingId ||
    previousCheckpoint.materialSnapshot.materialHash !==
      snapshot.materialHash ||
    previousCheckpoint.materialSnapshot.materialVersion !==
      snapshot.materialVersion ||
    !analysisSealMatches(previousCheckpoint.analyses, prerequisites.checkpoint)
  ) {
    return blockClaim(
      db,
      claim,
      timestamp,
      "analysis_snapshot_changed",
      "The sealed material or analysis inputs changed before expansion",
      previousCheckpoint
    );
  }
  const { analysisGuard, positionAnalysis } =
    requireReadyPositionInputs(prerequisites);
  let identities: SourcePositionIdentity[];
  try {
    identities = await sourcePositionIdentities(
      snapshot.listingId,
      positionAnalysis
    );
  } catch (error) {
    if (error instanceof SourcePositionIdentityError) {
      return blockClaim(
        db,
        claim,
        timestamp,
        error.code,
        error.message,
        previousCheckpoint
      );
    }
    throw error;
  }
  const sealedPositions = await Promise.all(
    identities.map(async (identity) => {
      const position = positionAnalysis.positions[identity.sourceOrdinal];
      if (!position) {
        throw new Error(
          "Source-position ordinal is outside the sealed analysis"
        );
      }
      const positionPayloadHash = await canonicalSha256(position);
      const inputHash = await canonicalSha256({
        analysisHashes,
        contractVersion: 1,
        listingInputHash: claim.inputHash,
        materialHash: snapshot.materialHash,
        materialVersion: snapshot.materialVersion,
        positionPayloadHash,
        sourcePosition: identity,
      });
      return {
        identity,
        inputHash,
        itemId: `projection-position-v1_${await sha256Hex(
          `jobkit-projection-position/v1\0${claim.runId}\0${identity.id}`
        )}`,
        positionPayloadHash,
      };
    })
  );
  const sealedPositionsDigest = await canonicalSha256(
    sealedPositions.map((sealed) => ({
      id: sealed.identity.id,
      inputHash: sealed.inputHash,
      positionKey: sealed.identity.positionKey,
      positionKind: sealed.identity.positionKind,
      positionPayloadHash: sealed.positionPayloadHash,
      sourceOrdinal: sealed.identity.sourceOrdinal,
    }))
  );
  const expansionProgress = readExpansionProgress(previousCheckpoint);
  if (
    expansionProgressChanged(
      expansionProgress,
      sealedPositionsDigest,
      sealedPositions.length
    )
  ) {
    return blockClaim(
      db,
      claim,
      timestamp,
      "source_position_expansion_snapshot_changed",
      "The sealed source-position expansion changed between pages",
      previousCheckpoint
    );
  }
  const pageStart = expansionProgress ? expansionProgress.nextOrdinal : 0;
  const page = sealedPositions.slice(
    pageStart,
    pageStart + SOURCE_POSITION_EXPANSION_PAGE_SIZE
  );
  const nextOrdinal = pageStart + page.length;
  const expansionComplete = nextOrdinal === sealedPositions.length;
  await assertClaimLease(db, claim);
  const commitSnapshot = await readExactProjectionListingSnapshot(db, claim.id);
  const commitPrerequisites = await readProjectionAnalysisPrerequisites(
    db,
    commitSnapshot
  );
  if (
    !commitPrerequisites.ready ||
    commitSnapshot.inputHash !== snapshot.inputHash ||
    commitSnapshot.materialHash !== snapshot.materialHash ||
    commitSnapshot.materialVersion !== snapshot.materialVersion ||
    !analysisSealMatches(
      previousCheckpoint.analyses,
      commitPrerequisites.checkpoint
    )
  ) {
    return blockClaim(
      db,
      claim,
      timestamp,
      "analysis_snapshot_changed",
      "The sealed material or analysis provenance changed at commit",
      previousCheckpoint
    );
  }
  const expansionGuardToken = crypto.randomUUID();
  const sourceStatements = page.map(({ identity }) =>
    db
      .prepare(
        `INSERT INTO job_source_positions (
          id,listing_id,source_key,position_key,position_kind,created_at
        )
        SELECT ?,?,?,?,?,?
          FROM public_projection_listing_items item
         WHERE item.id=? AND item.run_id=? AND item.status='processing'
           AND item.lease_owner=? AND item.lease_token=?
           AND item.lease_expires_at>
                strftime('%Y-%m-%dT%H:%M:%fZ','now')
           AND json_extract(item.checkpoint_json,'$.expansionGuard')=?
        ON CONFLICT(id) DO UPDATE SET
          listing_id=excluded.listing_id,
          source_key=excluded.source_key,
          position_key=excluded.position_key,
          position_kind=excluded.position_kind
        WHERE job_source_positions.listing_id<>excluded.listing_id
           OR job_source_positions.source_key<>excluded.source_key
           OR job_source_positions.position_key<>excluded.position_key
           OR job_source_positions.position_kind<>excluded.position_kind`
      )
      .bind(
        identity.id,
        snapshot.listingId,
        snapshot.board,
        identity.positionKey,
        identity.positionKind,
        timestamp,
        claim.id,
        claim.runId,
        claim.leaseOwner,
        claim.leaseToken,
        expansionGuardToken
      )
  );
  const positionStatements = page.map((sealed) =>
    db
      .prepare(
        `INSERT INTO public_projection_position_items (
          id,run_id,listing_item_id,source_position_id,input_hash,stage,status,
          readiness_json,reason_codes_json,checkpoint_json,created_at,updated_at
        )
        SELECT ?,?,?,?,?,'identity','queued','{}','["shadow_mode"]',?,?,?
          FROM public_projection_listing_items item
         WHERE item.id=? AND item.run_id=? AND item.status='processing'
           AND item.lease_owner=? AND item.lease_token=?
           AND item.lease_expires_at>
                strftime('%Y-%m-%dT%H:%M:%fZ','now')
           AND json_extract(item.checkpoint_json,'$.expansionGuard')=?
        ON CONFLICT(id) DO UPDATE SET
          run_id=excluded.run_id,
          listing_item_id=excluded.listing_item_id,
          source_position_id=excluded.source_position_id,
          input_hash=excluded.input_hash
        WHERE public_projection_position_items.run_id<>excluded.run_id
           OR public_projection_position_items.listing_item_id<>
                excluded.listing_item_id
           OR public_projection_position_items.source_position_id<>
                excluded.source_position_id
           OR public_projection_position_items.input_hash<>excluded.input_hash`
      )
      .bind(
        sealed.itemId,
        claim.runId,
        claim.id,
        sealed.identity.id,
        sealed.inputHash,
        canonicalJson({
          analysisHashes,
          listingInputHash: claim.inputHash,
          materialHash: snapshot.materialHash,
          materialVersion: snapshot.materialVersion,
          positionPayloadHash: sealed.positionPayloadHash,
          sourceOrdinal: sealed.identity.sourceOrdinal,
          sourcePositionId: sealed.identity.id,
          state: "sealed",
        }),
        timestamp,
        timestamp,
        claim.id,
        claim.runId,
        claim.leaseOwner,
        claim.leaseToken,
        expansionGuardToken
      )
  );
  const nextCheckpoint = {
    ...previousCheckpoint,
    sourcePositions: expansionComplete
      ? {
          expandedAt: timestamp,
          identities: sealedPositions.map((sealed) => ({
            id: sealed.identity.id,
            inputHash: sealed.inputHash,
            positionKey: sealed.identity.positionKey,
            positionKind: sealed.identity.positionKind,
            positionPayloadHash: sealed.positionPayloadHash,
            sourceOrdinal: sealed.identity.sourceOrdinal,
          })),
          inputDigest: sealedPositionsDigest,
          state: "expanded",
        }
      : {
          inputDigest: sealedPositionsDigest,
          nextOrdinal,
          state: "expanding",
          totalPositions: sealedPositions.length,
        },
  };
  try {
    const results = await db.batch([
      analysisExpansionGuardStatement(
        db,
        claim,
        snapshot,
        analysisGuard,
        expansionGuardToken
      ),
      ...sourceStatements,
      ...positionStatements,
      claimedListingUpdateStatement(db, claim, {
        checkpoint: nextCheckpoint,
        checkpointGuardToken: expansionGuardToken,
        completedAt: expansionComplete ? timestamp : null,
        stage: expansionComplete ? "completed" : "source_positions",
        status: expansionComplete ? "completed" : "queued",
        timestamp,
      }),
      projectionRunCounterStatement(db, claim.runId, timestamp),
    ]);
    assertClaimedUpdate(results[0], "analysis expansion guard");
    assertClaimedUpdate(
      results[sourceStatements.length + positionStatements.length + 1],
      "source-position expansion"
    );
  } catch (error) {
    const failure = classifyExpansionFailure(error);
    return blockClaim(
      db,
      claim,
      timestamp,
      failure.code,
      failure.detail,
      previousCheckpoint
    );
  }
  return { blocked: 0, expanded: page.length, waiting: 0 };
}

function readExpansionProgress(
  checkpoint: Record<string, unknown>
): SourcePositionExpansionProgress | null {
  const { sourcePositions } = checkpoint;
  if (
    typeof sourcePositions !== "object" ||
    sourcePositions === null ||
    !("state" in sourcePositions) ||
    sourcePositions.state !== "expanding"
  ) {
    return null;
  }
  const candidate = sourcePositions as Record<string, unknown>;
  if (
    typeof candidate.inputDigest !== "string" ||
    candidate.inputDigest.length !== 64 ||
    !Number.isInteger(candidate.nextOrdinal) ||
    Number(candidate.nextOrdinal) < 0 ||
    !Number.isInteger(candidate.totalPositions) ||
    Number(candidate.totalPositions) < 1
  ) {
    throw new Error("Projection source-position progress is invalid");
  }
  return {
    inputDigest: candidate.inputDigest,
    nextOrdinal: Number(candidate.nextOrdinal),
    state: "expanding",
    totalPositions: Number(candidate.totalPositions),
  };
}

function requireReadyPositionInputs(
  prerequisites: Awaited<ReturnType<typeof readProjectionAnalysisPrerequisites>>
) {
  const { guard: analysisGuard, position: positionAnalysis } = prerequisites;
  if (!(positionAnalysis && analysisGuard)) {
    throw new Error("Ready projection prerequisites omitted sealed inputs");
  }
  return { analysisGuard, positionAnalysis };
}

function expansionProgressChanged(
  progress: SourcePositionExpansionProgress | null,
  inputDigest: string,
  totalPositions: number
) {
  return (
    progress !== null &&
    (progress.inputDigest !== inputDigest ||
      progress.totalPositions !== totalPositions ||
      progress.nextOrdinal > totalPositions)
  );
}

function analysisExpansionGuardStatement(
  db: D1Database,
  claim: ClaimedProjectionListing,
  snapshot: Awaited<ReturnType<typeof readExactProjectionListingSnapshot>>,
  guard: ProjectionAnalysisGuard,
  expansionGuardToken: string
) {
  return db
    .prepare(
      `UPDATE public_projection_listing_items
          SET checkpoint_json=json_set(
            checkpoint_json,'$.expansionGuard',?
          )
        WHERE id=? AND run_id=?
          AND status='processing'
          AND lease_owner=? AND lease_token=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND input_hash=?
          ${EXACT_PROJECTION_ANALYSIS_GUARD_SQL}`
    )
    .bind(
      expansionGuardToken,
      claim.id,
      claim.runId,
      claim.leaseOwner,
      claim.leaseToken,
      claim.inputHash,
      ...exactProjectionAnalysisGuardBindings(snapshot, guard)
    );
}

function classifyExpansionFailure(error: unknown) {
  const detail =
    error instanceof Error
      ? error.message
      : "Source-position persistence failed";
  if (detail.includes("analysis expansion guard")) {
    return { code: "analysis_snapshot_changed", detail };
  }
  if (
    detail.includes("source positions are immutable") ||
    detail.includes("job_source_positions") ||
    detail.includes("projection position input snapshot is immutable") ||
    detail.includes("public_projection_position_items")
  ) {
    return { code: "source_position_identity_conflict", detail };
  }
  return { code: "source_position_persistence_conflict", detail };
}

async function readSealedCheckpoint(db: D1Database, listingItemId: string) {
  const row = await db
    .prepare(
      `SELECT checkpoint_json FROM public_projection_listing_items
        WHERE id=? LIMIT 1`
    )
    .bind(listingItemId)
    .first<ListingCheckpointRow>();
  const parsed = SealedPrerequisiteCheckpointSchema.safeParse(
    row ? parseJson(row.checkpoint_json) : null
  );
  if (!parsed.success) {
    throw new Error("Projection prerequisite checkpoint is invalid");
  }
  return parsed.data;
}

async function blockClaim(
  db: D1Database,
  claim: ClaimedProjectionListing,
  timestamp: string,
  errorCode: string,
  errorDetail: string,
  checkpoint: Record<string, unknown>
) {
  const results = await db.batch([
    claimedListingUpdateStatement(db, claim, {
      checkpoint: {
        ...checkpoint,
        error: { code: errorCode, detail: errorDetail },
        sourcePositions: { state: "blocked" },
      },
      completedAt: timestamp,
      errorCode,
      errorDetail,
      stage: "source_positions",
      status: "blocked",
      timestamp,
    }),
    projectionRunCounterStatement(db, claim.runId, timestamp),
  ]);
  assertClaimedUpdate(results[0], "source-position block");
  return { blocked: 1, expanded: 0, waiting: 0 };
}

function analysisSealMatches(
  sealed: {
    content: { payloadHash: string; recordFingerprint: string };
    matchFacts: { payloadHash: string; recordFingerprint: string };
    position: { payloadHash: string; recordFingerprint: string };
  },
  current: {
    content: { payloadHash: string | null; recordFingerprint: string };
    matchFacts: { payloadHash: string | null; recordFingerprint: string };
    position: { payloadHash: string | null; recordFingerprint: string };
  }
) {
  return (
    sealed.content.payloadHash === current.content.payloadHash &&
    sealed.content.recordFingerprint === current.content.recordFingerprint &&
    sealed.matchFacts.payloadHash === current.matchFacts.payloadHash &&
    sealed.matchFacts.recordFingerprint ===
      current.matchFacts.recordFingerprint &&
    sealed.position.payloadHash === current.position.payloadHash &&
    sealed.position.recordFingerprint === current.position.recordFingerprint
  );
}

function sealedMaterialCheckpoint(
  snapshot: Awaited<ReturnType<typeof readExactProjectionListingSnapshot>>
) {
  return {
    analysisSourceHash: snapshot.analysisSourceHash,
    board: snapshot.board,
    inputHash: snapshot.inputHash,
    listingId: snapshot.listingId,
    materialHash: snapshot.materialHash,
    materialHashVersion: snapshot.materialHashVersion,
    materialVersion: snapshot.materialVersion,
    state: "validated",
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
