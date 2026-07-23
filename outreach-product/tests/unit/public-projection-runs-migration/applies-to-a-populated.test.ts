import { describe, expect, test } from "bun:test";

import {
  count,
  createDatabase,
  hashA,
  insertListing,
  insertListingItem,
  insertPositionItem,
  insertRun,
  insertSourcePosition,
  now,
  publicViews,
} from "./support";

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
});
