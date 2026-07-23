import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../../../src/features/inventory/content";
import {
  materialCloneSignal,
  sourceReferenceSignal,
} from "../../../../../src/features/public/identity-signals";
import { canonicalSha256 } from "../../../../../worker/services/public-projection/hash";
import { jobFixture } from "./jobfixture";

export interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

export interface PositionFixture {
  inputHash: string;
  itemId: string;
  listingId: string;
  positionKey: string;
  sourcePositionId: string;
}

export const testEnv = env as TestEnv;

export const timestamp = "2026-07-22T12:00:00.000Z";

export async function seedRun(runId: string) {
  await testEnv.DB.prepare(
    `INSERT INTO public_projection_runs (
      id,mode,request_key,scope_json,contract_version,projector_version,
      policy_heads_hash,source_watermark_json,status,selection_complete,
      started_at,requested_at,updated_at
    ) VALUES (
      ?,'shadow',?,'{"boards":[],"listingIds":[]}',1,'projector-v1',?,
      '{"materialChangedAt":"2026-07-22T12:00:00.000Z",\
        "maxListingId":"z"}','running',1,?,?,?
    )`
  )
    .bind(
      runId,
      `request:${runId}`,
      "a".repeat(64),
      timestamp,
      timestamp,
      timestamp
    )
    .run();
}

export async function seedStablePosition(input: {
  itemId: string;
  listingId: string;
  positionKey: string;
  runId: string;
  sourcePositionId: string;
  sourceReference: string;
}) {
  await seedListing(input.listingId, input.sourceReference);
  await seedListingItem(input.runId, input.listingId);
  return seedPositionItem(input);
}

export async function seedListing(listingId: string, sourceReference: string) {
  const job = jobFixture(listingId, sourceReference);
  const materialJson = serializeInventoryJobMaterial(job);
  const materialHash = await inventoryJobMaterialHash(job);
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_listings (
        id,board,title,company,salary,description,apply_url,first_seen_at,
        updated_at,inventory_status,material_hash,material_hash_version,
        material_version,material_changed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'active',?,1,1,?)`
    ).bind(
      listingId,
      job.board,
      job.title,
      job.company,
      job.salary,
      job.description,
      job.applyUrl,
      timestamp,
      timestamp,
      materialHash,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO job_listing_versions (
        listing_id,material_version,material_hash,material_hash_version,
        material_json,created_at
      ) VALUES (?,1,?,1,?,?)`
    ).bind(listingId, materialHash, materialJson, timestamp),
  ]);
}

export async function seedListingItem(runId: string, listingId: string) {
  const row = await testEnv.DB.prepare(
    "SELECT material_hash FROM job_listings WHERE id=?"
  )
    .bind(listingId)
    .first<{ material_hash: string }>();
  await testEnv.DB.prepare(
    `INSERT INTO public_projection_listing_items (
      id,run_id,listing_id,material_version,input_hash,stage,status,
      checkpoint_json,created_at,completed_at,updated_at
    ) VALUES (?, ?, ?, 1, ?, 'completed','completed','{}', ?, ?, ?)`
  )
    .bind(
      `listing-item:${runId}:${listingId}`,
      runId,
      listingId,
      row?.material_hash,
      timestamp,
      timestamp,
      timestamp
    )
    .run();
}

export async function seedPositionItem(input: {
  itemId: string;
  listingId: string;
  positionKey: string;
  runId: string;
  sourcePositionId: string;
  sourceReference: string;
}) {
  const material = await testEnv.DB.prepare(
    `SELECT listing.material_hash,version.material_json
       FROM job_listings listing
       JOIN job_listing_versions version
         ON version.listing_id=listing.id
        AND version.material_version=listing.material_version
      WHERE listing.id=?`
  )
    .bind(input.listingId)
    .first<{ material_hash: string; material_json: string }>();
  if (!material) {
    throw new Error(`Missing listing fixture ${input.listingId}`);
  }
  const signals = await Promise.all([
    materialCloneSignal(material.material_hash),
    sourceReferenceSignal({
      sourceKey: "tefl",
      sourceReference: input.sourceReference,
    }),
  ]);
  signals.sort((left, right) => left.kind.localeCompare(right.kind, "en"));
  const inputHash = await canonicalSha256({
    itemId: input.itemId,
    listingId: input.listingId,
  });
  const checkpoint = JSON.stringify({
    identity: {
      signals,
      sourcePosition: {
        id: input.sourcePositionId,
        positionKey: input.positionKey,
      },
      state: "derived",
    },
    listingInputHash: material.material_hash,
  });
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_source_positions (
        id,listing_id,source_key,position_key,position_kind,created_at
      ) VALUES (?,?,'tefl',?, ?, ?)`
    ).bind(
      input.sourcePositionId,
      input.listingId,
      input.positionKey,
      input.positionKey === "direct" ? "direct" : "extracted",
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_position_items (
        id,run_id,listing_item_id,source_position_id,input_hash,stage,status,
        checkpoint_json,created_at,updated_at
      ) VALUES (?, ?, ?, ?, ?, 'canonical_resolution','queued',?, ?, ?)`
    ).bind(
      input.itemId,
      input.runId,
      `listing-item:${input.runId}:${input.listingId}`,
      input.sourcePositionId,
      inputHash,
      checkpoint,
      timestamp,
      timestamp
    ),
  ]);
  return {
    inputHash,
    itemId: input.itemId,
    listingId: input.listingId,
    positionKey: input.positionKey,
    sourcePositionId: input.sourcePositionId,
  } satisfies PositionFixture;
}

