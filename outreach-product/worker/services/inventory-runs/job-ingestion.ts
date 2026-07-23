import {
  INVENTORY_JOB_MATERIAL_HASH_VERSION,
  inventoryJobContentHash,
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../src/features/inventory/content";
import type { InventoryJob } from "../../../src/features/inventory/schema";
import { upsertApplicationRoutes } from "../../repositories/application-routes";
import type { JobImport } from "../../schemas";
import {
  type InventoryItemStatus,
  InventoryRunError,
  type InventoryRunItemRow,
  type InventoryRunRow,
} from "./contracts";

function repeatedRunItemIsComplete(
  previousItem: InventoryRunItemRow | null,
  transportHash: string
) {
  if (previousItem?.content_hash === undefined) {
    return false;
  }
  if (previousItem.content_hash !== transportHash) {
    throw new InventoryRunError(
      "Source job changed inside an immutable inventory snapshot",
      409
    );
  }
  return previousItem.status !== "failed";
}

export async function ingestInventoryJob(
  db: D1Database,
  run: InventoryRunRow,
  batchId: string,
  job: InventoryJob
) {
  const transportHash = await inventoryJobContentHash(job);
  const materialHash = await inventoryJobMaterialHash(job);
  const materialJson = serializeInventoryJobMaterial(job);
  const previousItem = await readRunItem(db, run.id, job.id);
  if (repeatedRunItemIsComplete(previousItem, transportHash)) {
    return;
  }

  const existing = await db
    .prepare(
      `SELECT inventory_source_id,material_hash,material_hash_version,
              material_version,material_changed_at,updated_at
         FROM job_listings WHERE id=?`
    )
    .bind(job.id)
    .first<{
      inventory_source_id: string | null;
      material_hash: string;
      material_hash_version: number;
      material_version: number;
      material_changed_at: string;
      updated_at: string;
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
    existing?.material_hash_version === INVENTORY_JOB_MATERIAL_HASH_VERSION &&
    existing.material_hash === materialHash
      ? "unchanged"
      : "upserted";
  const timestamp = new Date().toISOString();
  if (outcome === "unchanged") {
    await updateInventoryFreshness(db, run, job, transportHash);
  } else {
    const isHashUpgrade = existing?.material_hash_version === 0;
    await upsertInventoryJob(db, run, job, {
      materialChangedAt: isHashUpgrade
        ? existing.material_changed_at || existing.updated_at
        : timestamp,
      materialHash,
      materialJson,
      materialVersion: (existing?.material_version ?? 0) + 1,
      timestamp,
      transportHash,
      updatedAt: isHashUpgrade ? existing.updated_at : timestamp,
    });
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
    transportHash,
    outcome,
    previousItem
  );
}

async function updateInventoryFreshness(
  db: D1Database,
  run: InventoryRunRow,
  job: InventoryJob,
  transportHash: string
) {
  await db
    .prepare(
      `UPDATE job_listings
          SET inventory_source_id=?,inventory_status='active',
              source_last_seen_at=?,source_content_hash=?,inventory_run_id=?,
              source_posted_date=?,source_posted_date_raw=?,
              source_posted_date_provenance=?,source_expiry_date=?,
              source_expiry_date_raw=?,source_expiry_date_provenance=?
        WHERE id=?`
    )
    .bind(
      run.source_id,
      job.lastSeenAt,
      transportHash,
      run.id,
      job.sourceDates.posted.date,
      job.sourceDates.posted.raw,
      job.sourceDates.posted.provenance,
      job.sourceDates.expires.date,
      job.sourceDates.expires.raw,
      job.sourceDates.expires.provenance,
      job.id
    )
    .run();
}

async function upsertInventoryJob(
  db: D1Database,
  run: InventoryRunRow,
  job: InventoryJob,
  material: {
    materialHash: string;
    materialJson: string;
    materialChangedAt: string;
    materialVersion: number;
    timestamp: string;
    transportHash: string;
    updatedAt: string;
  }
) {
  const compensationSource = compensationSourceFor(job);
  const {
    materialChangedAt,
    materialHash,
    materialJson,
    materialVersion,
    timestamp,
    transportHash,
    updatedAt,
  } = material;
  await db.batch([
    db
      .prepare(
        `INSERT INTO job_listings (
        id,board,title,company,contact_name,country,location,salary,description,
        source_url,apply_url,employer_id,source_reference,first_seen_at,updated_at,
        compensation_display,compensation_amount_min,compensation_amount_max,
        compensation_currency,compensation_period,compensation_qualifier,
        compensation_source,compensation_confidence,compensation_notes_json,
        opportunity_scope,market_segments_json,message_route,
        inventory_source_id,inventory_status,source_last_seen_at,
        source_content_hash,inventory_run_id,source_posted_date,
        source_posted_date_raw,source_posted_date_provenance,source_expiry_date,
        source_expiry_date_raw,source_expiry_date_provenance,material_hash,
        material_hash_version,material_version,material_changed_at
      ) VALUES (
        ?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,?,?,?
      )
      ON CONFLICT(id) DO UPDATE SET
        board=excluded.board,title=excluded.title,company=excluded.company,
        contact_name=excluded.contact_name,country=excluded.country,
        location=excluded.location,salary=excluded.salary,
        description=excluded.description,source_url=excluded.source_url,
        apply_url=excluded.apply_url,employer_id=excluded.employer_id,
        source_reference=excluded.source_reference,
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
        inventory_run_id=excluded.inventory_run_id,
        source_posted_date=excluded.source_posted_date,
        source_posted_date_raw=excluded.source_posted_date_raw,
        source_posted_date_provenance=excluded.source_posted_date_provenance,
        source_expiry_date=excluded.source_expiry_date,
        source_expiry_date_raw=excluded.source_expiry_date_raw,
        source_expiry_date_provenance=excluded.source_expiry_date_provenance,
        material_hash=excluded.material_hash,
        material_hash_version=excluded.material_hash_version,
        material_version=excluded.material_version,
        material_changed_at=excluded.material_changed_at`
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
        job.employerId,
        job.sourceReference,
        timestamp,
        updatedAt,
        job.compensation.display,
        job.compensation.amountMinimum,
        job.compensation.amountMaximum,
        job.compensation.currency,
        job.compensation.period,
        job.compensation.qualifier,
        compensationSource,
        job.compensation.confidence,
        "[]",
        "unknown",
        JSON.stringify(job.marketSegments),
        "advertised_position",
        run.source_id,
        "active",
        job.lastSeenAt,
        transportHash,
        run.id,
        job.sourceDates.posted.date,
        job.sourceDates.posted.raw,
        job.sourceDates.posted.provenance,
        job.sourceDates.expires.date,
        job.sourceDates.expires.raw,
        job.sourceDates.expires.provenance,
        materialHash,
        INVENTORY_JOB_MATERIAL_HASH_VERSION,
        materialVersion,
        materialChangedAt
      ),
    db
      .prepare(
        `INSERT INTO job_listing_versions (
          listing_id,material_version,material_hash,material_hash_version,
          material_json,source_posted_date,source_posted_date_raw,
          source_posted_date_provenance,source_expiry_date,
          source_expiry_date_raw,source_expiry_date_provenance,
          inventory_run_id,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        job.id,
        materialVersion,
        materialHash,
        INVENTORY_JOB_MATERIAL_HASH_VERSION,
        materialJson,
        job.sourceDates.posted.date,
        job.sourceDates.posted.raw,
        job.sourceDates.posted.provenance,
        job.sourceDates.expires.date,
        job.sourceDates.expires.raw,
        job.sourceDates.expires.provenance,
        run.id,
        timestamp
      ),
  ]);
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
    employerId: job.employerId,
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
