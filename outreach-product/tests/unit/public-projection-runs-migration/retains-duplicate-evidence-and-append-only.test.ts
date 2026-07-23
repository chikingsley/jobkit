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
});
