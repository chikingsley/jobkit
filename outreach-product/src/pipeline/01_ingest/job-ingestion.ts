import { excluded, getDb } from "../../../worker/db/client";
import {
  jobListings,
  jobListingVersions,
} from "../../../worker/db/schema/jobs";
import { upsertApplicationRoutes } from "../../../worker/repositories/application-routes";
import type { JobImport } from "../../../worker/schemas";
import {
  INVENTORY_JOB_MATERIAL_HASH_VERSION,
  inventoryJobContentHash,
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../features/inventory/content";
import type { InventoryJob } from "../../features/inventory/schema";
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
              source_expiry_date_raw=?,source_expiry_date_provenance=?,
              source_fields_json=?
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
      job.fields ? JSON.stringify(job.fields) : "",
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
  const {
    materialChangedAt,
    materialHash,
    materialJson,
    materialVersion,
    timestamp,
    transportHash,
    updatedAt,
  } = material;
  const listing = {
    applyUrl: job.applyUrl,
    board: job.board,
    company: job.company,
    compensationAmountMax: job.compensation.amountMaximum,
    compensationAmountMin: job.compensation.amountMinimum,
    compensationConfidence: job.compensation.confidence,
    compensationCurrency: job.compensation.currency,
    compensationDisplay: job.compensation.display,
    compensationNotesJson: "[]",
    compensationPeriod: job.compensation.period,
    compensationQualifier: job.compensation.qualifier,
    compensationSource: compensationSourceFor(job),
    contactName: job.contactName,
    country: job.country,
    description: job.description,
    employerId: job.employerId,
    firstSeenAt: timestamp,
    id: job.id,
    inventoryRunId: run.id,
    inventorySourceId: run.source_id,
    inventoryStatus: "active",
    location: job.location,
    marketSegmentsJson: JSON.stringify(job.marketSegments),
    materialChangedAt,
    materialHash,
    materialHashVersion: INVENTORY_JOB_MATERIAL_HASH_VERSION,
    materialVersion,
    messageRoute: "advertised_position",
    opportunityScope: "unknown",
    salary: job.salary,
    sourceContentHash: transportHash,
    sourceExpiryDate: job.sourceDates.expires.date,
    sourceExpiryDateProvenance: job.sourceDates.expires.provenance,
    sourceExpiryDateRaw: job.sourceDates.expires.raw,
    sourceFieldsJson: job.fields ? JSON.stringify(job.fields) : "",
    sourceLastSeenAt: job.lastSeenAt,
    sourcePostedDate: job.sourceDates.posted.date,
    sourcePostedDateProvenance: job.sourceDates.posted.provenance,
    sourcePostedDateRaw: job.sourceDates.posted.raw,
    sourceReference: job.sourceReference,
    sourceUrl: job.sourceUrl,
    title: job.title,
    updatedAt,
  };
  // firstSeenAt, opportunityScope, and messageRoute are set once on insert and
  // deliberately survive later refreshes. inventoryStatus is forced back to
  // active because seeing the listing again is what proves it is live.
  const refreshed = {
    applyUrl: excluded(jobListings.applyUrl),
    board: excluded(jobListings.board),
    company: excluded(jobListings.company),
    compensationAmountMax: excluded(jobListings.compensationAmountMax),
    compensationAmountMin: excluded(jobListings.compensationAmountMin),
    compensationConfidence: excluded(jobListings.compensationConfidence),
    compensationCurrency: excluded(jobListings.compensationCurrency),
    compensationDisplay: excluded(jobListings.compensationDisplay),
    compensationNotesJson: excluded(jobListings.compensationNotesJson),
    compensationPeriod: excluded(jobListings.compensationPeriod),
    compensationQualifier: excluded(jobListings.compensationQualifier),
    compensationSource: excluded(jobListings.compensationSource),
    contactName: excluded(jobListings.contactName),
    country: excluded(jobListings.country),
    description: excluded(jobListings.description),
    employerId: excluded(jobListings.employerId),
    inventoryRunId: excluded(jobListings.inventoryRunId),
    inventorySourceId: excluded(jobListings.inventorySourceId),
    inventoryStatus: "active",
    location: excluded(jobListings.location),
    marketSegmentsJson: excluded(jobListings.marketSegmentsJson),
    materialChangedAt: excluded(jobListings.materialChangedAt),
    materialHash: excluded(jobListings.materialHash),
    materialHashVersion: excluded(jobListings.materialHashVersion),
    materialVersion: excluded(jobListings.materialVersion),
    salary: excluded(jobListings.salary),
    sourceContentHash: excluded(jobListings.sourceContentHash),
    sourceExpiryDate: excluded(jobListings.sourceExpiryDate),
    sourceExpiryDateProvenance: excluded(
      jobListings.sourceExpiryDateProvenance
    ),
    sourceExpiryDateRaw: excluded(jobListings.sourceExpiryDateRaw),
    sourceFieldsJson: excluded(jobListings.sourceFieldsJson),
    sourceLastSeenAt: excluded(jobListings.sourceLastSeenAt),
    sourcePostedDate: excluded(jobListings.sourcePostedDate),
    sourcePostedDateProvenance: excluded(
      jobListings.sourcePostedDateProvenance
    ),
    sourcePostedDateRaw: excluded(jobListings.sourcePostedDateRaw),
    sourceReference: excluded(jobListings.sourceReference),
    sourceUrl: excluded(jobListings.sourceUrl),
    title: excluded(jobListings.title),
    updatedAt: excluded(jobListings.updatedAt),
  };
  const client = getDb(db);
  await client.batch([
    client
      .insert(jobListings)
      .values(listing)
      .onConflictDoUpdate({ set: refreshed, target: jobListings.id }),
    client.insert(jobListingVersions).values({
      createdAt: timestamp,
      inventoryRunId: run.id,
      listingId: job.id,
      materialHash,
      materialHashVersion: INVENTORY_JOB_MATERIAL_HASH_VERSION,
      materialJson,
      materialVersion,
      sourceExpiryDate: job.sourceDates.expires.date,
      sourceExpiryDateProvenance: job.sourceDates.expires.provenance,
      sourceExpiryDateRaw: job.sourceDates.expires.raw,
      sourcePostedDate: job.sourceDates.posted.date,
      sourcePostedDateProvenance: job.sourceDates.posted.provenance,
      sourcePostedDateRaw: job.sourceDates.posted.raw,
    }),
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
