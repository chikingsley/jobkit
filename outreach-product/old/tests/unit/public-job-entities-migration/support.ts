import { Database } from "bun:sqlite";

import { readdirSync, readFileSync } from "node:fs";

import { resolve } from "node:path";

export const migrationsDirectory = resolve(
  import.meta.dir,
  "../../../migrations"
);

export const timestamp = "2026-07-21T12:00:00.000Z";

export const hashA = "a".repeat(64);

export const hashB = "b".repeat(64);

export const hashC = "c".repeat(64);

export const privateColumnPattern =
  /candidate|contact|destination|document|draft|email|gmail|recipient|route_id/u;

export const databases: Database[] = [];

export function migratedDatabase(): Database {
  const database = new Database(":memory:", { strict: true });
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(migrationsDirectory)
    .filter((entry) => entry.endsWith(".sql"))
    .sort()) {
    database.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
  databases.push(database);
  return database;
}

export function policyRow(
  source_key: string,
  approval_state: string,
  publication_scope: string,
  input: { enabled?: 0 | 1; version?: number } = {}
) {
  return {
    approval_state,
    current_version: input.version ?? 1,
    publication_enabled: input.enabled ?? 0,
    publication_scope,
    source_key,
  };
}

export function publicCounts(database: Database) {
  const count = (view: string) =>
    Number(
      (
        database.query(`SELECT count(*) AS count FROM ${view}`).get() as {
          count: number;
        }
      ).count
    );
  return {
    browse: count("public_browse_jobs"),
    jobPosting: count("job_posting_jobs"),
    organic: count("organic_index_jobs"),
    routeContent: count("public_job_route_content"),
    routes: count("public_job_route_resolutions"),
  };
}

export function insertPolicyVersion(
  database: Database,
  input: {
    approval: "approved" | "pending" | "rejected" | "revoked";
    enabled: 0 | 1;
    fields?: string;
    predecessor: number;
    scope: "blocked" | "fact_summary" | "metadata_only";
    source: string;
    version: number;
  }
) {
  const fields =
    input.fields ??
    '["title","organization_name","locations","date_posted","valid_through","employment_types","compensation","description","source_name","source_url"]';
  database
    .query(
      `INSERT INTO source_publication_policy_versions(
         source_key,version,predecessor_version,approval_state,
         publication_scope,publication_enabled,allowed_fields_json,
         attribution_mode,max_verbatim_chars,source_origin_url,terms_url,
         terms_checked_at,robots_url,robots_checked_at,evidence_json,
         decision_note,policy_hash,idempotency_key,created_at
       ) SELECT source_key,?,?,?, ?,?,?,attribution_mode,0,
                source_origin_url,terms_url,terms_checked_at,robots_url,
                robots_checked_at,'{}','test policy',?,?,'${timestamp}'
           FROM source_publication_policy_versions
          WHERE source_key=? AND version=?`
    )
    .run(
      input.version,
      input.predecessor,
      input.approval,
      input.scope,
      input.enabled,
      fields,
      hashB,
      `policy-v${input.version}`,
      input.source,
      input.predecessor
    );
}

