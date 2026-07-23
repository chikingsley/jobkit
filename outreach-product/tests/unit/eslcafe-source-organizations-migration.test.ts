import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    import.meta.dir,
    "../../migrations/0066_eslcafe_source_organizations.sql"
  ),
  "utf8"
);

describe("ESL Cafe source organization migration", () => {
  it("creates one accepted organization link per active attributed listing", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE job_listings (
        id TEXT PRIMARY KEY,
        board TEXT NOT NULL,
        company TEXT NOT NULL,
        source_url TEXT NOT NULL,
        inventory_status TEXT NOT NULL,
        source_last_seen_at TEXT,
        first_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY,
        country_code TEXT NOT NULL,
        country_name TEXT NOT NULL,
        name TEXT NOT NULL,
        identity_key TEXT NOT NULL,
        city TEXT NOT NULL,
        region TEXT NOT NULL,
        website_url TEXT NOT NULL,
        canonical_domain TEXT NOT NULL,
        market_segment TEXT NOT NULL,
        status TEXT NOT NULL,
        outreach_eligibility TEXT NOT NULL,
        evidence_url TEXT NOT NULL,
        source_sweep_id TEXT,
        last_verified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE organization_opportunities (
        organization_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        evidence_url TEXT NOT NULL,
        linked_at TEXT NOT NULL,
        PRIMARY KEY (organization_id,job_id)
      );
      CREATE TABLE organization_opportunity_acceptances (
        organization_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        accepted_by_user_id TEXT NOT NULL,
        accepted_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (organization_id,job_id)
      );
      INSERT INTO users VALUES
        ('member','member','2026-01-01T00:00:00.000Z'),
        ('operator','operator','2026-01-02T00:00:00.000Z');
      INSERT INTO job_listings VALUES
        ('one','eslcafe-modern','Example School','https://source.test/one',
         'active','2026-07-22T00:00:00.000Z','2026-07-01T00:00:00.000Z',
         '2026-07-22T00:00:00.000Z'),
        ('two','eslcafe-modern','EXAMPLE SCHOOL','https://source.test/two',
         'active','2026-07-23T00:00:00.000Z','2026-07-02T00:00:00.000Z',
         '2026-07-23T00:00:00.000Z'),
        ('stale','eslcafe-modern','Old School','https://source.test/stale',
         'stale','2026-06-01T00:00:00.000Z','2026-05-01T00:00:00.000Z',
         '2026-06-01T00:00:00.000Z');
    `);

    database.exec(migration);
    database.exec(migration);

    expect(
      database
        .query("SELECT lower(name) normalized_name FROM organizations")
        .all()
    ).toEqual([{ normalized_name: "example school" }]);
    expect(
      database
        .query(
          `SELECT job_id
             FROM organization_opportunity_acceptances
            ORDER BY job_id`
        )
        .all()
    ).toEqual([{ job_id: "one" }, { job_id: "two" }]);
    expect(
      database
        .query(
          `SELECT DISTINCT accepted_by_user_id
             FROM organization_opportunity_acceptances`
        )
        .all()
    ).toEqual([{ accepted_by_user_id: "operator" }]);
  });
});
