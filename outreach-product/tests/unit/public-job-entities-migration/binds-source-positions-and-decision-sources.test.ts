import { afterEach, describe, expect, test } from "bun:test";

import {
  appendJobVersion,
  appendMergedDecision,
  databases,
  hashA,
  hashB,
  hashC,
  migratedDatabase,
  privateColumnPattern,
  seedListing,
  seedOrganization,
  seedPrivateDecision,
  seedPrivateJobVersion,
  timestamp,
} from "./support";

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe("public job entity migration", () => {
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
      "valid_from_ordinal",
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
