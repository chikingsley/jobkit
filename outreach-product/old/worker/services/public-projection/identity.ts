import { z } from "zod";
import {
  materialCloneSignal,
  type PublicIdentitySignal,
  sourceReferenceSignal,
} from "../../../src/features/public/identity-signals";
import {
  SourcePositionIdentityError,
  sourcePositionIdentities,
} from "../../../src/features/public/source-position-identity";
import {
  EXACT_PROJECTION_ANALYSIS_GUARD_SQL,
  exactProjectionAnalysisGuardBindings,
} from "./analysis-guard";
import { canonicalSha256 } from "./hash";
import { projectionRunCounterStatement } from "./listing-items";
import {
  ProjectionListingSnapshotError,
  readExactProjectionListingSnapshot,
} from "./listing-snapshot";
import {
  assertClaimedPositionUpdate,
  assertPositionClaimLease,
  type ClaimedProjectionPosition,
  claimedPositionUpdateStatement,
} from "./position-items";
import { readProjectionAnalysisPrerequisites } from "./prerequisites";

const SealedPositionCheckpointSchema = z
  .object({
    analysisHashes: z
      .object({
        content: z.string().length(64),
        matchFacts: z.string().length(64),
        position: z.string().length(64),
      })
      .strict(),
    listingInputHash: z.string().length(64),
    materialHash: z.string().length(64),
    materialVersion: z.number().int().positive(),
    positionPayloadHash: z.string().length(64),
    sourceOrdinal: z.number().int().nonnegative(),
    sourcePositionId: z.string().min(1),
    state: z.literal("sealed"),
  })
  .passthrough();

const ExpandedListingCheckpointSchema = z
  .object({
    sourcePositions: z.object({
      identities: z.array(
        z.object({
          id: z.string().min(1),
          inputHash: z.string().length(64),
          positionKey: z.string().min(1),
          positionKind: z.enum(["direct", "extracted"]),
          positionPayloadHash: z.string().length(64),
          sourceOrdinal: z.number().int().nonnegative(),
        })
      ),
      state: z.literal("expanded"),
    }),
  })
  .passthrough();

interface PositionContextRow {
  listing_checkpoint_json: string;
  listing_id: string;
  listing_input_hash: string;
  listing_material_version: number;
  listing_stage: string;
  listing_status: string;
  position_key: string;
  position_kind: "direct" | "extracted";
  source_key: string;
  source_listing_id: string;
}

class ProjectionPositionIdentityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ProjectionPositionIdentityError";
  }
}

export async function processProjectionIdentityClaim(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  timestamp: string
) {
  const rawCheckpoint = parseJsonObject(claim.checkpointJson);
  const sealed = SealedPositionCheckpointSchema.safeParse(rawCheckpoint);
  if (!sealed.success) {
    return blockIdentityClaim(
      db,
      claim,
      timestamp,
      "identity_checkpoint_invalid",
      "The sealed position checkpoint is invalid",
      rawCheckpoint
    );
  }

  try {
    const derived = await deriveIdentityCheckpoint(db, claim, sealed.data);
    await assertPositionClaimLease(db, claim);
    const identityGuardToken = crypto.randomUUID();
    const results = await db.batch([
      identityGuardStatement(
        db,
        claim,
        derived.context,
        derived.snapshot,
        derived.analysisGuard,
        identityGuardToken
      ),
      claimedPositionUpdateStatement(db, claim, {
        checkpoint: {
          ...sealed.data,
          identity: derived.identity,
        },
        checkpointGuardPath: "$.identityGuard",
        checkpointGuardToken: identityGuardToken,
        stage: "canonical_resolution",
        status: "queued",
      }),
      projectionRunCounterStatement(db, claim.runId, timestamp),
    ]);
    if (
      (results[0]?.meta.changes ?? 0) !== 1 ||
      (results[1]?.meta.changes ?? 0) !== 1
    ) {
      await assertPositionClaimLease(db, claim);
      throw new ProjectionPositionIdentityError(
        "identity_input_snapshot_changed",
        "The sealed identity inputs changed during finalization"
      );
    }
    return { blocked: 0, identified: 1 };
  } catch (error) {
    if (error instanceof ProjectionPositionIdentityError) {
      return blockIdentityClaim(
        db,
        claim,
        timestamp,
        error.code,
        error.message,
        rawCheckpoint
      );
    }
    if (error instanceof ProjectionListingSnapshotError) {
      return blockIdentityClaim(
        db,
        claim,
        timestamp,
        error.code,
        error.message,
        rawCheckpoint
      );
    }
    if (error instanceof SourcePositionIdentityError) {
      return blockIdentityClaim(
        db,
        claim,
        timestamp,
        error.code,
        error.message,
        rawCheckpoint
      );
    }
    throw error;
  }
}