export async function seedBlockedPosition(runId: string) {
  const listingId = `blocked-listing:${runId}`;
  await seedListing(listingId, "blocked-reference");
  await seedListingItem(runId, listingId);
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_source_positions (
        id,listing_id,source_key,position_key,position_kind,created_at
      ) VALUES (?,?,'tefl','direct','direct',?)`
    ).bind(`blocked-source:${runId}`, listingId, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_position_items (
        id,run_id,listing_item_id,source_position_id,input_hash,stage,status,
        checkpoint_json,error_code,error_detail,created_at,completed_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'identity','blocked',
        '{"identity":{"state":"blocked"}}','identity_seal_mismatch',
        'blocked fixture', ?, ?, ?)`
    ).bind(
      `blocked-item:${runId}`,
      runId,
      `listing-item:${runId}:${listingId}`,
      `blocked-source:${runId}`,
      "b".repeat(64),
      timestamp,
      timestamp,
      timestamp
    ),
  ]);
}

export async function seedIdentityPosition(runId: string) {
  const listingId = `identity-listing:${runId}`;
  await seedListing(listingId, "identity-reference");
  await seedListingItem(runId, listingId);
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_source_positions (
        id,listing_id,source_key,position_key,position_kind,created_at
      ) VALUES (?,?,'tefl','direct','direct',?)`
    ).bind(`identity-source:${runId}`, listingId, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_position_items (
        id,run_id,listing_item_id,source_position_id,input_hash,stage,status,
        checkpoint_json,created_at,updated_at
      ) VALUES (?, ?, ?, ?, ?, 'identity','queued','{}', ?, ?)`
    ).bind(
      `identity-item:${runId}`,
      runId,
      `listing-item:${runId}:${listingId}`,
      `identity-source:${runId}`,
      "c".repeat(64),
      timestamp,
      timestamp
    ),
  ]);
}

export async function seedPublicJob(position: PositionFixture) {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO public_jobs (id,created_at) VALUES ('existing-public-job',?)"
    ).bind(timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_aliases (public_job_id,slug,created_at)
       VALUES ('existing-public-job','existing-public-job',?)`
    ).bind(timestamp),
    publicVersionStatement(1, null, "public-content-v1"),
  ]);
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO public_job_heads (
        public_job_id,current_version,updated_at
      ) VALUES ('existing-public-job',1,?)`
    ).bind(timestamp),
    testEnv.DB.prepare(
      `INSERT INTO job_source_position_mapping_versions (
        source_position_id,version,predecessor_version,listing_id,
        listing_material_version,mapping_state,public_job_id,reason_code,
        mapping_hash,idempotency_key,created_at
      ) VALUES (?,1,NULL,?,1,'mapped','existing-public-job','initial',
        ?, 'mapping-v1', ?)`
    ).bind(
      position.sourcePositionId,
      position.listingId,
      "d".repeat(64),
      timestamp
    ),
  ]);
  await testEnv.DB.prepare(
    `INSERT INTO job_source_position_mapping_heads (
      source_position_id,current_version,updated_at
    ) VALUES (?,1,?)`
  )
    .bind(position.sourcePositionId, timestamp)
    .run();
}

export async function advancePublicVersion() {
  await publicVersionStatement(2, 1, "public-content-v2").run();
  await testEnv.DB.prepare(
    `UPDATE public_job_heads SET current_version=2,updated_at=?
      WHERE public_job_id='existing-public-job'`
  )
    .bind("2026-07-22T13:00:00.000Z")
    .run();
}

export function publicVersionStatement(
  version: number,
  predecessorVersion: number | null,
  idempotencyKey: string
) {
  return testEnv.DB.prepare(
    `INSERT INTO public_job_versions (
      public_job_id,version,predecessor_version,canonical_slug,title,
      organization_id,organization_name,organization_resolution_state,
      workplace_type,date_posted,date_posted_provenance,valid_through,
      valid_through_provenance,employment_types_json,compensation_json,
      description_html,public_content_hash,public_content_hash_version,
      material_changed_at,content_schema_version,producer_kind,producer_id,
      idempotency_key,created_at
    ) VALUES (
      'existing-public-job',?,?, 'existing-public-job','English Teacher',
      NULL,'Example School','unresolved','unknown',NULL,'unknown',NULL,
      'unknown','[]','{}','Description',?,1,?,1,'deterministic',
      'duplicate-test',?,?
    )`
  ).bind(
    version,
    predecessorVersion,
    version.toString(16).padStart(64, "0"),
    timestamp,
    idempotencyKey,
    timestamp
  );
}
