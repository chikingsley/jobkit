import {
  claimablePositionItemSql,
  unsealedCanonicalResolutionGateSql,
} from "./advancement/stage-sql";
import { canonicalJson } from "./hash";

const PROJECTION_LEASE_OWNER = "public-projection-scheduler-v1";

export type ProjectionPositionStage =
  | "canonical_resolution"
  | "content"
  | "eligibility"
  | "identity";

export interface ClaimedProjectionPosition {
  attemptCount: number;
  checkpointJson: string;
  id: string;
  inputHash: string;
  leaseExpiresAt: string;
  leaseOwner: string;
  leaseToken: string;
  listingItemId: string;
  maxAttempts: number;
  runId: string;
  sourcePositionId: string;
  stage: ProjectionPositionStage;
}

interface ClaimedProjectionPositionRow {
  attempt_count: number;
  checkpoint_json: string;
  id: string;
  input_hash: string;
  lease_expires_at: string;
  lease_owner: string;
  lease_token: string;
  listing_item_id: string;
  max_attempts: number;
  run_id: string;
  source_position_id: string;
  stage: ProjectionPositionStage;
}

export async function claimProjectionPosition(
  db: D1Database,
  runId: string,
  stage: ProjectionPositionStage,
  timestamp: string,
  options: { requireUnsealedCanonicalResolution?: boolean } = {}
): Promise<ClaimedProjectionPosition | null> {
  const leaseToken = crypto.randomUUID();
  const row = await db
    .prepare(
      `UPDATE public_projection_position_items
          SET status='processing',attempt_count=attempt_count+1,
              lease_owner=?,lease_token=?,
              lease_expires_at=strftime(
                '%Y-%m-%dT%H:%M:%fZ','now','+5 minutes'
              ),
              started_at=COALESCE(started_at,?),updated_at=?
        WHERE id=(
          SELECT item.id FROM public_projection_position_items item
           WHERE item.run_id=? AND item.stage=?
             AND ${claimablePositionItemSql("item")}
             AND (
               ?=0 OR (${unsealedCanonicalResolutionGateSql("item")})
             )
           ORDER BY item.source_position_id,item.id LIMIT 1
        )
          AND run_id=? AND stage=?
          AND ${claimablePositionItemSql("public_projection_position_items")}
          AND (
            ?=0 OR (${unsealedCanonicalResolutionGateSql(
              "public_projection_position_items"
            )})
          )
      RETURNING id,run_id,listing_item_id,source_position_id,input_hash,
                stage,checkpoint_json,attempt_count,max_attempts,lease_owner,
                lease_token,lease_expires_at`
    )
    .bind(
      PROJECTION_LEASE_OWNER,
      leaseToken,
      timestamp,
      timestamp,
      runId,
      stage,
      options.requireUnsealedCanonicalResolution ? 1 : 0,
      runId,
      stage,
      options.requireUnsealedCanonicalResolution ? 1 : 0
    )
    .first<ClaimedProjectionPositionRow>();
  return row
    ? {
        attemptCount: row.attempt_count,
        checkpointJson: row.checkpoint_json,
        id: row.id,
        inputHash: row.input_hash,
        leaseExpiresAt: row.lease_expires_at,
        leaseOwner: row.lease_owner,
        leaseToken: row.lease_token,
        listingItemId: row.listing_item_id,
        maxAttempts: row.max_attempts,
        runId: row.run_id,
        sourcePositionId: row.source_position_id,
        stage: row.stage,
      }
    : null;
}

export function claimedPositionUpdateStatement(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  input: {
    checkpoint: unknown;
    checkpointGuardPath?: string;
    checkpointGuardToken?: string;
    errorCode?: string;
    errorDetail?: string;
    stage: "canonical_resolution" | "content" | "eligibility" | "identity";
    status: "blocked" | "failed" | "queued" | "waiting_analysis";
  }
) {
  return db
    .prepare(
      `UPDATE public_projection_position_items
          SET stage=?,status=?,lease_owner=NULL,lease_token=NULL,
              lease_expires_at=NULL,checkpoint_json=?,error_code=?,
              error_detail=?,
              completed_at=CASE
                WHEN ? IN ('blocked','failed')
                THEN strftime('%Y-%m-%dT%H:%M:%fZ','now')
                ELSE NULL
              END,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND run_id=? AND status='processing'
          AND lease_owner=? AND lease_token=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND (
            ? IS NULL
            OR json_extract(checkpoint_json,?)=?
          )`
    )
    .bind(
      input.stage,
      input.status,
      canonicalJson(input.checkpoint),
      input.errorCode ?? "",
      input.errorDetail ?? "",
      input.status,
      claim.id,
      claim.runId,
      claim.leaseOwner,
      claim.leaseToken,
      input.checkpointGuardToken ?? null,
      input.checkpointGuardPath ?? "$.guard",
      input.checkpointGuardToken ?? null
    );
}

export async function assertPositionClaimLease(
  db: D1Database,
  claim: ClaimedProjectionPosition
) {
  const row = await db
    .prepare(
      `SELECT 1 present FROM public_projection_position_items
        WHERE id=? AND run_id=? AND status='processing'
          AND lease_owner=? AND lease_token=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        LIMIT 1`
    )
    .bind(claim.id, claim.runId, claim.leaseOwner, claim.leaseToken)
    .first<{ present: number }>();
  if (row?.present !== 1) {
    throw new Error("Projection position lease changed during processing");
  }
}

export function assertClaimedPositionUpdate(
  result: D1Result<unknown> | undefined,
  action: string
) {
  if (!result || (result.meta.changes ?? 0) !== 1) {
    throw new Error(`Projection position ${action} lost its lease fence`);
  }
}
