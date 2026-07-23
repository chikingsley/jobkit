import { PUBLIC_PROJECTION_ADVANCE_LIMIT } from "../contracts";
import { processProjectionIdentityClaim } from "../identity";
import {
  claimProjectionListing,
  projectionRunCounterStatement,
} from "../listing-items";
import { claimProjectionPosition } from "../position-items";
import { processProjectionPrerequisiteClaim } from "../prerequisites";
import { processProjectionSourcePositionClaim } from "../source-positions";

export async function processPrerequisiteListings(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  const totals = { blocked: 0, processed: 0, ready: 0, waiting: 0 };
  while (totals.processed < PUBLIC_PROJECTION_ADVANCE_LIMIT) {
    // biome-ignore lint/performance/noAwaitInLoops: Each iteration atomically leases one bounded projection item.
    const claim = await claimProjectionListing(
      db,
      runId,
      "prerequisites",
      timestamp
    );
    if (!claim) {
      break;
    }
    const result = await processProjectionPrerequisiteClaim(
      db,
      claim,
      timestamp
    );
    totals.blocked += result.blocked;
    totals.ready += result.ready;
    totals.waiting += result.waiting;
    totals.processed += 1;
  }
  return totals;
}

export async function expandSourcePositions(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  const totals = { blocked: 0, expanded: 0, processed: 0, waiting: 0 };
  while (totals.processed < PUBLIC_PROJECTION_ADVANCE_LIMIT) {
    // biome-ignore lint/performance/noAwaitInLoops: Each iteration atomically leases one bounded projection item.
    const claim = await claimProjectionListing(
      db,
      runId,
      "source_positions",
      timestamp
    );
    if (!claim) {
      break;
    }
    const result = await processProjectionSourcePositionClaim(
      db,
      claim,
      timestamp
    );
    totals.blocked += result.blocked;
    totals.expanded += result.expanded;
    totals.waiting += result.waiting;
    totals.processed += 1;
  }
  return totals;
}

export async function processPositionIdentities(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  const totals = { blocked: 0, identified: 0, processed: 0 };
  while (totals.processed < PUBLIC_PROJECTION_ADVANCE_LIMIT) {
    // biome-ignore lint/performance/noAwaitInLoops: Each iteration atomically leases one bounded projection item.
    const claim = await claimProjectionPosition(
      db,
      runId,
      "identity",
      timestamp
    );
    if (!claim) {
      break;
    }
    const result = await processProjectionIdentityClaim(db, claim, timestamp);
    totals.blocked += result.blocked;
    totals.identified += result.identified;
    totals.processed += 1;
  }
  return totals;
}

export async function failRun(
  db: D1Database,
  runId: string,
  errorCode:
    | "duplicate_pair_input_snapshot_changed"
    | "final_duplicate_input_snapshot_changed"
    | "policy_heads_changed"
    | "source_watermark_changed",
  timestamp: string
) {
  const errorDetail = {
    duplicate_pair_input_snapshot_changed:
      "The sealed duplicate-comparison inputs changed during finalization",
    final_duplicate_input_snapshot_changed:
      "The sealed canonical duplicate inputs changed during finalization",
    policy_heads_changed: "Publication policy heads changed during the run",
    source_watermark_changed: "The scoped active listing cohort changed",
  }[errorCode];
  await db.batch([
    db
      .prepare(
        `UPDATE public_projection_listing_items
            SET status='superseded',lease_owner=NULL,lease_token=NULL,
                lease_expires_at=NULL,error_code='projection_run_failed',
                error_detail=?,completed_at=COALESCE(completed_at,?),updated_at=?
          WHERE run_id=?
            AND status IN ('queued','processing','waiting_analysis')`
      )
      .bind(errorDetail, timestamp, timestamp, runId),
    db
      .prepare(
        `UPDATE public_projection_position_items
            SET status='superseded',lease_owner=NULL,lease_token=NULL,
                lease_expires_at=NULL,error_code='projection_run_failed',
                error_detail=?,completed_at=COALESCE(
                  completed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')
                ),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE run_id=?
            AND status IN ('queued','processing','waiting_analysis')`
      )
      .bind(errorDetail, runId),
    projectionRunCounterStatement(db, runId, timestamp),
    db
      .prepare(
        `UPDATE public_projection_runs
            SET status='failed',error_code=?,error_detail=?,
                completed_at=?,updated_at=?
          WHERE id=? AND status='running'`
      )
      .bind(errorCode, errorDetail, timestamp, timestamp, runId),
  ]);
}