export function seededPublishedDatabase(): Database {
  const database = migratedDatabase();
  seedListing(database);
  seedOrganization(database);
  database.exec(
    `INSERT INTO canonical_locations(
       id,resolution_state,input_label,display_name,country_code,region,
       locality,provider,provider_place_id,latitude,longitude,
       resolution_evidence_json,created_at,updated_at
     ) VALUES(
       'loc-1','resolved','Seoul','Seoul, South Korea','KR','','Seoul',
       'mapbox','place.1',37.5,127.0,'{}','${timestamp}','${timestamp}'
     );
     INSERT INTO public_jobs(id,created_at) VALUES('pub-1','${timestamp}');
     INSERT INTO public_job_aliases(public_job_id,slug,created_at)
     VALUES('pub-1','english-teacher-seoul','${timestamp}');
     INSERT INTO public_job_versions(
       public_job_id,version,predecessor_version,canonical_slug,title,
       organization_id,organization_name,organization_resolution_state,
       workplace_type,date_posted,date_posted_provenance,valid_through,
       valid_through_provenance,employment_types_json,compensation_json,
       description_html,public_content_hash,public_content_hash_version,
       material_changed_at,content_schema_version,producer_kind,producer_id,
       idempotency_key,created_at
     ) VALUES(
       'pub-1',1,NULL,'english-teacher-seoul','English teacher','org-1',
       'Example School','resolved','onsite','2026-07-01','employer-original',
       '2026-12-31','employer-original','["FULL_TIME"]','{}',
       '<p>Teach English in Seoul.</p>','${hashC}',1,'${timestamp}',1,
       'deterministic','test','content-v1','${timestamp}'
     );
     INSERT INTO public_job_version_locations(
       public_job_id,public_job_version,ordinal,location_role,location_id,
       resolution_state,display_name,country_code,region,locality,postal_code,
       location_json,created_at
     ) VALUES(
       'pub-1',1,0,'worksite','loc-1','resolved','Seoul, South Korea','KR',
       '','Seoul','','{}','${timestamp}'
     );
     INSERT INTO public_job_heads(public_job_id,current_version,updated_at)
     VALUES('pub-1',1,'${timestamp}');
     INSERT INTO job_source_positions(
       id,listing_id,source_key,position_key,position_kind,created_at
     ) VALUES(
       'pos-1','listing-1','eslcafe-modern','direct','direct','${timestamp}'
     );
     INSERT INTO job_source_position_mapping_versions(
       source_position_id,version,predecessor_version,listing_id,
       listing_material_version,mapping_state,public_job_id,reason_code,
       mapping_hash,idempotency_key,created_at
     ) VALUES(
       'pos-1',1,NULL,'listing-1',1,'mapped','pub-1','initial','${hashA}',
       'map-v1','${timestamp}'
     );
     INSERT INTO job_source_position_mapping_heads(
       source_position_id,current_version,updated_at
     ) VALUES('pos-1',1,'${timestamp}');
     INSERT INTO public_job_eligibility_decisions(
       public_job_id,decision_version,predecessor_version,public_job_version,
       publication_state,route_disposition,browse_eligible,
       organic_index_eligible,job_posting_eligible,source_open_state,
       application_route_id,application_route_state,content_review_state,
       privacy_state,verified_at,redirect_public_job_id,reason_codes_json,
       decision_note,evaluator_kind,evaluator_version,decision_hash,
       idempotency_key,decided_at
     ) VALUES(
       'pub-1',1,NULL,1,'published','serve',1,1,1,'open','route-1','valid',
       'approved','passed','${timestamp}',NULL,'["test-approved"]','test',
       'operator','test','${hashA}','decision-v1','${timestamp}'
     );
     INSERT INTO public_job_decision_sources(
       public_job_id,decision_version,source_position_id,
       source_mapping_version,source_key,policy_version,contribution_kind,
       fields_used_json,created_at
     ) VALUES(
       'pub-1',1,'pos-1',1,'eslcafe-modern',2,'public_content',
       '["title","organization_name","locations","date_posted","valid_through","employment_types","compensation","description","source_name","source_url"]',
       '${timestamp}'
     );
     INSERT INTO public_job_eligibility_heads(
       public_job_id,current_decision_version,updated_at
     ) VALUES('pub-1',1,'${timestamp}');`
  );
  return database;
}

export function seedListing(database: Database) {
  database.exec(
    `INSERT INTO job_listings(
       id,board,title,company,apply_url,source_url,first_seen_at,updated_at,
       inventory_status,material_hash,material_hash_version,material_version,
       material_changed_at,source_posted_date,source_posted_date_provenance
     ) VALUES(
       'listing-1','eslcafe-modern','English teacher','Example School',
       'https://apply.example/job','https://source.example/job','${timestamp}',
       '${timestamp}','active','${hashA}',1,1,'${timestamp}','2026-07-01',
       'board-published'
     );
     INSERT INTO job_listing_versions(
       listing_id,material_version,material_hash,material_hash_version,
       material_json,source_posted_date,source_posted_date_raw,
       source_posted_date_provenance,source_expiry_date,
       source_expiry_date_raw,source_expiry_date_provenance,created_at
     ) VALUES(
       'listing-1',1,'${hashA}',1,'{}','2026-07-01','',
       'board-published',NULL,'','unknown','${timestamp}'
     );
     INSERT INTO application_routes(
       id,job_id,kind,destination,source_evidence,last_verified_at,status,
       created_at,updated_at
     ) VALUES(
       'route-1','listing-1','email','private@example.test','source',
       '${timestamp}','active','${timestamp}','${timestamp}'
     );`
  );
}

