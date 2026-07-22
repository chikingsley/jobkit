import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationsDirectory = resolve(import.meta.dir, "../../migrations");
const timestamp = "2026-07-21T12:00:00.000Z";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const privateColumnPattern =
  /candidate|contact|destination|document|draft|email|gmail|recipient|route_id/u;
const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe("public job entity migration", () => {
  test("seeds five disabled source policies and zero public projections", () => {
    const database = migratedDatabase();

    expect(
      database
        .query(
          `SELECT source_key,approval_state,publication_scope,
                  publication_enabled,current_version
             FROM source_publication_policy_versions version
             JOIN source_publication_policy_heads head USING (source_key)
            WHERE version.version=head.current_version
            ORDER BY source_key`
        )
        .all()
    ).toEqual([
      policyRow("ajarn", "rejected", "blocked"),
      policyRow("anesl", "rejected", "blocked"),
      policyRow("eslcafe-modern", "pending", "metadata_only"),
      policyRow("seriousteachers", "pending", "metadata_only"),
      policyRow("tefl", "rejected", "blocked"),
    ]);
    expect(publicCounts(database)).toEqual({
      browse: 0,
      jobPosting: 0,
      organic: 0,
      routeContent: 0,
      routes: 0,
    });
    expect(database.query("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("requires append-only direct-successor policy history", () => {
    const database = migratedDatabase();

    expect(() =>
      database.exec(
        `UPDATE source_publication_policy_versions
            SET decision_note='changed'
          WHERE source_key='ajarn' AND version=1`
      )
    ).toThrow("policy versions are immutable");
    expect(() =>
      database.exec(
        `DELETE FROM source_publication_policy_heads
          WHERE source_key='ajarn'`
      )
    ).toThrow("policy heads cannot be deleted");
    expect(() =>
      insertPolicyVersion(database, {
        approval: "approved",
        enabled: 1,
        fields: "[]",
        predecessor: 1,
        scope: "blocked",
        source: "ajarn",
        version: 2,
      })
    ).toThrow();
    insertPolicyVersion(database, {
      approval: "approved",
      enabled: 1,
      predecessor: 1,
      scope: "metadata_only",
      source: "eslcafe-modern",
      version: 2,
    });
    expect(() =>
      insertPolicyVersion(database, {
        approval: "approved",
        enabled: 1,
        predecessor: 2,
        scope: "metadata_only",
        source: "eslcafe-modern",
        version: 3,
      })
    ).toThrow("policy version must extend the current head");
    database.exec(
      `UPDATE source_publication_policy_heads
          SET current_version=2,updated_at='${timestamp}'
        WHERE source_key='eslcafe-modern'`
    );
    expect(() =>
      database.exec(
        `UPDATE source_publication_policy_heads
            SET current_version=1
          WHERE source_key='eslcafe-modern'`
      )
    ).toThrow("policy head must advance one version");
  });

  test("accepts exact successor replays and rejects changed hashes", () => {
    const database = migratedDatabase();
    insertPolicyVersion(database, {
      approval: "approved",
      enabled: 1,
      predecessor: 1,
      scope: "metadata_only",
      source: "eslcafe-modern",
      version: 2,
    });
    database.exec(
      `UPDATE source_publication_policy_heads
          SET current_version=2,updated_at='${timestamp}'
        WHERE source_key='eslcafe-modern';
       INSERT OR IGNORE INTO source_publication_policy_versions
       SELECT * FROM source_publication_policy_versions
        WHERE source_key='eslcafe-modern' AND version=2;`
    );
    expect(
      database
        .query(
          `SELECT count(*) AS count
             FROM source_publication_policy_versions
            WHERE source_key='eslcafe-modern'`
        )
        .get()
    ).toEqual({ count: 2 });
    expect(() =>
      database.exec(
        `INSERT OR IGNORE INTO source_publication_policy_versions(
           source_key,version,predecessor_version,approval_state,
           publication_scope,publication_enabled,allowed_fields_json,
           attribution_mode,max_verbatim_chars,source_origin_url,terms_url,
           terms_checked_at,robots_url,robots_checked_at,evidence_json,
           decision_note,policy_hash,idempotency_key,created_at
         )
         SELECT source_key,version,predecessor_version,approval_state,
                publication_scope,publication_enabled,allowed_fields_json,
                attribution_mode,max_verbatim_chars,source_origin_url,terms_url,
                terms_checked_at,robots_url,robots_checked_at,evidence_json,
                decision_note,'${hashC}',idempotency_key,created_at
           FROM source_publication_policy_versions
          WHERE source_key='eslcafe-modern' AND version=2`
      )
    ).toThrow("policy idempotency key conflicts with existing hash");
  });

  test("serves one complete current record and suppresses stale dependencies", () => {
    const routeDatabase = seededPublishedDatabase();
    expect(publicCounts(routeDatabase)).toEqual({
      browse: 0,
      jobPosting: 0,
      organic: 0,
      routeContent: 1,
      routes: 0,
    });
    routeDatabase.exec(
      "UPDATE application_routes SET status='invalid' WHERE id='route-1'"
    );
    expect(publicCounts(routeDatabase).browse).toBe(0);

    const materialDatabase = seededPublishedDatabase();
    materialDatabase.exec(
      "UPDATE job_listings SET material_version=2 WHERE id='listing-1'"
    );
    expect(publicCounts(materialDatabase).browse).toBe(0);

    const policyDatabase = seededPublishedDatabase();
    insertPolicyVersion(policyDatabase, {
      approval: "revoked",
      enabled: 0,
      predecessor: 2,
      scope: "metadata_only",
      source: "eslcafe-modern",
      version: 3,
    });
    policyDatabase.exec(
      `UPDATE source_publication_policy_heads
          SET current_version=3,updated_at='${timestamp}'
        WHERE source_key='eslcafe-modern'`
    );
    expect(publicCounts(policyDatabase).browse).toBe(0);
  });

  test("replays committed content, child, mapping, and decision snapshots", () => {
    const database = seededPublishedDatabase();
    appendJobVersion(
      database,
      "pub-1",
      2,
      1,
      "english-teacher-seoul",
      hashB,
      "content-v2"
    );
    database.exec(
      `INSERT INTO public_job_version_locations(
         public_job_id,public_job_version,ordinal,location_role,location_id,
         resolution_state,display_name,country_code,region,locality,postal_code,
         location_json,created_at
       )
       SELECT public_job_id,2,ordinal,location_role,location_id,
              resolution_state,display_name,country_code,region,locality,
              postal_code,location_json,created_at
         FROM public_job_version_locations
        WHERE public_job_id='pub-1' AND public_job_version=1;
       UPDATE public_job_heads SET current_version=2
        WHERE public_job_id='pub-1';
       INSERT OR IGNORE INTO public_job_versions
       SELECT * FROM public_job_versions
        WHERE public_job_id='pub-1' AND version=2;
       INSERT OR IGNORE INTO public_job_version_locations
       SELECT * FROM public_job_version_locations
        WHERE public_job_id='pub-1' AND public_job_version=2;

       INSERT INTO job_source_position_mapping_versions(
         source_position_id,version,predecessor_version,listing_id,
         listing_material_version,mapping_state,public_job_id,reason_code,
         mapping_hash,idempotency_key,created_at
       ) VALUES(
         'pos-1',2,1,'listing-1',1,'mapped','pub-1','correction','${hashB}',
         'map-v2','${timestamp}'
       );
       UPDATE job_source_position_mapping_heads SET current_version=2
        WHERE source_position_id='pos-1';
       INSERT OR IGNORE INTO job_source_position_mapping_versions
       SELECT * FROM job_source_position_mapping_versions
        WHERE source_position_id='pos-1' AND version=2;

       INSERT INTO public_job_eligibility_decisions(
         public_job_id,decision_version,predecessor_version,
         public_job_version,publication_state,route_disposition,
         browse_eligible,organic_index_eligible,job_posting_eligible,
         source_open_state,application_route_id,application_route_state,
         content_review_state,privacy_state,verified_at,
         redirect_public_job_id,reason_codes_json,decision_note,
         evaluator_kind,evaluator_version,decision_hash,idempotency_key,
         decided_at
       ) VALUES(
         'pub-1',2,1,2,'private','private',0,0,0,'open',NULL,'unresolved',
         'approved','passed','${timestamp}',NULL,'["shadow"]','shadow',
         'system','v1','${hashB}','decision-v2','${timestamp}'
       );
       INSERT INTO public_job_decision_sources(
         public_job_id,decision_version,source_position_id,
         source_mapping_version,source_key,policy_version,contribution_kind,
         fields_used_json,created_at
       ) VALUES(
         'pub-1',2,'pos-1',2,'eslcafe-modern',2,'identity_only','[]',
         '${timestamp}'
       );
       UPDATE public_job_eligibility_heads SET current_decision_version=2
        WHERE public_job_id='pub-1';
       INSERT OR IGNORE INTO public_job_eligibility_decisions
       SELECT * FROM public_job_eligibility_decisions
        WHERE public_job_id='pub-1' AND decision_version=2;
       INSERT OR IGNORE INTO public_job_decision_sources
       SELECT * FROM public_job_decision_sources
        WHERE public_job_id='pub-1' AND decision_version=2;`
    );

    expect(
      database
        .query(
          `SELECT
             (SELECT count(*) FROM public_job_versions
               WHERE public_job_id='pub-1') AS content_versions,
             (SELECT count(*) FROM public_job_version_locations
               WHERE public_job_id='pub-1') AS location_versions,
             (SELECT count(*) FROM job_source_position_mapping_versions
               WHERE source_position_id='pos-1') AS mapping_versions,
             (SELECT count(*) FROM public_job_eligibility_decisions
               WHERE public_job_id='pub-1') AS decision_versions,
             (SELECT count(*) FROM public_job_decision_sources
               WHERE public_job_id='pub-1') AS decision_sources`
        )
        .get()
    ).toEqual({
      content_versions: 2,
      decision_sources: 2,
      decision_versions: 2,
      location_versions: 2,
      mapping_versions: 2,
    });
  });

  test("binds source positions and decision sources to their real entities", () => {
    const database = migratedDatabase();
    seedListing(database);
    database.exec(
      `INSERT INTO public_jobs(id,created_at)
       VALUES('pub-1','${timestamp}'),('pub-2','${timestamp}');`
    );

    expect(() =>
      database.exec(
        `INSERT INTO job_source_positions(
           id,listing_id,source_key,position_key,position_kind,created_at
         ) VALUES(
           'wrong-board','listing-1','tefl','direct','direct','${timestamp}'
         )`
      )
    ).toThrow("source position must use the listing board");

    database.exec(
      `INSERT INTO job_source_positions(
         id,listing_id,source_key,position_key,position_kind,created_at
       ) VALUES(
         'pos-1','listing-1','eslcafe-modern','direct','direct','${timestamp}'
       );
       INSERT INTO job_source_position_mapping_versions(
         source_position_id,version,predecessor_version,listing_id,
         listing_material_version,mapping_state,public_job_id,reason_code,
         mapping_hash,idempotency_key,created_at
       ) VALUES(
         'pos-1',1,NULL,'listing-1',1,'mapped','pub-1','initial',
         '${hashA}','map-v1','${timestamp}'
       );
       INSERT INTO job_source_position_mapping_heads(
         source_position_id,current_version,updated_at
       ) VALUES('pos-1',1,'${timestamp}');`
    );
    seedPrivateJobVersion(database, "pub-2", "second-job");
    database.exec(
      `INSERT INTO public_job_eligibility_decisions(
         public_job_id,decision_version,predecessor_version,
         public_job_version,publication_state,route_disposition,
         browse_eligible,organic_index_eligible,job_posting_eligible,
         source_open_state,application_route_id,application_route_state,
         content_review_state,privacy_state,verified_at,
         redirect_public_job_id,reason_codes_json,decision_note,
         evaluator_kind,evaluator_version,decision_hash,idempotency_key,
         decided_at
       ) VALUES(
         'pub-2',1,NULL,1,'private','private',0,0,0,'unknown',NULL,
         'unresolved','unreviewed','pending',NULL,NULL,'["shadow"]',
         'shadow','system','v1','${hashB}','decision-v1','${timestamp}'
       );`
    );

    expect(() =>
      database.exec(
        `INSERT INTO public_job_decision_sources(
           public_job_id,decision_version,source_position_id,
           source_mapping_version,source_key,policy_version,
           contribution_kind,fields_used_json,created_at
         ) VALUES(
           'pub-2',1,'pos-1',1,'eslcafe-modern',1,
           'identity_only','[]','${timestamp}'
         )`
      )
    ).toThrow("decision source mapping targets another public job");
  });

  test("allows A to B to A history and rejects merge cycles", () => {
    const database = migratedDatabase();
    seedOrganization(database);
    database.exec(
      `INSERT INTO public_jobs(id,created_at)
       VALUES('pub-a','${timestamp}'),('pub-b','${timestamp}');`
    );
    seedPrivateJobVersion(database, "pub-a", "job-a");
    seedPrivateJobVersion(database, "pub-b", "job-b");
    seedPrivateDecision(database, "pub-a");
    seedPrivateDecision(database, "pub-b");

    appendJobVersion(database, "pub-a", 2, 1, "job-a", hashB, "content-v2");
    database.exec(
      `UPDATE public_job_heads SET current_version=2
        WHERE public_job_id='pub-a'`
    );
    appendJobVersion(database, "pub-a", 3, 2, "job-a", hashC, "content-v3");
    database.exec(
      `UPDATE public_job_heads SET current_version=3
        WHERE public_job_id='pub-a'`
    );
    expect(
      database
        .query(
          `SELECT version FROM public_job_versions
            WHERE public_job_id='pub-a' ORDER BY version`
        )
        .all()
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);

    appendMergedDecision(database, "pub-a", "pub-b");
    database.exec(
      `UPDATE public_job_eligibility_heads
          SET current_decision_version=2
        WHERE public_job_id='pub-a'`
    );
    expect(() => appendMergedDecision(database, "pub-b", "pub-a")).toThrow(
      "public job merge cycle"
    );
  });

  test("public browse columns exclude private application and candidate state", () => {
    const database = migratedDatabase();
    const columns = database
      .query("PRAGMA table_info(public_browse_jobs)")
      .all()
      .map((column) => String((column as { name: unknown }).name));

    expect(columns).toEqual([
      "catalog_version",
      "public_job_id",
      "public_job_version",
      "canonical_slug",
      "title",
      "organization_name",
      "workplace_type",
      "date_posted",
      "date_posted_provenance",
      "valid_through",
      "valid_through_provenance",
      "employment_types_json",
      "compensation_json",
      "public_content_hash",
      "eligibility_decision_hash",
      "material_changed_at",
      "representation_updated_at",
      "verified_at",
      "application_available",
      "locations_json",
      "source_attributions_json",
      "item_json",
    ]);
    expect(columns.some((column) => privateColumnPattern.test(column))).toBe(
      false
    );
  });
});

function migratedDatabase(): Database {
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

function policyRow(
  source_key: string,
  approval_state: string,
  publication_scope: string
) {
  return {
    approval_state,
    current_version: 1,
    publication_enabled: 0,
    publication_scope,
    source_key,
  };
}

function publicCounts(database: Database) {
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

function insertPolicyVersion(
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

function seededPublishedDatabase(): Database {
  const database = migratedDatabase();
  seedListing(database);
  seedOrganization(database);
  insertPolicyVersion(database, {
    approval: "approved",
    enabled: 1,
    predecessor: 1,
    scope: "fact_summary",
    source: "eslcafe-modern",
    version: 2,
  });
  database.exec(
    `UPDATE source_publication_policy_heads
        SET current_version=2,updated_at='${timestamp}'
      WHERE source_key='eslcafe-modern';
     INSERT INTO canonical_locations(
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

function seedListing(database: Database) {
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

function seedOrganization(database: Database) {
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

function seedPrivateJobVersion(
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

function appendJobVersion(
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

function seedPrivateDecision(database: Database, publicJobId: string) {
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

function appendMergedDecision(
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
