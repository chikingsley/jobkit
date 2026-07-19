import type { z } from "zod";
import { inventoryJobContentHash } from "../../src/features/inventory/content";
import type {
  InventoryJob,
  InventoryRunBatchSchema,
  InventoryRunFailureSchema,
  InventoryRunFinishSchema,
  InventoryRunStartSchema,
} from "../../src/features/inventory/schema";
import type { AgentRunnerContext } from "../app-types";
import { upsertApplicationRoutes } from "../repositories/application-routes";
import type { JobImport } from "../schemas";

type InventoryRunBatch = z.infer<typeof InventoryRunBatchSchema>;
type InventoryRunFailure = z.infer<typeof InventoryRunFailureSchema>;
type InventoryRunFinish = z.infer<typeof InventoryRunFinishSchema>;
type InventoryRunStart = z.infer<typeof InventoryRunStartSchema>;

type InventoryItemStatus = "failed" | "unchanged" | "upserted";
type InventoryRunStatus =
  | "canceled"
  | "completed"
  | "failed"
  | "ingesting"
  | "partial"
  | "reconciling";

interface InventoryRunRow {
  failed_count: number;
  id: string;
  processed_count: number;
  runner_id: string | null;
  source_active_count: number;
  source_id: string;
  source_total_count: number;
  started_by_user_id: string | null;
  status: InventoryRunStatus;
  unchanged_count: number;
  upserted_count: number;
}

interface InventoryRunItemRow {
  content_hash: string;
  status: InventoryItemStatus;
}

interface InventorySourceRow {
  completeness_policy: "append_only" | "complete_snapshot";
  id: string;
}

export class InventoryRunError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 422;

  constructor(message: string, status: 400 | 403 | 404 | 409 | 422) {
    super(message);
    this.status = status;
  }
}

