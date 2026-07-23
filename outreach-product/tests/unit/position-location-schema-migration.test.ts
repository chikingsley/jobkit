import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    import.meta.dir,
    "../../migrations/0065_position_location_schema_v3.sql"
  ),
  "utf8"
);

describe("position location schema v3 migration", () => {
  it("preserves evidence while adding explicit unknown location semantics", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE job_position_analyses (
        job_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL
      );
      CREATE TABLE job_position_variants (
        job_id TEXT NOT NULL,
        locations_json TEXT NOT NULL
      );
      INSERT INTO job_position_analyses (job_id,schema_version)
      VALUES ('legacy',2),('current',3);
      INSERT INTO job_position_variants (job_id,locations_json)
      VALUES
        (
          'legacy',
          '[{"evidence":"in China","value":"China"}]'
        ),
        (
          'current',
          '[{"addressComponents":[],"evidence":"in Poland","parentGeographies":[],"role":"worksite","scope":"countrywide","semanticKind":"country","value":"Poland","workplaceType":"onsite"}]'
        );
    `);

    database.exec(migration);

    const analyses = database
      .query(
        "SELECT job_id,schema_version FROM job_position_analyses ORDER BY job_id"
      )
      .all();
    const variants = database
      .query(
        "SELECT job_id,locations_json FROM job_position_variants ORDER BY job_id"
      )
      .all() as Array<{ job_id: string; locations_json: string }>;
    const current = variants.at(0);
    const legacy = variants.at(1);
    if (!(current && legacy)) {
      throw new Error("Expected both current and migrated location rows");
    }

    expect(analyses).toEqual([
      { job_id: "current", schema_version: 3 },
      { job_id: "legacy", schema_version: 3 },
    ]);
    expect(JSON.parse(current.locations_json)).toEqual([
      {
        addressComponents: [],
        evidence: "in Poland",
        parentGeographies: [],
        role: "worksite",
        scope: "countrywide",
        semanticKind: "country",
        value: "Poland",
        workplaceType: "onsite",
      },
    ]);
    expect(JSON.parse(legacy.locations_json)).toEqual([
      {
        addressComponents: [],
        evidence: "in China",
        parentGeographies: [],
        role: "unknown",
        scope: "unknown",
        semanticKind: "unknown",
        value: "China",
        workplaceType: "unknown",
      },
    ]);
  });
});
