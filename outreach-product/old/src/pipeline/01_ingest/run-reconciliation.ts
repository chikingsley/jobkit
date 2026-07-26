import type { AgentRunnerContext } from "../../features/agents/runner";
import {
  InventoryRunError,
  type InventoryRunFailure,
  type InventoryRunFinish,
  type InventoryRunRow,
  readInventorySource,
  readOwnedRun,
  toInventoryRun,
} from "./contracts";

export async function finishInventoryRun(
  db: D1Database,
  runner: AgentRunnerContext,
  runId: string,
  input: InventoryRunFinish
) {
  const run = await readOwnedRun(db, runner, runId);
  if (run.status === "completed") {
    return toInventoryRun(run);
  }
  if (run.status !== "ingesting" && run.status !== "partial") {
    throw new InventoryRunError(
      `Inventory run cannot be completed while ${run.status}`,
      409
    );
  }
  await assertCompleteBatchSequence(db, run, input.expectedBatchCount);

  const source = await readInventorySource(db, run.source_id);
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `UPDATE inventory_runs SET status='reconciling',updated_at=? WHERE id=?`
    )
    .bind(timestamp, run.id)
    .run();

  const closedCount =
    source.completeness_policy === "complete_snapshot"
      ? await closeMissingInventoryJobs(db, run, timestamp)
      : 0;
  const [runResult] = await db.batch([
    db
      .prepare(
        `UPDATE inventory_runs
            SET status='completed',closed_count=?,completed_at=?,updated_at=?,
                checkpoint_json=json_object(
                  'expectedBatchCount',?,
                  'completenessPolicy',?
                )
          WHERE id=? AND status='reconciling'`
      )
      .bind(
        closedCount,
        timestamp,
        timestamp,
        input.expectedBatchCount,
        source.completeness_policy,
        run.id
      ),
    db
      .prepare(
        `UPDATE inventory_sources
            SET last_completed_at=?,last_success_at=?,last_error='',
                next_refresh_at=CASE
                  WHEN refresh_interval_minutes IS NULL THEN NULL
                  ELSE datetime(?, '+' || refresh_interval_minutes || ' minutes')
                END,
                updated_at=?
          WHERE id=?`
      )
      .bind(timestamp, timestamp, timestamp, timestamp, source.id),
  ]);
  if ((runResult?.meta.changes ?? 0) !== 1) {
    throw new Error("Inventory run could not be completed");
  }
  return toInventoryRun(await readOwnedRun(db, runner, runId));
}