export async function beginInventoryRun(
  db: D1Database,
  runner: AgentRunnerContext,
  input: InventoryRunStart
) {
  const source = await readInventorySource(db, input.sourceId);
  const existing = await db
    .prepare(
      `SELECT id,source_id,started_by_user_id,runner_id,status,
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
    return toInventoryRun(existing);
  }

  const timestamp = new Date().toISOString();
  const id = crypto.randomUUID();
  const [runResult] = await db.batch([
    db
      .prepare(
        `INSERT INTO inventory_runs
          (id,source_id,snapshot_key,started_by_user_id,runner_id,status,
           source_total_count,source_active_count,source_closed_count,
           started_at,updated_at)
         VALUES (?,?,?,?,?,'ingesting',?,?,?,?,?)`
      )
      .bind(
        id,
        source.id,
        input.snapshotKey,
        runner.user.id,
        runner.id,
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

  const failures: string[] = [];
  for (const job of input.jobs) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Inventory checkpoints are persisted per source job so an interrupted request can resume safely.
      await ingestInventoryJob(db, run, batchId, job);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await recordInventoryItemFailure(db, run.id, batchId, job, message);
      failures.push(`${job.id}: ${message}`);
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
      .bind(failures.join("\n").slice(0, 4000), completedAt, batchId)
      .run();
    throw new InventoryRunError(
      `${failures.length} inventory item${failures.length === 1 ? "" : "s"} could not be ingested`,
      422
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

export async function listInventoryStatus(db: D1Database) {
  const [sources, runs] = await db.batch<Record<string, unknown>>([
    db.prepare(
      `SELECT id,name,completeness_policy,status,refresh_interval_minutes,
              next_refresh_at,last_started_at,last_completed_at,last_success_at,
              last_error,updated_at
         FROM inventory_sources
        ORDER BY name,id`
    ),
    db.prepare(
      `SELECT id,source_id,snapshot_key,status,source_total_count,
              source_active_count,source_closed_count,processed_count,
              upserted_count,unchanged_count,closed_count,failed_count,
              error_detail,started_at,completed_at,updated_at
         FROM inventory_runs
        ORDER BY started_at DESC LIMIT 20`
    ),
  ]);
  return {
    runs: (runs?.results ?? []).map((row) => ({
      closedCount: Number(row.closed_count),
      completedAt: nullableString(row.completed_at),
      error: String(row.error_detail),
      failedCount: Number(row.failed_count),
      id: String(row.id),
      processedCount: Number(row.processed_count),
      snapshotKey: String(row.snapshot_key),
      sourceActiveCount: Number(row.source_active_count),
      sourceClosedCount: Number(row.source_closed_count),
      sourceId: String(row.source_id),
      sourceTotalCount: Number(row.source_total_count),
      startedAt: String(row.started_at),
      status: String(row.status),
      unchangedCount: Number(row.unchanged_count),
      updatedAt: String(row.updated_at),
      upsertedCount: Number(row.upserted_count),
    })),
    sources: (sources?.results ?? []).map((row) => ({
      completenessPolicy: String(row.completeness_policy),
      id: String(row.id),
      lastCompletedAt: nullableString(row.last_completed_at),
      lastError: String(row.last_error),
      lastStartedAt: nullableString(row.last_started_at),
      lastSuccessAt: nullableString(row.last_success_at),
      name: String(row.name),
      nextRefreshAt: nullableString(row.next_refresh_at),
      refreshIntervalMinutes:
        row.refresh_interval_minutes === null
          ? null
          : Number(row.refresh_interval_minutes),
      status: String(row.status),
      updatedAt: String(row.updated_at),
    })),
  };
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

async function ingestInventoryJob(
  db: D1Database,
  run: InventoryRunRow,
  batchId: string,
  job: InventoryJob
) {
  const contentHash = await inventoryJobContentHash(job);
  const previousItem = await readRunItem(db, run.id, job.id);
  if (previousItem?.content_hash !== undefined) {
    if (previousItem.content_hash !== contentHash) {
      throw new InventoryRunError(
        "Source job changed inside an immutable inventory snapshot",
        409
      );
    }
    if (previousItem.status !== "failed") {
      return;
    }
  }

  const existing = await db
    .prepare(
      `SELECT source_content_hash,inventory_source_id
         FROM jobs WHERE id=?`
    )
    .bind(job.id)
    .first<{
      inventory_source_id: string | null;
      source_content_hash: string;
    }>();
  if (
    existing?.inventory_source_id &&
    existing.inventory_source_id !== run.source_id
  ) {
    throw new InventoryRunError(
      "Job ID is already owned by another inventory source",
      409
    );
  }
  const outcome: InventoryItemStatus =
    existing?.source_content_hash === contentHash ? "unchanged" : "upserted";
  const timestamp = new Date().toISOString();
  if (outcome === "unchanged") {
    await db
      .prepare(
        `UPDATE jobs
            SET inventory_source_id=?,inventory_status='active',
                source_last_seen_at=?,inventory_run_id=?
          WHERE id=?`
      )
      .bind(run.source_id, job.lastSeenAt, run.id, job.id)
      .run();
  } else {
    await upsertInventoryJob(db, run, job, contentHash, timestamp);
  }
  const routeIds = await upsertApplicationRoutes(
    db,
    toJobImport(job),
    timestamp
  );
  await closeSupersededRoutes(db, job.id, routeIds, timestamp);
  await recordInventoryItemOutcome(
    db,
    run.id,
    batchId,
    job.id,
    contentHash,
    outcome,
    previousItem
  );
}

async function upsertInventoryJob(
  db: D1Database,
  run: InventoryRunRow,
  job: InventoryJob,
  contentHash: string,
  timestamp: string
) {
  const compensationSource = compensationSourceFor(job);
  await db
    .prepare(
      `INSERT INTO jobs (
        id,board,title,company,contact_name,country,location,salary,description,
        source_url,apply_url,employer_id,source_reference,first_seen_at,updated_at,
        compensation_display,compensation_amount_min,compensation_amount_max,
        compensation_currency,compensation_period,compensation_qualifier,
        compensation_source,compensation_confidence,compensation_notes_json,
        opportunity_scope,market_segments_json,message_route,
        inventory_source_id,inventory_status,source_last_seen_at,
        source_content_hash,inventory_run_id
      ) VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'[]','unknown',?,
        'advertised_position',?,'active',?,?,?
      )
      ON CONFLICT(id) DO UPDATE SET
        board=excluded.board,title=excluded.title,company=excluded.company,
        contact_name=excluded.contact_name,country=excluded.country,
        location=excluded.location,salary=excluded.salary,
        description=excluded.description,source_url=excluded.source_url,
        apply_url=excluded.apply_url,source_reference=excluded.source_reference,
        updated_at=excluded.updated_at,
        compensation_display=excluded.compensation_display,
        compensation_amount_min=excluded.compensation_amount_min,
        compensation_amount_max=excluded.compensation_amount_max,
        compensation_currency=excluded.compensation_currency,
        compensation_period=excluded.compensation_period,
        compensation_qualifier=excluded.compensation_qualifier,
        compensation_source=excluded.compensation_source,
        compensation_confidence=excluded.compensation_confidence,
        compensation_notes_json=excluded.compensation_notes_json,
        market_segments_json=excluded.market_segments_json,
        inventory_source_id=excluded.inventory_source_id,
        inventory_status='active',
        source_last_seen_at=excluded.source_last_seen_at,
        source_content_hash=excluded.source_content_hash,
        inventory_run_id=excluded.inventory_run_id`
    )
    .bind(
      job.id,
      job.board,
      job.title,
      job.company,
      job.contactName,
      job.country,
      job.location,
      job.salary,
      job.description,
      job.sourceUrl,
      job.applyUrl,
      "",
      job.sourceReference,
      timestamp,
      timestamp,
      job.compensation.display,
      job.compensation.amountMinimum,
      job.compensation.amountMaximum,
      job.compensation.currency,
      job.compensation.period,
      job.compensation.qualifier,
      compensationSource,
      job.compensation.confidence,
      JSON.stringify(job.marketSegments),
      run.source_id,
      job.lastSeenAt,
      contentHash,
      run.id
    )
    .run();
}

async function closeSupersededRoutes(
  db: D1Database,
  jobId: string,
  activeRouteIds: string[],
  timestamp: string
) {
  if (activeRouteIds.length === 0) {
    await db
      .prepare(
        `UPDATE application_routes
            SET status='closed',updated_at=?
          WHERE job_id=? AND status<>'closed'`
      )
      .bind(timestamp, jobId)
      .run();
    return;
  }
  const placeholders = activeRouteIds.map(() => "?").join(",");
  await db
    .prepare(
      `UPDATE application_routes
          SET status='closed',updated_at=?
        WHERE job_id=? AND id NOT IN (${placeholders}) AND status<>'closed'`
    )
    .bind(timestamp, jobId, ...activeRouteIds)
    .run();
}

async function recordInventoryItemOutcome(
  db: D1Database,
  runId: string,
  batchId: string,
  jobId: string,
  contentHash: string,
  status: Exclude<InventoryItemStatus, "failed">,
  previous: InventoryRunItemRow | null
) {
  const timestamp = new Date().toISOString();
  const deltas = itemCounterDeltas(previous?.status, status);
  await db.batch([
    db
      .prepare(
        `INSERT INTO inventory_run_items
          (run_id,batch_id,source_job_id,job_id,content_hash,status,
           error_detail,processed_at)
         VALUES (?,?,?,?,?,?,'',?)
         ON CONFLICT(run_id,source_job_id) DO UPDATE SET
           batch_id=excluded.batch_id,job_id=excluded.job_id,
           content_hash=excluded.content_hash,status=excluded.status,
           error_detail='',processed_at=excluded.processed_at`
      )
      .bind(runId, batchId, jobId, jobId, contentHash, status, timestamp),
    counterUpdateStatement(db, runId, deltas, timestamp),
  ]);
}

async function recordInventoryItemFailure(
  db: D1Database,
  runId: string,
  batchId: string,
  job: InventoryJob,
  message: string
) {
  const contentHash = await inventoryJobContentHash(job);
  const previous = await readRunItem(db, runId, job.id);
  if (previous && previous.content_hash !== contentHash) {
    throw new InventoryRunError(
      "Source job changed inside an immutable inventory snapshot",
      409
    );
  }
  const timestamp = new Date().toISOString();
  const deltas = itemCounterDeltas(previous?.status, "failed");
  await db.batch([
    db
      .prepare(
        `INSERT INTO inventory_run_items
          (run_id,batch_id,source_job_id,job_id,content_hash,status,
           error_detail,processed_at)
         VALUES (?,?,?,?,?,'failed',?,?)
         ON CONFLICT(run_id,source_job_id) DO UPDATE SET
           batch_id=excluded.batch_id,job_id=excluded.job_id,
           status='failed',error_detail=excluded.error_detail,
           processed_at=excluded.processed_at`
      )
      .bind(
        runId,
        batchId,
        job.id,
        job.id,
        contentHash,
        message.slice(0, 4000),
        timestamp
      ),
    counterUpdateStatement(db, runId, deltas, timestamp),
  ]);
}

function counterUpdateStatement(
  db: D1Database,
  runId: string,
  deltas: ReturnType<typeof itemCounterDeltas>,
  timestamp: string
) {
  return db
    .prepare(
      `UPDATE inventory_runs SET
         processed_count=processed_count+?,
         upserted_count=upserted_count+?,
         unchanged_count=unchanged_count+?,
         failed_count=failed_count+?,
         status=CASE WHEN status='partial' THEN 'ingesting' ELSE status END,
         updated_at=?
       WHERE id=?`
    )
    .bind(
      deltas.processed,
      deltas.upserted,
      deltas.unchanged,
      deltas.failed,
      timestamp,
      runId
    );
}

function itemCounterDeltas(
  previous: InventoryItemStatus | undefined,
  next: InventoryItemStatus
) {
  return {
    failed: Number(next === "failed") - Number(previous === "failed"),
    processed: previous ? 0 : 1,
    unchanged: Number(next === "unchanged") - Number(previous === "unchanged"),
    upserted: Number(next === "upserted") - Number(previous === "upserted"),
  };
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
      `SELECT COUNT(*) count FROM jobs j
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
                JOIN jobs j ON j.id=t.job_id
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
              JOIN jobs j ON j.id=t.job_id
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
            SELECT j.id FROM jobs j
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
            SELECT j.id FROM jobs j
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
        `UPDATE jobs SET inventory_status='closed',inventory_run_id=?
          WHERE inventory_source_id=? AND inventory_status='active'
            AND NOT EXISTS (
              SELECT 1 FROM inventory_run_items item
               WHERE item.run_id=? AND item.job_id=jobs.id
                 AND item.status IN ('upserted','unchanged')
            )`
      )
      .bind(run.id, run.source_id, run.id),
  ]);
  return closedCount;
}

