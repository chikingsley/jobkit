import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    import.meta.dir,
    "../../migrations/0050_job_listing_version_immutability.sql"
  ),
  "utf8"
);
const timestamp = "2026-07-22T12:00:00.000Z";
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

describe("listing version immutability migration", () => {
  for (const populated of [false, true]) {
    test(`applies to a ${populated ? "populated" : "fresh"} listing database`, () => {
      const database = createDatabase(populated);
      try {
        database.exec(migration);

        expect(
          database
            .query(
              `SELECT name FROM sqlite_master
                WHERE type='trigger'
                  AND name LIKE 'trg_job_listing_version_%_immutable'
                ORDER BY name`
            )
            .all()
        ).toEqual([
          { name: "trg_job_listing_version_delete_immutable" },
          { name: "trg_job_listing_version_update_immutable" },
        ]);
        expect(database.query("PRAGMA integrity_check").get()).toEqual({
          integrity_check: "ok",
        });
        expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        database.close();
      }
    });
  }

  test("rejects every update and delete while preserving the snapshot", () => {
    const database = createDatabase(true);
    try {
      database.exec(migration);

      expect(() =>
        database.exec(
          `UPDATE job_listing_versions SET material_hash='${hashB}'
            WHERE listing_id='listing-1' AND material_version=1`
        )
      ).toThrow("job listing versions are immutable");
      expect(() =>
        database.exec(
          `UPDATE job_listing_versions SET material_hash=material_hash
            WHERE listing_id='listing-1' AND material_version=1`
        )
      ).toThrow("job listing versions are immutable");
      expect(() =>
        database.exec(
          `DELETE FROM job_listing_versions
            WHERE listing_id='listing-1' AND material_version=1`
        )
      ).toThrow("job listing versions are append-only");
      expect(versionRows(database)).toEqual([
        {
          listing_id: "listing-1",
          material_hash: hashA,
          material_version: 1,
        },
      ]);
    } finally {
      database.close();
    }
  });

  test("allows a normal material successor and a clean head advance", () => {
    const database = createDatabase(true);
    try {
      database.exec(migration);
      database.exec(`
        BEGIN IMMEDIATE;
        UPDATE job_listings
           SET material_hash='${hashB}',material_hash_version=1,
               material_version=2,material_changed_at='${timestamp}'
         WHERE id='listing-1';
        INSERT INTO job_listing_versions (
          listing_id,material_version,material_hash,material_hash_version,
          material_json,created_at
        ) VALUES (
          'listing-1',2,'${hashB}',1,'{"title":"Changed"}','${timestamp}'
        );
        COMMIT;
      `);

      expect(versionRows(database)).toEqual([
        {
          listing_id: "listing-1",
          material_hash: hashA,
          material_version: 1,
        },
        {
          listing_id: "listing-1",
          material_hash: hashB,
          material_version: 2,
        },
      ]);
      expect(
        database
          .query(
            `SELECT material_hash,material_hash_version,material_version
               FROM job_listings WHERE id='listing-1'`
          )
          .get()
      ).toEqual({
        material_hash: hashB,
        material_hash_version: 1,
        material_version: 2,
      });
      expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  test("retains an inventory run referenced by immutable version history", () => {
    const database = createDatabase(true);
    try {
      database.exec(`
        INSERT INTO inventory_runs (id) VALUES ('run-unreferenced');
        INSERT INTO inventory_runs (id) VALUES ('run-referenced');
        UPDATE job_listing_versions
           SET inventory_run_id='run-referenced'
         WHERE listing_id='listing-1' AND material_version=1;
      `);
      database.exec(migration);

      database.exec("DELETE FROM inventory_runs WHERE id='run-unreferenced'");
      expect(() =>
        database.exec("DELETE FROM inventory_runs WHERE id='run-referenced'")
      ).toThrow("job listing versions are immutable");
      expect(
        database.query("SELECT id FROM inventory_runs ORDER BY id").all()
      ).toEqual([{ id: "run-referenced" }]);
      expect(
        database
          .query(
            `SELECT listing_id,material_version,inventory_run_id
               FROM job_listing_versions
              WHERE listing_id='listing-1' AND material_version=1`
          )
          .get()
      ).toEqual({
        inventory_run_id: "run-referenced",
        listing_id: "listing-1",
        material_version: 1,
      });
      expect(database.query("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
      expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});

function createDatabase(populated: boolean) {
  const database = new Database(":memory:", { strict: true });
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE inventory_runs (id TEXT PRIMARY KEY);
    CREATE TABLE job_listings (
      id TEXT PRIMARY KEY,
      material_hash TEXT NOT NULL DEFAULT '',
      material_hash_version INTEGER NOT NULL DEFAULT 0,
      material_version INTEGER NOT NULL DEFAULT 1,
      material_changed_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE job_listing_versions (
      listing_id TEXT NOT NULL
        REFERENCES job_listings(id) ON DELETE RESTRICT,
      material_version INTEGER NOT NULL CHECK (material_version>0),
      material_hash TEXT NOT NULL,
      material_hash_version INTEGER NOT NULL CHECK (material_hash_version>=0),
      material_json TEXT CHECK (
        material_json IS NULL OR json_valid(material_json)
      ),
      source_posted_date TEXT,
      source_posted_date_raw TEXT NOT NULL DEFAULT '',
      source_posted_date_provenance TEXT NOT NULL DEFAULT 'unknown',
      source_expiry_date TEXT,
      source_expiry_date_raw TEXT NOT NULL DEFAULT '',
      source_expiry_date_provenance TEXT NOT NULL DEFAULT 'unknown',
      inventory_run_id TEXT
        REFERENCES inventory_runs(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (listing_id,material_version)
    );
  `);
  if (populated) {
    database.exec(`
      INSERT INTO job_listings (
        id,material_hash,material_hash_version,material_version,
        material_changed_at,updated_at
      ) VALUES (
        'listing-1','${hashA}',1,1,'${timestamp}','${timestamp}'
      );
      INSERT INTO job_listing_versions (
        listing_id,material_version,material_hash,material_hash_version,
        material_json,created_at
      ) VALUES (
        'listing-1',1,'${hashA}',1,'{"title":"Original"}','${timestamp}'
      );
    `);
  }
  return database;
}

function versionRows(database: Database) {
  return database
    .query(
      `SELECT listing_id,material_version,material_hash
         FROM job_listing_versions ORDER BY listing_id,material_version`
    )
    .all();
}
