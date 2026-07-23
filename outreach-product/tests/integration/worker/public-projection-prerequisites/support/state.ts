import {
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../../../src/features/inventory/content";
import type { InventoryJob } from "../../../../../src/features/inventory/schema";
import { advancePublicProjectionRuns } from "../../../../../worker/services/public-projection/advancement";
import { claimProjectionPosition } from "../../../../../worker/services/public-projection/position-items";
import {
  futureTimestamp,
  type SeededListing,
  testEnv,
  timestamp,
} from "./model";
import { advanceRunThroughExpansion, createRun } from "./runner";

export async function advanceListingMaterial(listing: SeededListing) {
  const successor: InventoryJob = {
    ...listing.job,
    description: `${listing.job.description} Updated cohort evidence.`,
  };
  const materialJson = serializeInventoryJobMaterial(successor);
  const materialHash = await inventoryJobMaterialHash(successor);
  const changedAt = "2026-07-22T13:00:00.000Z";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_listing_versions (
        listing_id,material_version,material_hash,material_hash_version,
        material_json,created_at
      ) VALUES (?,2,?,1,?,?)`
    ).bind(listing.job.id, materialHash, materialJson, changedAt),
    testEnv.DB.prepare(
      `UPDATE job_listings
          SET description=?,material_hash=?,material_hash_version=1,
              material_version=2,material_changed_at=?,updated_at=?
        WHERE id=?`
    ).bind(
      successor.description,
      materialHash,
      changedAt,
      changedAt,
      listing.job.id
    ),
  ]);
}

export async function seedResolvableOrganization() {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO organizations (
        id,country_code,country_name,name,identity_key,city,region,
        website_url,canonical_domain,market_segment,status,
        outreach_eligibility,evidence_url,last_verified_at,created_at,updated_at
      ) VALUES (
        'organization:example-school-ge','GE','Georgia','Example School',
        'name:example school|city:tbilisi','Tbilisi','','','','school','active',
        'eligible','https://example.test/about',?,?,?
      )`
    ).bind(timestamp, timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO organization_evidence (
        id,organization_id,source_kind,evidence_kind,evidence_status,
        source_label,source_url,observed_at,created_at
      ) VALUES (
        'organization-evidence:example-school-ge',
        'organization:example-school-ge','historical_workbook',
        'organization_profile','active','Example School',
        'https://example.test/about',?,?
      )`
    ).bind(timestamp, timestamp),
  ]);
}

export async function seedOrganizationForCity(city: string) {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO organizations (
        id,country_code,country_name,name,identity_key,city,market_segment,
        status,outreach_eligibility,created_at,updated_at
      ) VALUES (
        'organization:city-zero','GE','Georgia','Example School',
        'name:example school|city:city zero',?,'school','active','eligible',?,?
      )`
    ).bind(city, timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO organization_evidence (
        id,organization_id,source_kind,evidence_kind,evidence_status,
        source_label,source_url,observed_at,created_at
      ) VALUES (
        'organization-evidence:city-zero','organization:city-zero',
        'historical_workbook','organization_profile','active','Example School',
        'https://city-zero.example.test/about',?,?
      )`
    ).bind(timestamp, timestamp),
  ]);
}

export async function canonicalResolutionClaim(
  listing: SeededListing,
  cookie: string
) {
  const runId = await createRun(cookie, {
    boards: [],
    listingIds: [listing.job.id],
  });
  await advanceRunThroughExpansion();
  await advancePublicProjectionRuns(testEnv.DB);
  await advancePublicProjectionRuns(testEnv.DB);
  const claim = await claimProjectionPosition(
    testEnv.DB,
    runId,
    "canonical_resolution",
    futureTimestamp,
    { requireUnsealedCanonicalResolution: true }
  );
  if (!claim) {
    throw new Error("Expected a canonical-resolution claim");
  }
  return { claim, runId };
}

export async function seedExistingPublicGraph() {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO public_jobs (id,created_at) VALUES ('existing-public-job',?)"
    ).bind(timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_aliases (public_job_id,slug,created_at)
       VALUES ('existing-public-job','existing-public-job',?)`
    ).bind(timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_versions (
        public_job_id,version,predecessor_version,canonical_slug,title,
        organization_id,organization_name,organization_resolution_state,
        workplace_type,date_posted,date_posted_provenance,valid_through,
        valid_through_provenance,employment_types_json,compensation_json,
        description_html,public_content_hash,public_content_hash_version,
        material_changed_at,content_schema_version,producer_kind,producer_id,
        idempotency_key,created_at
      ) VALUES (
        'existing-public-job',1,NULL,'existing-public-job','Existing Teacher',
        NULL,'Existing School','unresolved','unknown',NULL,'unknown',NULL,
        'unknown','[]','{}','Existing description',?,1,?,1,'deterministic',
        'canonical-resolution-test','existing-public-v1',?
      )`
    ).bind("e".repeat(64), timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_heads (public_job_id,current_version,updated_at)
       VALUES ('existing-public-job',1,?)`
    ).bind(timestamp),
  ]);
}

export async function publicGraphSnapshot() {
  const tables = [
    "canonical_locations",
    "public_job_aliases",
    "public_job_heads",
    "public_job_versions",
    "public_jobs",
  ] as const;
  const entries = await Promise.all(
    tables.map(async (table) => {
      const rows = await testEnv.DB.prepare(`SELECT * FROM ${table}`).all<
        Record<string, unknown>
      >();
      return [table, rows.results] as const;
    })
  );
  const result = Object.fromEntries(entries) as Record<
    (typeof tables)[number],
    Record<string, unknown>[]
  >;
  return {
    canonicalLocations: result.canonical_locations,
    publicJobAliases: result.public_job_aliases,
    publicJobHeads: result.public_job_heads,
    publicJobs: result.public_jobs,
    publicJobVersions: result.public_job_versions,
  };
}
