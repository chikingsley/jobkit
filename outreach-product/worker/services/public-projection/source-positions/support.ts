import {
  EXACT_PROJECTION_ANALYSIS_GUARD_SQL,
  exactProjectionAnalysisGuardBindings,
} from "../analysis-guard";
import {
  assertClaimedUpdate,
  type ClaimedProjectionListing,
  claimedListingUpdateStatement,
  projectionRunCounterStatement,
} from "../listing-items";
import type { readExactProjectionListingSnapshot } from "../listing-snapshot";
import type {
  ProjectionAnalysisGuard,
  readProjectionAnalysisPrerequisites,
} from "../prerequisites";
import {
  type ListingCheckpointRow,
  SealedPrerequisiteCheckpointSchema,
  type SourcePositionExpansionProgress,
} from "./model";

export function readExpansionProgress(
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

export function requireReadyPositionInputs(
  prerequisites: Awaited<ReturnType<typeof readProjectionAnalysisPrerequisites>>
) {
  const { guard: analysisGuard, position: positionAnalysis } = prerequisites;
  if (!(positionAnalysis && analysisGuard)) {
    throw new Error("Ready projection prerequisites omitted sealed inputs");
  }
  return { analysisGuard, positionAnalysis };
}

export function expansionProgressChanged(
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

export function analysisExpansionGuardStatement(
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

export function classifyExpansionFailure(error: unknown) {
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

export async function readSealedCheckpoint(
  db: D1Database,
  listingItemId: string
) {
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

export async function blockClaim(
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

export function analysisSealMatches(
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

export function sealedMaterialCheckpoint(
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
