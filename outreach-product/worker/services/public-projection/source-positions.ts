import {
  SourcePositionIdentityError,
  sourcePositionIdentities,
} from "../../../src/features/public/source-position-identity";
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
import { readProjectionAnalysisPrerequisites } from "./prerequisites";
import { SOURCE_POSITION_EXPANSION_PAGE_SIZE } from "./source-positions/model";
import {
  analysisExpansionGuardStatement,
  analysisSealMatches,
  blockClaim,
  classifyExpansionFailure,
  expansionProgressChanged,
  readExpansionProgress,
  readSealedCheckpoint,
  requireReadyPositionInputs,
  sealedMaterialCheckpoint,
} from "./source-positions/support";

type ProjectionCheckpoint = Awaited<ReturnType<typeof readSealedCheckpoint>>;
type ProjectionPrerequisites = Awaited<
  ReturnType<typeof readProjectionAnalysisPrerequisites>
>;

function sealedAnalysisInputsMatch(
  checkpoint: ProjectionCheckpoint,
  snapshot: ExactProjectionListingSnapshot,
  prerequisites: ProjectionPrerequisites
) {
  return (
    checkpoint.materialSnapshot.analysisSourceHash ===
      snapshot.analysisSourceHash &&
    checkpoint.materialSnapshot.board === snapshot.board &&
    checkpoint.materialSnapshot.inputHash === snapshot.inputHash &&
    checkpoint.materialSnapshot.listingId === snapshot.listingId &&
    checkpoint.materialSnapshot.materialHash === snapshot.materialHash &&
    checkpoint.materialSnapshot.materialVersion === snapshot.materialVersion &&
    analysisSealMatches(checkpoint.analyses, prerequisites.checkpoint)
  );
}

function commitAnalysisInputsMatch(
  checkpoint: ProjectionCheckpoint,
  original: ExactProjectionListingSnapshot,
  current: ExactProjectionListingSnapshot,
  prerequisites: ProjectionPrerequisites
) {
  return (
    prerequisites.ready &&
    current.inputHash === original.inputHash &&
    current.materialHash === original.materialHash &&
    current.materialVersion === original.materialVersion &&
    analysisSealMatches(checkpoint.analyses, prerequisites.checkpoint)
  );
}

async function readClaimSnapshot(
  db: D1Database,
  claim: ClaimedProjectionListing,
  timestamp: string,
  checkpoint: ProjectionCheckpoint
) {
  try {
    return {
      kind: "snapshot" as const,
      snapshot: await readExactProjectionListingSnapshot(db, claim.id),
    };
  } catch (error) {
    if (error instanceof ProjectionListingSnapshotError) {
      return {
        kind: "blocked" as const,
        result: await blockClaim(
          db,
          claim,
          timestamp,
          error.code,
          error.message,
          checkpoint
        ),
      };
    }
    throw error;
  }
}

async function readClaimIdentities(
  db: D1Database,
  claim: ClaimedProjectionListing,
  timestamp: string,
  checkpoint: ProjectionCheckpoint,
  listingId: string,
  positionAnalysis: ReturnType<
    typeof requireReadyPositionInputs
  >["positionAnalysis"]
) {
  try {
    return {
      identities: await sourcePositionIdentities(listingId, positionAnalysis),
      kind: "identities" as const,
    };
  } catch (error) {
    if (error instanceof SourcePositionIdentityError) {
      return {
        kind: "blocked" as const,
        result: await blockClaim(
          db,
          claim,
          timestamp,
          error.code,
          error.message,
          checkpoint
        ),
      };
    }
    throw error;
  }
}

export async function processProjectionSourcePositionClaim(
  db: D1Database,
  claim: ClaimedProjectionListing,
  timestamp: string
) {
  const previousCheckpoint = await readSealedCheckpoint(db, claim.id);
  const snapshotRead = await readClaimSnapshot(
    db,
    claim,
    timestamp,
    previousCheckpoint
  );
  if (snapshotRead.kind === "blocked") {
    return snapshotRead.result;
  }
  const { snapshot } = snapshotRead;
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
  if (!sealedAnalysisInputsMatch(previousCheckpoint, snapshot, prerequisites)) {
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
  const identityRead = await readClaimIdentities(
    db,
    claim,
    timestamp,
    previousCheckpoint,
    snapshot.listingId,
    positionAnalysis
  );
  if (identityRead.kind === "blocked") {
    return identityRead.result;
  }
  const { identities } = identityRead;
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
    !commitAnalysisInputsMatch(
      previousCheckpoint,
      snapshot,
      commitSnapshot,
      commitPrerequisites
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