async function deriveIdentityCheckpoint(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  sealed: z.infer<typeof SealedPositionCheckpointSchema>
) {
  const [context, snapshot] = await Promise.all([
    readPositionContext(db, claim),
    readExactProjectionListingSnapshot(db, claim.listingItemId),
  ]);
  const listingCheckpoint = ExpandedListingCheckpointSchema.safeParse(
    parseJson(context.listing_checkpoint_json)
  );
  if (!listingCheckpoint.success) {
    throw new ProjectionPositionIdentityError(
      "identity_listing_checkpoint_invalid",
      "The source-position expansion checkpoint is invalid"
    );
  }
  const prerequisites = await readProjectionAnalysisPrerequisites(db, snapshot);
  if (!(prerequisites.ready && prerequisites.position && prerequisites.guard)) {
    throw new ProjectionPositionIdentityError(
      "identity_analysis_snapshot_changed",
      "The exact analysis snapshot is no longer ready"
    );
  }
  const currentAnalysisHashes = {
    content: prerequisites.checkpoint.content.payloadHash,
    matchFacts: prerequisites.checkpoint.matchFacts.payloadHash,
    position: prerequisites.checkpoint.position.payloadHash,
  };
  if (
    currentAnalysisHashes.content !== sealed.analysisHashes.content ||
    currentAnalysisHashes.matchFacts !== sealed.analysisHashes.matchFacts ||
    currentAnalysisHashes.position !== sealed.analysisHashes.position ||
    snapshot.inputHash !== sealed.listingInputHash ||
    snapshot.materialHash !== sealed.materialHash ||
    snapshot.materialVersion !== sealed.materialVersion ||
    context.listing_id !== snapshot.listingId ||
    context.listing_input_hash !== snapshot.inputHash ||
    context.listing_material_version !== snapshot.materialVersion ||
    context.listing_stage !== "completed" ||
    context.listing_status !== "completed"
  ) {
    throw new ProjectionPositionIdentityError(
      "identity_input_snapshot_changed",
      "The sealed identity inputs no longer match their exact snapshots"
    );
  }

  const identities = await sourcePositionIdentities(
    snapshot.listingId,
    prerequisites.position
  );
  const identity = identities[sealed.sourceOrdinal];
  const position = prerequisites.position.positions[sealed.sourceOrdinal];
  if (!(identity && position)) {
    throw new ProjectionPositionIdentityError(
      "identity_source_ordinal_invalid",
      "The sealed source ordinal is outside the exact position analysis"
    );
  }
  const positionPayloadHash = await canonicalSha256(position);
  const expectedInputHash = await canonicalSha256({
    analysisHashes: sealed.analysisHashes,
    contractVersion: 1,
    listingInputHash: sealed.listingInputHash,
    materialHash: snapshot.materialHash,
    materialVersion: snapshot.materialVersion,
    positionPayloadHash,
    sourcePosition: identity,
  });
  const expandedIdentity =
    listingCheckpoint.data.sourcePositions.identities.find(
      (candidate) => candidate.id === claim.sourcePositionId
    );
  if (
    claim.sourcePositionId !== sealed.sourcePositionId ||
    identity.id !== claim.sourcePositionId ||
    positionPayloadHash !== sealed.positionPayloadHash ||
    expectedInputHash !== claim.inputHash ||
    context.source_listing_id !== snapshot.listingId ||
    context.source_key !== snapshot.board ||
    context.position_key !== identity.positionKey ||
    context.position_kind !== identity.positionKind ||
    !expandedIdentity ||
    expandedIdentity.inputHash !== claim.inputHash ||
    expandedIdentity.positionKey !== identity.positionKey ||
    expandedIdentity.positionKind !== identity.positionKind ||
    expandedIdentity.positionPayloadHash !== positionPayloadHash ||
    expandedIdentity.sourceOrdinal !== sealed.sourceOrdinal
  ) {
    throw new ProjectionPositionIdentityError(
      "identity_seal_mismatch",
      "The sealed position identity does not match its source evidence"
    );
  }

  const signals: PublicIdentitySignal[] = [
    await materialCloneSignal(snapshot.materialHash),
  ];
  if (snapshot.material.sourceReference.trim()) {
    signals.push(
      await sourceReferenceSignal({
        sourceKey: snapshot.board,
        sourceReference: snapshot.material.sourceReference,
      })
    );
  }
  signals.sort((left, right) => left.kind.localeCompare(right.kind, "en"));
  return {
    analysisGuard: prerequisites.guard,
    context,
    identity: {
      contractVersion: 1,
      signals,
      sourcePosition: {
        id: identity.id,
        positionKey: identity.positionKey,
        positionKind: identity.positionKind,
        sourceOrdinal: identity.sourceOrdinal,
      },
      state: "derived",
    },
    snapshot,
  };
}