async function readInventorySource(db: D1Database, sourceId: string) {
  const source = await db
    .prepare(
      `SELECT id,completeness_policy FROM inventory_sources
        WHERE id=? AND status='active'`
    )
    .bind(sourceId)
    .first<InventorySourceRow>();
  if (!source) {
    throw new InventoryRunError("Inventory source is not registered", 404);
  }
  return source;
}

async function readOwnedRun(
  db: D1Database,
  runner: AgentRunnerContext,
  runId: string
) {
  const row = await db
    .prepare(
      `SELECT id,source_id,started_by_user_id,runner_id,status,
              source_total_count,source_active_count,processed_count,
              upserted_count,unchanged_count,failed_count
         FROM inventory_runs WHERE id=?`
    )
    .bind(runId)
    .first<InventoryRunRow>();
  if (!row) {
    throw new InventoryRunError("Inventory run was not found", 404);
  }
  assertRunOwner(row, runner);
  return row;
}

function readRunItem(db: D1Database, runId: string, sourceJobId: string) {
  return db
    .prepare(
      `SELECT content_hash,status FROM inventory_run_items
        WHERE run_id=? AND source_job_id=?`
    )
    .bind(runId, sourceJobId)
    .first<InventoryRunItemRow>();
}

function compensationSourceFor(job: InventoryJob) {
  if (job.compensation.confidence === "unknown") {
    return "unknown";
  }
  return job.compensation.confidence === "exact"
    ? "listing-field"
    : "listing-description";
}

