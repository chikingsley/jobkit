import { inventoryJobContentHash } from "../../../src/features/inventory/content";
import type { InventoryJob } from "../../../src/features/inventory/schema";
import { upsertApplicationRoutes } from "../../repositories/application-routes";
import type { JobImport } from "../../schemas";
import {
  type InventoryItemStatus,
  InventoryRunError,
  type InventoryRunItemRow,
  type InventoryRunRow,
} from "./contracts";

export async function ingestInventoryJob(
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

export async function recordInventoryItemFailure(
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
