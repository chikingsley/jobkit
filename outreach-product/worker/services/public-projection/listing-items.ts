import { canonicalJson } from "./hash";

const PROJECTION_ITEM_LEASE_MS = 5 * 60 * 1000;
const PROJECTION_LEASE_OWNER = "public-projection-scheduler-v1";

export type ProjectionListingStage = "prerequisites" | "source_positions";

export interface ClaimedProjectionListing {
  attemptCount: number;
  id: string;
  inputHash: string;
  leaseExpiresAt: string;
  leaseOwner: string;
  leaseToken: string;
  listingId: string;
  materialVersion: number;
  maxAttempts: number;
  runId: string;
  stage: ProjectionListingStage;
}

interface ClaimedProjectionListingRow {
  attempt_count: number;
  id: string;
  input_hash: string;
  lease_expires_at: string;
  lease_owner: string;
  lease_token: string;
  listing_id: string;
  material_version: number;
  max_attempts: number;
  run_id: string;
  stage: ProjectionListingStage;
}

export async function claimProjectionListing(
  db: D1Database,
  runId: string,
  stage: ProjectionListingStage,
  timestamp: string
): Promise<ClaimedProjectionListing | null> {
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(
    new Date(timestamp).getTime() + PROJECTION_ITEM_LEASE_MS
  ).toISOString();
  const row = await db
    .prepare(
      `UPDATE public_projection_listing_items
          SET status='processing',attempt_count=attempt_count+1,
              lease_owner=?,lease_token=?,lease_expires_at=?,
              started_at=COALESCE(started_at,?),updated_at=?
        WHERE id=(
          SELECT id FROM public_projection_listing_items
           WHERE run_id=? AND stage=? AND status='queued'
             AND attempt_count<max_attempts
           ORDER BY listing_id,id LIMIT 1
        )
          AND run_id=? AND stage=? AND status='queued'
          AND attempt_count<max_attempts
      RETURNING id,run_id,listing_id,material_version,input_hash,stage,
                attempt_count,max_attempts,lease_owner,lease_token,
                lease_expires_at`
    )
    .bind(
      PROJECTION_LEASE_OWNER,
      leaseToken,
      leaseExpiresAt,
      timestamp,
      timestamp,
      runId,
      stage,
      runId,
      stage
    )
    .first<ClaimedProjectionListingRow>();
  return row
    ? {
        attemptCount: row.attempt_count,
        id: row.id,
        inputHash: row.input_hash,
        leaseExpiresAt: row.lease_expires_at,
        leaseOwner: row.lease_owner,
        leaseToken: row.lease_token,
        listingId: row.listing_id,
        materialVersion: row.material_version,
        maxAttempts: row.max_attempts,
        runId: row.run_id,
        stage: row.stage,
      }
    : null;
}

export function claimedListingUpdateStatement(
  db: D1Database,
  claim: ClaimedProjectionListing,
  input: {
    checkpoint: unknown;
    checkpointGuardToken?: string;
    completedAt: string | null;
    errorCode?: string;
    errorDetail?: string;
    stage: "completed" | "prerequisites" | "source_positions";
    status: "blocked" | "completed" | "failed" | "queued" | "waiting_analysis";
    timestamp: string;
  }
) {
  return db
    .prepare(
      `UPDATE public_projection_listing_items
          SET stage=?,status=?,lease_owner=NULL,lease_token=NULL,
              lease_expires_at=NULL,checkpoint_json=?,error_code=?,
              error_detail=?,completed_at=?,updated_at=?
        WHERE id=? AND run_id=? AND status='processing'
          AND lease_owner=? AND lease_token=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND (
            ? IS NULL
            OR json_extract(checkpoint_json,'$.expansionGuard')=?
          )`
    )
    .bind(
      input.stage,
      input.status,
      canonicalJson(input.checkpoint),
      input.errorCode ?? "",
      input.errorDetail ?? "",
      input.completedAt,
      input.timestamp,
      claim.id,
      claim.runId,
      claim.leaseOwner,
      claim.leaseToken,
      input.checkpointGuardToken ?? null,
      input.checkpointGuardToken ?? null
    );
}

export function projectionRunCounterStatement(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  return db
    .prepare(
      `UPDATE public_projection_runs
          SET listing_completed=(
                SELECT COUNT(*) FROM public_projection_listing_items
                 WHERE run_id=? AND status='completed'
              ),
              listing_blocked=(
                SELECT COUNT(*) FROM public_projection_listing_items
                 WHERE run_id=? AND status='blocked'
              ),
              listing_failed=(
                SELECT COUNT(*) FROM public_projection_listing_items
                 WHERE run_id=? AND status='failed'
              ),
              listing_superseded=(
                SELECT COUNT(*) FROM public_projection_listing_items
                 WHERE run_id=? AND status='superseded'
              ),
              position_total=(
                SELECT COUNT(*) FROM public_projection_position_items
                 WHERE run_id=?
              ),
              position_completed=(
                SELECT COUNT(*) FROM public_projection_position_items
                 WHERE run_id=? AND status='completed'
              ),
              position_blocked=(
                SELECT COUNT(*) FROM public_projection_position_items
                 WHERE run_id=? AND status='blocked'
              ),
              position_failed=(
                SELECT COUNT(*) FROM public_projection_position_items
                 WHERE run_id=? AND status='failed'
              ),
              position_superseded=(
                SELECT COUNT(*) FROM public_projection_position_items
                 WHERE run_id=? AND status='superseded'
              ),
              updated_at=?
        WHERE id=? AND status='running'`
    )
    .bind(
      runId,
      runId,
      runId,
      runId,
      runId,
      runId,
      runId,
      runId,
      runId,
      timestamp,
      runId
    );
}

export async function assertClaimLease(
  db: D1Database,
  claim: ClaimedProjectionListing
) {
  const row = await db
    .prepare(
      `SELECT 1 present FROM public_projection_listing_items
        WHERE id=? AND run_id=? AND status='processing'
          AND lease_owner=? AND lease_token=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        LIMIT 1`
    )
    .bind(claim.id, claim.runId, claim.leaseOwner, claim.leaseToken)
    .first<{ present: number }>();
  if (row?.present !== 1) {
    throw new Error("Projection listing lease changed during processing");
  }
}

export function assertClaimedUpdate(
  result: D1Result<unknown> | undefined,
  action: string
) {
  if (!result || (result.meta.changes ?? 0) !== 1) {
    throw new Error(`Projection listing ${action} lost its lease fence`);
  }
}
