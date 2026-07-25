import { describe, expect, test } from "bun:test";

import {
  count,
  createDatabase,
  hashA,
  hashB,
  insertListing,
  insertListingItem,
  insertPositionItem,
  insertPublicVersion,
  insertRun,
  insertSourcePosition,
  now,
  publicViews,
} from "./support";

describe("public projection run migration", () => {
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
