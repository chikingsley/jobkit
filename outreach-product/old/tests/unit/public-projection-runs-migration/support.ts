import { Database } from "bun:sqlite";

import { readFileSync } from "node:fs";

import { resolve } from "node:path";

export const phaseBMigration = readFileSync(
  resolve(import.meta.dir, "../../../migrations/0048_public_job_entities.sql"),
  "utf8"
);

export const phaseCMigration = readFileSync(
  resolve(
    import.meta.dir,
    "../../../migrations/0049_public_projection_runs.sql"
  ),
  "utf8"
);

export const phaseD2Migration = readFileSync(
  resolve(
    import.meta.dir,
    "../../../migrations/0051_public_projection_duplicate_comparisons.sql"
  ),
  "utf8"
);

export const hashA = "a".repeat(64);

export const hashB = "b".repeat(64);

export const now = "2026-07-22T12:00:00.000Z";

export const publicViews = [
  "public_job_route_content",
  "public_browse_jobs",
  "organic_index_jobs",
  "job_posting_jobs",
  "public_job_route_resolutions",
] as const;

export function createDatabase(populated = false) {
  const database = new Database(":memory:", { strict: true });
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE agent_task_runs (id TEXT PRIMARY KEY);
    CREATE TABLE organizations (id TEXT PRIMARY KEY);
    CREATE TABLE job_listings (
      id TEXT PRIMARY KEY,
      board TEXT NOT NULL,
      source_url TEXT NOT NULL DEFAULT '',
      inventory_status TEXT NOT NULL DEFAULT 'active',
      material_hash TEXT NOT NULL DEFAULT '${hashA}',
      material_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE job_listing_versions (
      listing_id TEXT NOT NULL REFERENCES job_listings(id) ON DELETE RESTRICT,
      material_version INTEGER NOT NULL,
      material_hash TEXT NOT NULL DEFAULT '${hashA}',
      material_json TEXT NOT NULL DEFAULT '{"sourceReference":""}',
      PRIMARY KEY (listing_id,material_version)
    );
    CREATE TABLE application_routes (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      status TEXT NOT NULL
    );
  `);
  if (populated) {
    insertListing(database, "listing-existing", "seriousteachers");
  }
  database.exec(phaseBMigration);
  database.exec(phaseCMigration);
  database.exec(phaseD2Migration);
  return database;
}

export function insertListing(
  database: Database,
  listingId = "listing-1",
  board = "seriousteachers"
) {
  database
    .query(
      `INSERT INTO job_listings (
        id,board,source_url,inventory_status,material_version
      ) VALUES ($id,$board,$sourceUrl,'active',1)`
    )
    .run({
      board,
      id: listingId,
      sourceUrl: `https://example.test/jobs/${listingId}`,
    });
  database
    .query(
      `INSERT INTO job_listing_versions (
        listing_id,material_version,material_hash
      ) VALUES ($id,1,$hash)`
    )
    .run({ hash: hashA, id: listingId });
}

export function insertRun(database: Database, runId = "run-1") {
  database
    .query(
      `INSERT INTO public_projection_runs (
        id,requested_by_user_id,mode,request_key,scope_json,contract_version,
        projector_version,policy_heads_hash,source_watermark_json,status,
        requested_at,updated_at
      ) VALUES (
        $id,NULL,'shadow',$requestKey,'{"boards":["seriousteachers"]}',1,
        'projector-v1',$hash,'{"inventoryRun":"inventory-1"}','queued',
        $now,$now
      )`
    )
    .run({
      hash: hashA,
      id: runId,
      now,
      requestKey: `request:${runId}`,
    });
}

export function insertListingItem(
  database: Database,
  listingId = "listing-1",
  itemId = "listing-item-1",
  runId = "run-1"
) {
  database
    .query(
      `INSERT INTO public_projection_listing_items (
        id,run_id,listing_id,material_version,input_hash,stage,status,
        created_at,updated_at
      ) VALUES (
        $id,$runId,$listingId,1,$hash,'selected','queued',$now,$now
      )`
    )
    .run({
      hash: hashA,
      id: itemId,
      listingId,
      now,
      runId,
    });
}

export function insertSourcePosition(
  database: Database,
  listingId = "listing-1",
  positionId = "position-1"
) {
  database
    .query(
      `INSERT INTO job_source_positions (
        id,listing_id,source_key,position_key,position_kind,created_at
      ) VALUES ($id,$listingId,'seriousteachers','direct','direct',$now)`
    )
    .run({ id: positionId, listingId, now });
}

export function insertPositionItem(
  database: Database,
  positionId = "position-1",
  itemId = "position-item-1",
  listingItemId = "listing-item-1",
  runId = "run-1"
) {
  database
    .query(
      `INSERT INTO public_projection_position_items (
        id,run_id,listing_item_id,source_position_id,input_hash,stage,status,
        created_at,updated_at
      ) VALUES (
        $id,$runId,$listingItemId,$positionId,$hash,'identity','queued',
        $now,$now
      )`
    )
    .run({
      hash: hashA,
      id: itemId,
      listingItemId,
      now,
      positionId,
      runId,
    });
}

export function insertPublicVersion(
  database: Database,
  publicJobId = "public-job-1"
) {
  database
    .query("INSERT INTO public_jobs (id,created_at) VALUES ($id,$now)")
    .run({ id: publicJobId, now });
  database
    .query(
      `INSERT INTO public_job_aliases (public_job_id,slug,created_at)
       VALUES ($id,$slug,$now)`
    )
    .run({ id: publicJobId, now, slug: `${publicJobId}-slug` });
  database
    .query(
      `INSERT INTO public_job_versions (
        public_job_id,version,predecessor_version,canonical_slug,title,
        organization_id,organization_name,organization_resolution_state,
        workplace_type,date_posted,date_posted_provenance,valid_through,
        valid_through_provenance,employment_types_json,compensation_json,
        description_html,public_content_hash,public_content_hash_version,
        material_changed_at,content_schema_version,producer_kind,producer_id,
        idempotency_key,created_at
      ) VALUES (
        $id,1,NULL,$slug,'English Teacher',NULL,'Example School','unresolved',
        'unknown',NULL,'unknown',NULL,'unknown','[]','{}','Description',
        $hash,1,$now,1,'deterministic','migration-test','content-v1',$now
      )`
    )
    .run({
      hash: hashB,
      id: publicJobId,
      now,
      slug: `${publicJobId}-slug`,
    });
  database
    .query(
      `INSERT INTO public_job_heads (public_job_id,current_version,updated_at)
       VALUES ($id,1,$now)`
    )
    .run({ id: publicJobId, now });
}

export function count(database: Database, table: string) {
  return (
    database.query(`SELECT COUNT(*) AS total FROM ${table}`).get() as {
      total: number;
    }
  ).total;
}