export function seedOrganization(database: Database) {
  database.exec(
    `INSERT OR IGNORE INTO organizations(
       id,country_code,country_name,name,identity_key,city,region,website_url,
       canonical_domain,market_segment,status,outreach_eligibility,
       evidence_url,last_verified_at,created_at,updated_at
     ) VALUES(
       'org-1','KR','South Korea','Example School','example-school','Seoul','',
       'https://example.test','example.test','school','active','eligible',
       'https://example.test','${timestamp}','${timestamp}','${timestamp}'
     );`
  );
}

export function seedPrivateJobVersion(
  database: Database,
  publicJobId: string,
  slug: string
) {
  seedOrganization(database);
  database.exec(
    `INSERT INTO public_job_aliases(public_job_id,slug,created_at)
     VALUES('${publicJobId}','${slug}','${timestamp}');`
  );
  appendJobVersion(database, publicJobId, 1, null, slug, hashA, "content-v1");
  database.exec(
    `INSERT INTO public_job_heads(public_job_id,current_version,updated_at)
     VALUES('${publicJobId}',1,'${timestamp}');`
  );
}

export function appendJobVersion(
  database: Database,
  publicJobId: string,
  version: number,
  predecessor: number | null,
  slug: string,
  contentHash: string,
  idempotencyKey: string
) {
  database
    .query(
      `INSERT INTO public_job_versions(
         public_job_id,version,predecessor_version,canonical_slug,title,
         organization_id,organization_name,organization_resolution_state,
         workplace_type,date_posted,date_posted_provenance,valid_through,
         valid_through_provenance,employment_types_json,compensation_json,
         description_html,public_content_hash,public_content_hash_version,
         material_changed_at,content_schema_version,producer_kind,producer_id,
         idempotency_key,created_at
       ) VALUES(
         ?,?,?,?,'English teacher','org-1','Example School','resolved',
         'onsite',NULL,'unknown',NULL,'unknown','[]','{}','Description',?,1,
         '${timestamp}',1,'deterministic','test',?,'${timestamp}'
       )`
    )
    .run(publicJobId, version, predecessor, slug, contentHash, idempotencyKey);
}

export function seedPrivateDecision(database: Database, publicJobId: string) {
  database.exec(
    `INSERT INTO public_job_eligibility_decisions(
       public_job_id,decision_version,predecessor_version,public_job_version,
       publication_state,route_disposition,browse_eligible,
       organic_index_eligible,job_posting_eligible,source_open_state,
       application_route_id,application_route_state,content_review_state,
       privacy_state,verified_at,redirect_public_job_id,reason_codes_json,
       decision_note,evaluator_kind,evaluator_version,decision_hash,
       idempotency_key,decided_at
     ) VALUES(
       '${publicJobId}',1,NULL,1,'private','private',0,0,0,'unknown',NULL,
       'unresolved','unreviewed','pending',NULL,NULL,'["shadow"]','shadow',
       'system','v1','${hashA}','decision-v1','${timestamp}'
     );
     INSERT INTO public_job_eligibility_heads(
       public_job_id,current_decision_version,updated_at
     ) VALUES('${publicJobId}',1,'${timestamp}');`
  );
}

export function appendMergedDecision(
  database: Database,
  publicJobId: string,
  redirectPublicJobId: string
) {
  database.exec(
    `INSERT INTO public_job_eligibility_decisions(
       public_job_id,decision_version,predecessor_version,public_job_version,
       publication_state,route_disposition,browse_eligible,
       organic_index_eligible,job_posting_eligible,source_open_state,
       application_route_id,application_route_state,content_review_state,
       privacy_state,verified_at,redirect_public_job_id,reason_codes_json,
       decision_note,evaluator_kind,evaluator_version,decision_hash,
       idempotency_key,decided_at
     ) VALUES(
       '${publicJobId}',2,1,1,'merged','redirect',0,0,0,'closed',NULL,
       'unresolved','approved','passed','${timestamp}','${redirectPublicJobId}',
       '["duplicate-merge"]','merge','operator','v1','${hashB}',
       'decision-v2','${timestamp}'
     );`
  );
}