export async function failInventoryRun(
  db: D1Database,
  runner: AgentRunnerContext,
  runId: string,
  input: InventoryRunFailure
) {
  const run = await readOwnedRun(db, runner, runId);
  if (run.status === "completed") {
    throw new InventoryRunError("A completed inventory run cannot fail", 409);
  }
  const timestamp = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE inventory_runs
            SET status='failed',error_detail=?,completed_at=?,updated_at=?
          WHERE id=?`
      )
      .bind(input.error, timestamp, timestamp, run.id),
    db
      .prepare(
        "UPDATE inventory_sources SET last_error=?,updated_at=? WHERE id=?"
      )
      .bind(input.error, timestamp, run.source_id),
  ]);
  return toInventoryRun(await readOwnedRun(db, runner, run.id));
}

async function assertCompleteBatchSequence(
  db: D1Database,
  run: InventoryRunRow,
  expectedBatchCount: number
) {
  const summary = await db
    .prepare(
      `SELECT COUNT(*) batch_count,
              COALESCE(MIN(ordinal),0) minimum_ordinal,
              COALESCE(MAX(ordinal),-1) maximum_ordinal,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed_count
         FROM inventory_run_batches WHERE run_id=?`
    )
    .bind(run.id)
    .first<{
      batch_count: number;
      completed_count: number;
      maximum_ordinal: number;
      minimum_ordinal: number;
    }>();
  const hasSequence =
    expectedBatchCount === 0
      ? summary?.batch_count === 0
      : summary?.batch_count === expectedBatchCount &&
        summary.completed_count === expectedBatchCount &&
        summary.minimum_ordinal === 0 &&
        summary.maximum_ordinal === expectedBatchCount - 1;
  if (!hasSequence) {
    throw new InventoryRunError(
      "Inventory run does not have a complete contiguous batch sequence",
      409
    );
  }
  const current = await db
    .prepare(
      "SELECT processed_count,failed_count FROM inventory_runs WHERE id=?"
    )
    .bind(run.id)
    .first<{ failed_count: number; processed_count: number }>();
  if (
    current?.failed_count !== 0 ||
    current.processed_count !== run.source_active_count
  ) {
    throw new InventoryRunError(
      "Inventory run item counts do not match the active source snapshot",
      409
    );
  }
}

async function closeMissingInventoryJobs(
  db: D1Database,
  run: InventoryRunRow,
  timestamp: string
) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) count FROM job_listings j
        WHERE j.inventory_source_id=? AND j.inventory_status='active'
          AND NOT EXISTS (
            SELECT 1 FROM inventory_run_items item
             WHERE item.run_id=? AND item.job_id=j.id
               AND item.status IN ('upserted','unchanged')
          )`
    )
    .bind(run.source_id, run.id)
    .first<{ count: number }>();
  const closedCount = Number(row?.count ?? 0);
  if (closedCount === 0) {
    return 0;
  }
  await db.batch([
    db
      .prepare(
        `UPDATE outbound_recipient_claims
            SET status='released',lease_expires_at=NULL,released_at=?,updated_at=?
          WHERE source_kind='campaign_dispatch' AND status='claimed'
            AND source_id IN (
              SELECT DISTINCT d.id
                FROM campaign_dispatches d
                JOIN campaign_dispatch_targets dt ON dt.dispatch_id=d.id
                JOIN campaign_targets t ON t.id=dt.target_id
                JOIN job_listings j ON j.id=t.job_id
               WHERE j.inventory_source_id=? AND j.inventory_status='active'
                 AND NOT EXISTS (
                   SELECT 1 FROM inventory_run_items item
                    WHERE item.run_id=? AND item.job_id=j.id
                      AND item.status IN ('upserted','unchanged')
                 )
                 AND d.status IN (
                   'calibration','queued','drafting','review','ready','claimed'
                 )
            )`
      )
      .bind(timestamp, timestamp, run.source_id, run.id),
    db
      .prepare(
        `UPDATE campaign_dispatches
            SET status='canceled',error_detail='Source listing closed',updated_at=?
          WHERE status IN (
            'calibration','queued','drafting','review','ready','claimed'
          ) AND id IN (
            SELECT DISTINCT dt.dispatch_id
              FROM campaign_dispatch_targets dt
              JOIN campaign_targets t ON t.id=dt.target_id
              JOIN job_listings j ON j.id=t.job_id
             WHERE j.inventory_source_id=? AND j.inventory_status='active'
               AND NOT EXISTS (
                 SELECT 1 FROM inventory_run_items item
                  WHERE item.run_id=? AND item.job_id=j.id
                    AND item.status IN ('upserted','unchanged')
               )
          )`
      )
      .bind(timestamp, run.source_id, run.id),
    db
      .prepare(
        `UPDATE campaign_targets
            SET status='held',hold_reason='Source listing closed',updated_at=?
          WHERE job_id IN (
            SELECT j.id FROM job_listings j
             WHERE j.inventory_source_id=? AND j.inventory_status='active'
               AND NOT EXISTS (
                 SELECT 1 FROM inventory_run_items item
                  WHERE item.run_id=? AND item.job_id=j.id
                    AND item.status IN ('upserted','unchanged')
               )
          ) AND status NOT IN ('sent','replied')`
      )
      .bind(timestamp, run.source_id, run.id),
    db
      .prepare(
        `UPDATE application_routes
            SET status='closed',updated_at=?
          WHERE status<>'closed' AND job_id IN (
            SELECT j.id FROM job_listings j
             WHERE j.inventory_source_id=? AND j.inventory_status='active'
               AND NOT EXISTS (
                 SELECT 1 FROM inventory_run_items item
                  WHERE item.run_id=? AND item.job_id=j.id
                    AND item.status IN ('upserted','unchanged')
               )
          )`
      )
      .bind(timestamp, run.source_id, run.id),
    db
      .prepare(
        `UPDATE job_listings SET inventory_status='closed',inventory_run_id=?
          WHERE inventory_source_id=? AND inventory_status='active'
            AND NOT EXISTS (
              SELECT 1 FROM inventory_run_items item
               WHERE item.run_id=? AND item.job_id=job_listings.id
                 AND item.status IN ('upserted','unchanged')
            )`
      )
      .bind(run.id, run.source_id, run.id),
  ]);
  return closedCount;
}
