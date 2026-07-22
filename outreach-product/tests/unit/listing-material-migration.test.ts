import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("listing material migration", () => {
  test("seeds legacy history under hash version zero", async () => {
    const database = new Database(":memory:", { strict: true });
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE inventory_runs (id TEXT PRIMARY KEY);
        CREATE TABLE job_listings (
          id TEXT PRIMARY KEY,
          source_content_hash TEXT NOT NULL DEFAULT '',
          inventory_run_id TEXT REFERENCES inventory_runs(id),
          updated_at TEXT NOT NULL
        );
        INSERT INTO job_listings (
          id,source_content_hash,inventory_run_id,updated_at
        ) VALUES (
          'legacy-job','legacy-envelope-hash',NULL,
          '2026-07-01T12:00:00.000Z'
        );
      `);
      const migration = await readFile(
        resolve(
          import.meta.dir,
          "../../migrations/0047_listing_material_versions.sql"
        ),
        "utf8"
      );

      database.exec(migration);

      expect(
        database
          .query(
            `SELECT material_hash,material_hash_version,material_version,
                    material_changed_at
               FROM job_listings WHERE id='legacy-job'`
          )
          .get()
      ).toEqual({
        material_changed_at: "2026-07-01T12:00:00.000Z",
        material_hash: "legacy-envelope-hash",
        material_hash_version: 0,
        material_version: 1,
      });
      expect(
        database
          .query(
            `SELECT listing_id,material_version,material_hash,
                    material_hash_version,material_json,created_at
               FROM job_listing_versions WHERE listing_id='legacy-job'`
          )
          .get()
      ).toEqual({
        created_at: "2026-07-01T12:00:00.000Z",
        listing_id: "legacy-job",
        material_hash: "legacy-envelope-hash",
        material_hash_version: 0,
        material_json: null,
        material_version: 1,
      });
    } finally {
      database.close();
    }
  });
});
