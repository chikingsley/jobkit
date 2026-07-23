import { PUBLIC_PROJECTION_RUN_STEP_BUDGET } from "../contracts";
import { projectionRunCounterStatement } from "../listing-items";

export type ProjectionRunStepBudget =
  | { exhausted: false; steps: number | null }
  | { exhausted: true; steps: number };

/**
 * Counts one chained queue step against the run and terminalizes it once the
 * ceiling is crossed. A `null` steps value means the run is already terminal,
 * so the caller owes it no further work.
 */
export async function consumeProjectionRunStepBudget(
  db: D1Database,
  runId: string,
  timestamp: string
): Promise<ProjectionRunStepBudget> {
  const row = await db
    .prepare(
      `UPDATE public_projection_runs
          SET advance_step_count=advance_step_count+1,updated_at=?
        WHERE id=? AND status IN ('queued','running')
        RETURNING advance_step_count`
    )
    .bind(timestamp, runId)
    .first<{ advance_step_count: number }>();
  if (!row) {
    return { exhausted: false, steps: null };
  }
  if (row.advance_step_count <= PUBLIC_PROJECTION_RUN_STEP_BUDGET) {
    return { exhausted: false, steps: row.advance_step_count };
  }
  await failRunForExhaustedStepBudget(
    db,
    runId,
    row.advance_step_count,
    timestamp
  );
  return { exhausted: true, steps: row.advance_step_count };
}

async function failRunForExhaustedStepBudget(
  db: D1Database,
  runId: string,
  steps: number,
  timestamp: string
) {
  const errorDetail =
    `The run consumed ${steps} chained queue steps and exceeded its ` +
    `${PUBLIC_PROJECTION_RUN_STEP_BUDGET}-step budget`;
  await db.batch([
    db
      .prepare(
        `UPDATE public_projection_listing_items
            SET status='superseded',lease_owner=NULL,lease_token=NULL,
                lease_expires_at=NULL,error_code='projection_run_failed',
                error_detail=?,completed_at=COALESCE(completed_at,?),
                updated_at=?
          WHERE run_id=?
            AND status IN ('queued','processing','waiting_analysis')`
      )
      .bind(errorDetail, timestamp, timestamp, runId),
    db
      .prepare(
        `UPDATE public_projection_position_items
            SET status='superseded',lease_owner=NULL,lease_token=NULL,
                lease_expires_at=NULL,error_code='projection_run_failed',
                error_detail=?,completed_at=COALESCE(completed_at,?),
                updated_at=?
          WHERE run_id=?
            AND status IN ('queued','processing','waiting_analysis')`
      )
      .bind(errorDetail, timestamp, timestamp, runId),
    projectionRunCounterStatement(db, runId, timestamp),
    db
      .prepare(
        `UPDATE public_projection_runs
            SET status='failed',error_code='advance_budget_exhausted',
                error_detail=?,completed_at=?,updated_at=?
          WHERE id=? AND status IN ('queued','running')`
      )
      .bind(errorDetail, timestamp, timestamp, runId),
  ]);
}
