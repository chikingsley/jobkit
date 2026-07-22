import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const phaseBMigration = readFileSync(
  resolve(import.meta.dir, "../../migrations/0048_public_job_entities.sql"),
  "utf8"
);
const phaseCMigration = readFileSync(
  resolve(import.meta.dir, "../../migrations/0049_public_projection_runs.sql"),
  "utf8"
);
const phaseD2Migration = readFileSync(
  resolve(
    import.meta.dir,
    "../../migrations/0051_public_projection_duplicate_comparisons.sql"
  ),
  "utf8"
);
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const now = "2026-07-22T12:00:00.000Z";

const publicViews = [
  "public_job_route_content",
  "public_browse_jobs",
  "organic_index_jobs",
  "job_posting_jobs",
  "public_job_route_resolutions",
] as const;

function createDatabase(populated = false) {
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

function insertListing(
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

function insertRun(database: Database, runId = "run-1") {
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

function insertListingItem(
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

function insertSourcePosition(
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

function insertPositionItem(
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

function insertPublicVersion(database: Database, publicJobId = "public-job-1") {
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

function count(database: Database, table: string) {
  return (
    database.query(`SELECT COUNT(*) AS total FROM ${table}`).get() as {
      total: number;
    }
  ).total;
}

describe("public projection run migration", () => {
  for (const populated of [false, true]) {
    test(`applies to a ${populated ? "populated" : "fresh"} Phase-B database`, () => {
      const database = createDatabase(populated);
      try {
        expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(
          database
            .query(
              `SELECT name FROM sqlite_master
               WHERE type='table' AND name LIKE 'public_projection_%'
               ORDER BY name`
            )
            .all()
        ).toEqual([
          { name: "public_projection_duplicate_assertions" },
          { name: "public_projection_duplicate_batch_members" },
          { name: "public_projection_duplicate_batches" },
          { name: "public_projection_duplicate_candidates" },
          { name: "public_projection_duplicate_comparisons" },
          { name: "public_projection_duplicate_work" },
          { name: "public_projection_listing_items" },
          { name: "public_projection_position_items" },
          { name: "public_projection_runs" },
        ]);
        expect(count(database, "public_job_identity_signals")).toBe(0);
        for (const view of publicViews) {
          expect(count(database, view)).toBe(0);
        }
      } finally {
        database.close();
      }
    });
  }

  test("keeps run requests idempotent and status progress forward-only", () => {
    const database = createDatabase();
    try {
      insertRun(database);
      expect(() => insertRun(database, "run-1")).toThrow();
      expect(() =>
        database.exec(`
          INSERT INTO public_projection_runs (
            id,mode,request_key,scope_json,contract_version,projector_version,
            policy_heads_hash,source_watermark_json,status,requested_at,updated_at
          ) VALUES (
            'live-run','live','live-request','{}',1,'v1','${hashA}','{}',
            'queued','${now}','${now}'
          )
        `)
      ).toThrow();

      database.exec(`
        UPDATE public_projection_runs
        SET status='running',started_at='${now}',listing_total=2,
            selection_complete=1,updated_at='${now}'
        WHERE id='run-1'
      `);
      expect(() =>
        database.exec(
          "UPDATE public_projection_runs SET listing_total=1 WHERE id='run-1'"
        )
      ).toThrow("projection run progress cannot move backward");
      expect(() =>
        database.exec(
          "UPDATE public_projection_runs SET request_key='changed' WHERE id='run-1'"
        )
      ).toThrow("projection run request snapshot is immutable");
      expect(() =>
        database.exec(
          "UPDATE public_projection_runs SET requested_by_user_id='other' WHERE id='run-1'"
        )
      ).toThrow("projection run request snapshot is immutable");
      database.exec(`
        UPDATE public_projection_runs
        SET status='completed_with_blocks',completed_at='${now}',
            listing_blocked=2,updated_at='${now}'
        WHERE id='run-1'
      `);
      expect(() =>
        database.exec(
          "UPDATE public_projection_runs SET status='running' WHERE id='run-1'"
        )
      ).toThrow("terminal projection run is immutable");
      expect(() =>
        database.exec(`
          UPDATE public_projection_runs
          SET listing_total=3,error_code='rewritten',updated_at='2099-01-01'
          WHERE id='run-1'
        `)
      ).toThrow("terminal projection run is immutable");
    } finally {
      database.close();
    }
  });

  test("guards listing leases while preserving bounded retries", () => {
    const database = createDatabase();
    try {
      insertListing(database);
      insertRun(database);
      insertListingItem(database);

      expect(() =>
        database.exec(
          "UPDATE public_projection_listing_items SET stage='completed' WHERE id='listing-item-1'"
        )
      ).toThrow("invalid projection listing stage transition");
      expect(() =>
        database.exec(
          "UPDATE public_projection_listing_items SET status='processing' WHERE id='listing-item-1'"
        )
      ).toThrow();
      expect(() =>
        database.exec(`
          UPDATE public_projection_listing_items
          SET status='processing',attempt_count=1,lease_owner='',
              lease_token='',lease_expires_at='',updated_at='${now}'
          WHERE id='listing-item-1'
        `)
      ).toThrow();

      database.exec(`
        UPDATE public_projection_listing_items
        SET status='processing',attempt_count=1,lease_owner='runner-1',
            lease_token='lease-1',lease_expires_at='2099-01-01',
            started_at='${now}',updated_at='${now}'
        WHERE id='listing-item-1'
      `);
      database.exec(`
        UPDATE public_projection_listing_items
        SET lease_expires_at='2099-01-02' WHERE id='listing-item-1'
      `);
      expect(() =>
        database.exec(
          "UPDATE public_projection_listing_items SET lease_owner='runner-2' WHERE id='listing-item-1'"
        )
      ).toThrow("projection listing lease ownership is immutable");

      database.exec(`
        UPDATE public_projection_listing_items
        SET status='failed',lease_owner=NULL,lease_token=NULL,
            lease_expires_at=NULL,error_code='transient_d1',
            completed_at='${now}',updated_at='${now}'
        WHERE id='listing-item-1'
      `);
      database.exec(`
        UPDATE public_projection_listing_items
        SET status='queued',error_code='',error_detail='',completed_at=NULL,
            updated_at='${now}'
        WHERE id='listing-item-1'
      `);
      database.exec(`
        UPDATE public_projection_listing_items
        SET status='processing',attempt_count=2,lease_owner='runner-2',
            lease_token='lease-2',lease_expires_at='2099-01-03',
            updated_at='${now}'
        WHERE id='listing-item-1'
      `);
      expect(
        database
          .query(
            `SELECT status,attempt_count,lease_owner
             FROM public_projection_listing_items WHERE id='listing-item-1'`
          )
          .get()
      ).toEqual({
        attempt_count: 2,
        lease_owner: "runner-2",
        status: "processing",
      });

      database.exec(`
        UPDATE public_projection_listing_items
        SET status='failed',lease_owner=NULL,lease_token=NULL,
            lease_expires_at=NULL,error_code='terminal_failure',
            completed_at='${now}',updated_at='${now}'
        WHERE id='listing-item-1'
      `);
      database.exec(`
        UPDATE public_projection_listing_items
        SET status='queued',error_code='',error_detail='',completed_at=NULL,
            updated_at='${now}'
        WHERE id='listing-item-1'
      `);
      database.exec(`
        UPDATE public_projection_listing_items
        SET status='processing',attempt_count=3,lease_owner='runner-3',
            lease_token='lease-3',lease_expires_at='2099-01-04',
            updated_at='${now}'
        WHERE id='listing-item-1'
      `);
      database.exec(`
        UPDATE public_projection_listing_items
        SET status='failed',lease_owner=NULL,lease_token=NULL,
            lease_expires_at=NULL,error_code='terminal_failure',
            completed_at='${now}',updated_at='${now}'
        WHERE id='listing-item-1'
      `);
      database.exec(`
        UPDATE public_projection_listing_items
        SET status='queued',error_code='',error_detail='',completed_at=NULL,
            updated_at='${now}'
        WHERE id='listing-item-1'
      `);
      expect(() =>
        database.exec(`
          UPDATE public_projection_listing_items
          SET status='processing',attempt_count=3,lease_owner='runner-4',
              lease_token='lease-4',lease_expires_at='2099-01-05',
              updated_at='${now}'
          WHERE id='listing-item-1'
        `)
      ).toThrow("projection listing claim must advance attempt");
      expect(() =>
        database.exec(`
          UPDATE public_projection_listing_items
          SET status='processing',attempt_count=4,lease_owner='runner-4',
              lease_token='lease-4',lease_expires_at='2099-01-05',
              updated_at='${now}'
          WHERE id='listing-item-1'
        `)
      ).toThrow();
    } finally {
      database.close();
    }
  });

  test("binds positions to the matching listing and seals completed items", () => {
    const database = createDatabase();
    try {
      insertListing(database);
      insertListing(database, "listing-2");
      insertRun(database);
      insertListingItem(database);
      insertSourcePosition(database);
      insertSourcePosition(database, "listing-2", "position-2");

      expect(() =>
        insertPositionItem(database, "position-2", "bad-position-item")
      ).toThrow("projection position must belong to listing item");
      insertPositionItem(database);
      expect(() =>
        database.exec(`
          UPDATE public_projection_position_items
          SET status='processing',attempt_count=0,lease_owner='',
              lease_token='',lease_expires_at='',updated_at='${now}'
          WHERE id='position-item-1'
        `)
      ).toThrow();
      expect(() =>
        database.exec(`
          UPDATE public_projection_position_items
          SET simulated_organic_eligible=1 WHERE id='position-item-1'
        `)
      ).toThrow();

      database.exec(`
        UPDATE public_projection_position_items
        SET status='processing',attempt_count=1,lease_owner='runner-1',
            lease_token='lease-1',lease_expires_at='2099-01-01',
            started_at='${now}',updated_at='${now}'
        WHERE id='position-item-1'
      `);
      for (const stage of [
        "canonical_resolution",
        "content",
        "eligibility",
        "completed",
      ]) {
        database
          .query(
            `UPDATE public_projection_position_items
             SET stage=$stage,updated_at=$now WHERE id='position-item-1'`
          )
          .run({ now, stage });
      }
      database.exec(`
        UPDATE public_projection_position_items
        SET status='completed',lease_owner=NULL,lease_token=NULL,
            lease_expires_at=NULL,completed_at='${now}',updated_at='${now}'
        WHERE id='position-item-1'
      `);
      expect(() =>
        database.exec(
          "UPDATE public_projection_position_items SET status='queued' WHERE id='position-item-1'"
        )
      ).toThrow("terminal projection position is immutable");
      expect(() =>
        database.exec(`
          UPDATE public_projection_position_items
          SET simulated_browse_eligible=1,
              readiness_json='{"rewritten":true}',
              reason_codes_json='["rewritten"]',
              checkpoint_json='{"rewritten":true}',
              completed_at='2099-01-01',updated_at='2099-01-01'
          WHERE id='position-item-1'
        `)
      ).toThrow("terminal projection position is immutable");
    } finally {
      database.close();
    }
  });

  test("retains duplicate evidence and append-only identity signals", () => {
    const database = createDatabase();
    try {
      database.exec("INSERT INTO users (id) VALUES ('operator-1')");
      insertListing(database);
      insertRun(database);
      insertListingItem(database);
      insertSourcePosition(database);
      insertPositionItem(database);
      insertPublicVersion(database);

      database.exec(`
        INSERT INTO public_projection_duplicate_candidates (
          id,run_id,position_item_id,candidate_public_job_id,
          candidate_public_job_version,retrieval_algorithm_version,
          signals_json,operator_decision,created_at,updated_at
        ) VALUES (
          'candidate-1','run-1','position-item-1','public-job-1',1,
          'exact-signals-v1','[{"kind":"canonical_identity_v1"}]','pending',
          '${now}','${now}'
        )
      `);
      expect(() =>
        database.exec(`
          UPDATE public_projection_duplicate_candidates
          SET signals_json='[{"kind":"changed"}]' WHERE id='candidate-1'
        `)
      ).toThrow("duplicate candidate evidence is immutable");
      database.exec(`
        UPDATE public_projection_duplicate_candidates
        SET operator_decision='same',operator_user_id='operator-1',
            operator_decided_at='${now}',updated_at='${now}'
        WHERE id='candidate-1'
      `);
      expect(() =>
        database.exec(`
          UPDATE public_projection_duplicate_candidates
          SET operator_decision='different' WHERE id='candidate-1'
        `)
      ).toThrow("duplicate operator decision is immutable");
      expect(() =>
        database.exec(`
          UPDATE public_projection_duplicate_candidates
          SET operator_user_id='operator-1',operator_decided_at='2099-01-01'
          WHERE id='candidate-1'
        `)
      ).toThrow("duplicate operator decision is immutable");
      expect(() =>
        database.exec(
          "DELETE FROM public_projection_duplicate_candidates WHERE id='candidate-1'"
        )
      ).toThrow("duplicate candidate evidence is append-only");

      database.exec(`
        INSERT INTO public_job_identity_signals (
          public_job_id,public_job_version,signal_kind,signal_hash,created_at
        ) VALUES (
          'public-job-1',1,'canonical_identity_v1','${hashA}','${now}'
        )
      `);
      expect(() =>
        database.exec(`
          UPDATE public_job_identity_signals SET signal_hash='${hashB}'
        `)
      ).toThrow("public job identity signals are append-only");
      expect(() =>
        database.exec("DELETE FROM public_job_identity_signals")
      ).toThrow("public job identity signals are append-only");
      expect(() =>
        database.exec(`
          INSERT INTO public_job_identity_signals (
            public_job_id,public_job_version,signal_kind,signal_hash,created_at
          ) VALUES (
            'public-job-1',2,'material_clone_v1','${hashB}','${now}'
          )
        `)
      ).toThrow();

      for (const view of publicViews) {
        expect(count(database, view)).toBe(0);
      }
      expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  test("seals tagged duplicate pairs and one stable run boundary", () => {
    const database = createDatabase();
    try {
      insertListing(database);
      insertListing(database, "listing-2");
      insertRun(database);
      insertListingItem(database);
      insertListingItem(database, "listing-2", "listing-item-2", "run-1");
      insertSourcePosition(database);
      insertSourcePosition(database, "listing-2", "position-2");
      insertPositionItem(database);
      insertPositionItem(
        database,
        "position-2",
        "position-item-2",
        "listing-item-2"
      );
      insertPublicVersion(database);
      insertPublicVersion(database, "public-job-2");
      database.exec(`
        INSERT INTO public_job_eligibility_decisions (
          public_job_id,decision_version,predecessor_version,
          public_job_version,publication_state,route_disposition,
          browse_eligible,organic_index_eligible,job_posting_eligible,
          source_open_state,application_route_id,application_route_state,
          content_review_state,privacy_state,verified_at,
          redirect_public_job_id,reason_codes_json,decision_note,
          evaluator_kind,evaluator_version,decision_hash,idempotency_key,
          decided_at
        ) VALUES (
          'public-job-1',1,NULL,1,'private','private',0,0,0,'unknown',NULL,
          'unresolved','unreviewed','pending',NULL,NULL,'["shadow"]',
          'shadow','system','v1','${hashA}','decision-v1','${now}'
        );
        INSERT INTO public_job_eligibility_heads (
          public_job_id,current_decision_version,updated_at
        ) VALUES ('public-job-1',1,'${now}');
        INSERT INTO public_job_eligibility_decisions (
          public_job_id,decision_version,predecessor_version,
          public_job_version,publication_state,route_disposition,
          browse_eligible,organic_index_eligible,job_posting_eligible,
          source_open_state,application_route_id,application_route_state,
          content_review_state,privacy_state,verified_at,
          redirect_public_job_id,reason_codes_json,decision_note,
          evaluator_kind,evaluator_version,decision_hash,idempotency_key,
          decided_at
        ) VALUES (
          'public-job-1',2,1,1,'merged','redirect',0,0,0,'closed',NULL,
          'unresolved','approved','passed','${now}','public-job-2',
          '["duplicate-merge"]','merge','system','v1','${hashB}',
          'decision-v2','${now}'
        );
        UPDATE public_job_eligibility_heads
        SET current_decision_version=2,updated_at='${now}'
        WHERE public_job_id='public-job-1';
      `);
      database.exec(`
        UPDATE public_projection_runs
        SET status='running',selection_complete=1,started_at='${now}',
            listing_total=2,position_total=2,updated_at='${now}'
        WHERE id='run-1';
        UPDATE public_projection_listing_items
        SET status='processing',attempt_count=1,lease_owner='runner',
            lease_token='listing-lease',lease_expires_at='2099-01-01',
            started_at='${now}',updated_at='${now}';
        UPDATE public_projection_listing_items
        SET stage='prerequisites',updated_at='${now}';
        UPDATE public_projection_listing_items
        SET stage='source_positions',updated_at='${now}';
        UPDATE public_projection_listing_items
        SET stage='completed',status='completed',lease_owner=NULL,
            lease_token=NULL,lease_expires_at=NULL,completed_at='${now}',
            updated_at='${now}';
        UPDATE public_projection_position_items
        SET stage='canonical_resolution',
            checkpoint_json=json_object(
              'listingInputHash',input_hash,
              'identity',json_object(
                'state','derived',
                'sourcePosition',json_object(
                  'id',source_position_id,'positionKey','direct'
                ),
                'signals',json_array()
              )
            ),updated_at='${now}';
        INSERT INTO public_projection_duplicate_work (
          run_id,retrieval_algorithm_version,phase,status,
          expected_member_count,member_count,member_digest,
          comparison_digest,lease_token,lease_expires_at,created_at,updated_at
        ) VALUES (
          'run-1','public-duplicate-retrieval-v1','members','processing',
          2,0,'${hashA}','${hashB}','member-lease','2099-01-01',
          '${now}','${now}'
        );
        INSERT INTO public_projection_duplicate_batch_members (
          run_id,ordinal,position_item_id,source_position_id,input_hash,
          listing_id,source_key,position_key,source_reference,
          source_reference_signal_hash,material_signal_hash,created_at
        ) VALUES
          ('run-1',0,'position-item-1','position-1','${hashA}',
           'listing-1','seriousteachers','direct','',NULL,'${hashA}','${now}'),
          ('run-1',1,'position-item-2','position-2','${hashA}',
           'listing-2','seriousteachers','direct','',NULL,'${hashA}','${now}');
        UPDATE public_projection_duplicate_work
           SET phase='same_run',member_count=2,
               lease_token='comparison-lease',updated_at='${now}'
         WHERE run_id='run-1';
      `);
      const sameRunId = `pdup_v1_${"c".repeat(64)}`;
      database.exec(`
        INSERT INTO public_projection_duplicate_comparisons (
          id,run_id,owner_position_item_id,owner_source_position_id,
          owner_input_hash,target_kind,target_position_item_id,
          target_source_position_id,target_input_hash,
          retrieval_algorithm_version,matching_signals_json,
          conflicting_signals_json,relation,reason_code,created_at,updated_at
        ) VALUES (
          '${sameRunId}','run-1','position-item-1','position-1','${hashA}',
          'same_run','position-item-2','position-2','${hashA}',
          'public-duplicate-retrieval-v1','[]',
          '[{"kind":"position_key_v1"}]','different',
          'same_listing_distinct_position','${now}','${now}'
        )
      `);
      const publicId = `pdup_v1_${"d".repeat(64)}`;
      database.exec(`
        UPDATE public_projection_duplicate_work
           SET phase='existing_public',comparison_count=1,
               lease_token='public-lease',updated_at='${now}'
         WHERE run_id='run-1';
        INSERT INTO public_projection_duplicate_comparisons (
          id,run_id,owner_position_item_id,owner_source_position_id,
          owner_input_hash,target_kind,target_public_job_id,
          target_public_job_version,target_redirect_root_id,
          retrieval_algorithm_version,matching_signals_json,
          conflicting_signals_json,relation,reason_code,created_at,updated_at
        ) VALUES (
          '${publicId}','run-1','position-item-1','position-1','${hashA}',
          'existing_public','public-job-1',1,'public-job-2',
          'public-duplicate-retrieval-v1','[]','[]','same',
          'same_source_position','${now}','${now}'
        )
      `);
      expect(() =>
        database.exec(`
          INSERT INTO public_projection_duplicate_comparisons (
            id,run_id,owner_position_item_id,owner_source_position_id,
            owner_input_hash,target_kind,target_public_job_id,
            target_public_job_version,target_redirect_root_id,
            retrieval_algorithm_version,matching_signals_json,
            conflicting_signals_json,relation,reason_code,created_at,updated_at
          ) VALUES (
            'pdup_v1_${"e".repeat(64)}','run-1','position-item-2','position-2',
            '${hashA}','existing_public','public-job-1',1,'public-job-1',
            'public-duplicate-retrieval-v1','[]','[]','same',
            'same_source_position','${now}','${now}'
          )
        `)
      ).toThrow("duplicate comparison public root is not terminal");
      database.exec(`
        UPDATE public_projection_duplicate_work
           SET phase='ready',comparison_count=2,lease_token='seal-lease',
               member_digest='${hashA}',comparison_digest='${hashB}',
               updated_at='${now}'
         WHERE run_id='run-1';
        INSERT INTO public_projection_duplicate_batches (
          run_id,retrieval_algorithm_version,input_hash,
          position_member_count,comparison_count,member_digest,
          comparison_digest,canonical_identity_state,created_at
        ) VALUES (
          'run-1','public-duplicate-retrieval-v1','${hashB}',2,2,
          '${hashA}','${hashB}','pending','${now}'
        );
        UPDATE public_projection_duplicate_work
           SET phase='sealed',status='sealed',lease_token=NULL,
               lease_expires_at=NULL,updated_at='${now}'
         WHERE run_id='run-1';
      `);

      expect(() =>
        database.exec(`
          UPDATE public_projection_duplicate_comparisons
          SET reason_code='conflicting_stable_identifier'
          WHERE id='${sameRunId}'
        `)
      ).toThrow("duplicate comparisons are immutable");
      expect(() =>
        database.exec(
          "DELETE FROM public_projection_duplicate_batches WHERE run_id='run-1'"
        )
      ).toThrow("duplicate batches are append-only");
      expect(() =>
        database.exec(`
          INSERT INTO public_projection_duplicate_comparisons (
            id,run_id,owner_position_item_id,owner_source_position_id,
            owner_input_hash,target_kind,target_position_item_id,
            target_source_position_id,target_input_hash,
            retrieval_algorithm_version,matching_signals_json,
            conflicting_signals_json,relation,reason_code,created_at,updated_at
          ) VALUES (
            'pdup_v1_${"9".repeat(64)}','run-1','position-item-1','position-1',
            '${hashA}','same_run','position-item-2','position-2','${hashA}',
            'public-duplicate-retrieval-v1','[]','[]','same',
            'same_source_reference_position','${now}','${now}'
          )
        `)
      ).toThrow("duplicate comparisons are sealed");
      expect(() =>
        database.exec(`
          INSERT INTO public_projection_duplicate_batch_members (
            run_id,ordinal,position_item_id,source_position_id,input_hash,
            listing_id,source_key,position_key,source_reference,
            source_reference_signal_hash,material_signal_hash,created_at
          ) VALUES (
            'run-1',2,'position-item-1','position-1','${hashA}',
            'listing-1','seriousteachers','direct','',NULL,'${hashA}','${now}'
          )
        `)
      ).toThrow("duplicate batch members are sealed");
      expect(() =>
        database.exec(`
          INSERT INTO public_projection_position_items (
            id,run_id,listing_item_id,source_position_id,input_hash,
            stage,status,created_at,updated_at
          ) VALUES (
            'post-seal-position','run-1','listing-item-1','position-1',
            '${hashA}','identity','queued','${now}','${now}'
          )
        `)
      ).toThrow("projection duplicate position set is sealed");
      expect(() =>
        database.exec(`
          UPDATE public_projection_position_items
             SET stage='content',updated_at='${now}'
           WHERE id='position-item-1'
        `)
      ).not.toThrow();
      expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
      for (const view of publicViews) {
        expect(count(database, view)).toBe(0);
      }
    } finally {
      database.close();
    }
  });
});
