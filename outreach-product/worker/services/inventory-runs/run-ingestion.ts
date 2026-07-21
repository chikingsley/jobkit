import type { AgentRunnerContext } from "../../app-types";
import {
  assertRefreshOperationLease,
  assertRunCounts,
  assertRunOwner,
  type InventoryRunBatch,
  InventoryRunError,
  type InventoryRunRow,
  type InventoryRunStart,
  readInventorySource,
  readOwnedRun,
  toInventoryRun,
} from "./contracts";
import {
  ingestInventoryJob,
  recordInventoryItemFailure,
} from "./job-ingestion";

export async function beginInventoryRun(
  db: D1Database,
  runner: AgentRunnerContext,
  input: InventoryRunStart
) {
  const source = await readInventorySource(db, input.sourceId);
  if (input.operationId) {
    await assertRefreshOperationLease(
      db,
      runner,
      input.operationId,
      input.sourceId
    );
  }
  const existing = await db
    .prepare(
      `SELECT id,source_id,started_by_user_id,runner_id,status,refresh_request_id,
              source_total_count,source_active_count,processed_count,
              upserted_count,unchanged_count,failed_count
         FROM inventory_runs
        WHERE source_id=? AND snapshot_key=?`
    )
    .bind(input.sourceId, input.snapshotKey)
    .first<InventoryRunRow>();
  if (existing) {
    assertRunOwner(existing, runner);
    assertRunCounts(existing, input);
    if (existing.refresh_request_id !== (input.operationId ?? null)) {
      throw new InventoryRunError(
        "Inventory snapshot key belongs to a different refresh operation",
        409
      );
    }
    if (existing.status === "failed") {
      const timestamp = new Date().toISOString();
      await db.batch([
        db
          .prepare(
            `UPDATE inventory_runs
                SET status='ingesting',error_detail='',completed_at=NULL,updated_at=?
              WHERE id=? AND status='failed'`
          )
          .bind(timestamp, existing.id),
        db
          .prepare(
            `UPDATE inventory_sources
                SET name=?,last_started_at=?,last_error='',updated_at=?
              WHERE id=?`
          )
          .bind(input.sourceName, timestamp, timestamp, source.id),
      ]);
      return toInventoryRun(await readOwnedRun(db, runner, existing.id));
    }
    return toInventoryRun(existing);
  }

  const timestamp = new Date().toISOString();
  const id = crypto.randomUUID();
  const [runResult] = await db.batch([
    db
      .prepare(
        `INSERT INTO inventory_runs
          (id,source_id,snapshot_key,started_by_user_id,runner_id,refresh_request_id,status,
           source_total_count,source_active_count,source_closed_count,
           started_at,updated_at)
         VALUES (?,?,?,?,?,?,'ingesting',?,?,?,?,?)`
      )
      .bind(
        id,
        source.id,
        input.snapshotKey,
        runner.user.id,
        runner.id,
        input.operationId ?? null,
        input.sourceTotalCount,
        input.sourceActiveCount,
        input.sourceClosedCount,
        timestamp,
        timestamp
      ),
    db
      .prepare(
        `UPDATE inventory_sources
            SET name=?,last_started_at=?,last_error='',updated_at=?
          WHERE id=?`
      )
      .bind(input.sourceName, timestamp, timestamp, source.id),
  ]);
  if ((runResult?.meta.changes ?? 0) !== 1) {
    throw new Error("Inventory run could not be started");
  }
  return {
    failedCount: 0,
    id,
    processedCount: 0,
    sourceActiveCount: input.sourceActiveCount,
    sourceId: source.id,
    sourceTotalCount: input.sourceTotalCount,
    status: "ingesting" as const,
    unchangedCount: 0,
    upsertedCount: 0,
  };
}

export async function ingestInventoryBatch(
  db: D1Database,
  runner: AgentRunnerContext,
  runId: string,
  input: InventoryRunBatch
) {
  const run = await readOwnedRun(db, runner, runId);
  if (run.status === "completed") {
    return toInventoryRun(run);
  }
  if (run.status !== "ingesting" && run.status !== "partial") {
    throw new InventoryRunError(
      `Inventory run cannot accept batches while ${run.status}`,
      409
    );
  }

  const existingBatch = await db
    .prepare(
      `SELECT id,ordinal,item_count,status
         FROM inventory_run_batches
        WHERE run_id=? AND batch_key=?`
    )
    .bind(runId, input.batchKey)
    .first<{
      id: string;
      item_count: number;
      ordinal: number;
      status: "completed" | "failed" | "processing";
    }>();
  if (
    existingBatch &&
    (existingBatch.ordinal !== input.ordinal ||
      existingBatch.item_count !== input.jobs.length)
  ) {
    throw new InventoryRunError(
      "Inventory batch key was reused with different contents",
      409
    );
  }
  if (existingBatch?.status === "completed") {
    return toInventoryRun(await readOwnedRun(db, runner, runId));
  }

  const timestamp = new Date().toISOString();
  const batchId = existingBatch?.id ?? crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO inventory_run_batches
        (id,run_id,batch_key,ordinal,item_count,status,created_at)
       VALUES (?,?,?,?,?,'processing',?)
       ON CONFLICT(run_id,batch_key) DO UPDATE SET
         status='processing',error_detail='',completed_at=NULL`
    )
    .bind(
      batchId,
      runId,
      input.batchKey,
      input.ordinal,
      input.jobs.length,
      timestamp
    )
    .run();

  const failures: Array<{ detail: string; transient: boolean }> = [];
  for (const job of input.jobs) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Each source job is a durable checkpoint, allowing an interrupted request to resume.
      await ingestInventoryJob(db, run, batchId, job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await recordInventoryItemFailure(db, run.id, batchId, job, message);
      failures.push({
        detail: `${job.id}: ${message}`,
        transient: isTransientInventoryStorageError(error),
      });
    }
  }

  const completedAt = new Date().toISOString();
  if (failures.length > 0) {
    await db
      .prepare(
        `UPDATE inventory_run_batches
            SET status='failed',error_detail=?,completed_at=?
          WHERE id=?`
      )
      .bind(
        failures
          .map((failure) => failure.detail)
          .join("\n")
          .slice(0, 4000),
        completedAt,
        batchId
      )
      .run();
    throw new InventoryRunError(
      `${failures.length} inventory item${failures.length === 1 ? "" : "s"} could not be ingested`,
      failures.every((failure) => failure.transient) ? 503 : 422
    );
  }
  await db
    .prepare(
      `UPDATE inventory_run_batches
          SET status='completed',error_detail='',completed_at=?
        WHERE id=?`
    )
    .bind(completedAt, batchId)
    .run();
  return toInventoryRun(await readOwnedRun(db, runner, runId));
}

const TRANSIENT_D1_ERROR_PATTERN =
  /D1_ERROR:.*(?:network connection lost|service unavailable|temporarily unavailable|timed out|timeout|please try again)/iu;

export function isTransientInventoryStorageError(error: unknown) {
  return (
    error instanceof Error && TRANSIENT_D1_ERROR_PATTERN.test(error.message)
  );
}
