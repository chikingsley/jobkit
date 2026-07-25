import { afterEach, describe, expect, test } from "bun:test";

import {
  appendJobVersion,
  databases,
  hashB,
  hashC,
  insertPolicyVersion,
  migratedDatabase,
  policyRow,
  publicCounts,
  seededPublishedDatabase,
  timestamp,
} from "./support";

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe("public job entity migration", () => {
  test("seeds reviewed source policies and zero public projections", () => {
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
      policyRow("eslcafe-modern", "approved", "fact_summary", {
        enabled: 1,
        version: 2,
      }),
      policyRow("seriousteachers", "approved", "fact_summary", {
        enabled: 1,
        version: 2,
      }),
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
      approval: "revoked",
      enabled: 0,
      predecessor: 2,
      scope: "fact_summary",
      source: "eslcafe-modern",
      version: 3,
    });
    expect(() =>
      insertPolicyVersion(database, {
        approval: "approved",
        enabled: 1,
        predecessor: 3,
        scope: "fact_summary",
        source: "eslcafe-modern",
        version: 4,
      })
    ).toThrow("policy version must extend the current head");
    database.exec(
      `UPDATE source_publication_policy_heads
          SET current_version=3,updated_at='${timestamp}'
        WHERE source_key='eslcafe-modern'`
    );
    expect(() =>
      database.exec(
        `UPDATE source_publication_policy_heads
            SET current_version=2
          WHERE source_key='eslcafe-modern'`
      )
    ).toThrow("policy head must advance one version");
  });

  test("accepts exact successor replays and rejects changed hashes", () => {
    const database = migratedDatabase();
    insertPolicyVersion(database, {
      approval: "revoked",
      enabled: 0,
      predecessor: 2,
      scope: "fact_summary",
      source: "eslcafe-modern",
      version: 3,
    });
    database.exec(
      `UPDATE source_publication_policy_heads
          SET current_version=3,updated_at='${timestamp}'
        WHERE source_key='eslcafe-modern';
       INSERT OR IGNORE INTO source_publication_policy_versions
       SELECT * FROM source_publication_policy_versions
        WHERE source_key='eslcafe-modern' AND version=3;`
    );
    expect(
      database
        .query(
          `SELECT count(*) AS count
             FROM source_publication_policy_versions
            WHERE source_key='eslcafe-modern'`
        )
        .get()
    ).toEqual({ count: 3 });
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
          WHERE source_key='eslcafe-modern' AND version=3`
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
});