function assertRunOwner(run: InventoryRunRow, runner: AgentRunnerContext) {
  if (
    run.runner_id !== runner.id ||
    run.started_by_user_id !== runner.user.id
  ) {
    throw new InventoryRunError(
      "Inventory run belongs to another paired runner",
      403
    );
  }
}

function assertRunCounts(run: InventoryRunRow, input: InventoryRunStart) {
  if (
    run.source_total_count !== input.sourceTotalCount ||
    run.source_active_count !== input.sourceActiveCount
  ) {
    throw new InventoryRunError(
      "Inventory snapshot key was reused with different source counts",
      409
    );
  }
}

function toJobImport(job: InventoryJob): JobImport {
  return {
    applyEmail: job.applyEmail,
    applyUrl: job.applyUrl,
    board: job.board,
    company: job.company,
    contactName: job.contactName,
    country: job.country,
    description: job.description,
    employerId: "",
    id: job.id,
    location: job.location,
    marketSegments: job.marketSegments,
    messageRoute: "advertised_position",
    opportunityScope: "unknown",
    priority: 0,
    salary: job.salary,
    sourceReference: job.sourceReference,
    sourceUrl: job.sourceUrl,
    title: job.title,
  };
}

function toInventoryRun(row: InventoryRunRow) {
  return {
    failedCount: Number(row.failed_count),
    id: row.id,
    processedCount: Number(row.processed_count),
    sourceActiveCount: Number(row.source_active_count),
    sourceId: row.source_id,
    sourceTotalCount: Number(row.source_total_count),
    status: row.status,
    unchangedCount: Number(row.unchanged_count),
    upsertedCount: Number(row.upserted_count),
  };
}