async function readPositionContext(
  db: D1Database,
  claim: ClaimedProjectionPosition
) {
  const row = await db
    .prepare(
      `SELECT listing_item.listing_id,
              listing_item.input_hash listing_input_hash,
              listing_item.material_version listing_material_version,
              listing_item.stage listing_stage,
              listing_item.status listing_status,
              listing_item.checkpoint_json listing_checkpoint_json,
              source_position.listing_id source_listing_id,
              source_position.source_key,source_position.position_key,
              source_position.position_kind
         FROM public_projection_position_items item
         JOIN public_projection_listing_items listing_item
           ON listing_item.id=item.listing_item_id
          AND listing_item.run_id=item.run_id
         JOIN job_source_positions source_position
           ON source_position.id=item.source_position_id
        WHERE item.id=? AND item.run_id=?
          AND item.listing_item_id=? AND item.source_position_id=?
        LIMIT 1`
    )
    .bind(claim.id, claim.runId, claim.listingItemId, claim.sourcePositionId)
    .first<PositionContextRow>();
  if (!row) {
    throw new ProjectionPositionIdentityError(
      "identity_context_missing",
      "The sealed position context is unavailable"
    );
  }
  return row;
}

function identityGuardStatement(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  context: PositionContextRow,
  snapshot: Awaited<ReturnType<typeof readExactProjectionListingSnapshot>>,
  analysisGuard: NonNullable<
    Awaited<ReturnType<typeof readProjectionAnalysisPrerequisites>>["guard"]
  >,
  identityGuardToken: string
) {
  return db
    .prepare(
      `UPDATE public_projection_position_items
          SET checkpoint_json=json_set(
            checkpoint_json,'$.identityGuard',?
          )
        WHERE id=? AND run_id=? AND status='processing'
          AND stage='identity'
          AND lease_owner=? AND lease_token=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND input_hash=? AND listing_item_id=? AND source_position_id=?
          AND checkpoint_json=?
          AND EXISTS (
              SELECT 1 FROM public_projection_listing_items listing_item
               WHERE listing_item.id=? AND listing_item.run_id=?
                 AND listing_item.listing_id=?
                 AND listing_item.material_version=?
                 AND listing_item.input_hash=?
                 AND listing_item.stage='completed'
                 AND listing_item.status='completed'
                 AND listing_item.checkpoint_json=?
            )
          AND EXISTS (
              SELECT 1 FROM job_source_positions source_position
               WHERE source_position.id=? AND source_position.listing_id=?
                 AND source_position.source_key=?
                 AND source_position.position_key=?
                 AND source_position.position_kind=?
            )
          ${EXACT_PROJECTION_ANALYSIS_GUARD_SQL}`
    )
    .bind(
      identityGuardToken,
      claim.id,
      claim.runId,
      claim.leaseOwner,
      claim.leaseToken,
      claim.inputHash,
      claim.listingItemId,
      claim.sourcePositionId,
      claim.checkpointJson,
      claim.listingItemId,
      claim.runId,
      context.listing_id,
      context.listing_material_version,
      context.listing_input_hash,
      context.listing_checkpoint_json,
      claim.sourcePositionId,
      context.source_listing_id,
      context.source_key,
      context.position_key,
      context.position_kind,
      ...exactProjectionAnalysisGuardBindings(snapshot, analysisGuard)
    );
}

async function blockIdentityClaim(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  timestamp: string,
  errorCode: string,
  errorDetail: string,
  checkpoint: Record<string, unknown>
) {
  const results = await db.batch([
    claimedPositionUpdateStatement(db, claim, {
      checkpoint: {
        ...checkpoint,
        error: { code: errorCode, detail: errorDetail },
        identity: { state: "blocked" },
      },
      errorCode,
      errorDetail,
      stage: "identity",
      status: "blocked",
    }),
    projectionRunCounterStatement(db, claim.runId, timestamp),
  ]);
  assertClaimedPositionUpdate(results[0], "identity block");
  return { blocked: 1, identified: 0 };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
