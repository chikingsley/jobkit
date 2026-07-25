import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationsDirectory = resolve(import.meta.dir, "../../migrations");
const migration = readFileSync(
  resolve(migrationsDirectory, "0054_country_sweep_task_leases.sql"),
  "utf8"
);
const timestamp = "2026-07-22T12:00:00.000Z";
const leaseExpiry = "2026-07-22T12:15:00.000Z";
const activeHash = "a".repeat(64);
const activeLease = "country-active-lease";

describe("country sweep task lease migration", () => {
  test("preserves populated identities and reconstructs exact attempt leases", () => {
    const database = migratedThrough53();
    try {
      seedHistoricalCountrySweep(database);

      database.exec(migration);

      expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(database.query("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
      expect(
        database
          .query(
            `SELECT status,task_total,task_completed,task_failed,
                    missing_scope_count
               FROM country_sweeps WHERE id='sweep-populated'`
          )
          .get()
      ).toEqual({
        missing_scope_count: 1,
        status: "running",
        task_completed: 1,
        task_failed: 1,
        task_total: 5,
      });
      expect(
        database
          .query(
            `SELECT status,input_hash,worker_id,lease_token,lease_expires_at,
                    attempt_count,max_attempts,error_code
               FROM country_sweep_tasks WHERE id='task-active'`
          )
          .get()
      ).toEqual({
        attempt_count: 2,
        error_code: "",
        input_hash: activeHash,
        lease_expires_at: leaseExpiry,
        lease_token: activeLease,
        max_attempts: 3,
        status: "claimed",
        worker_id: "runner-populated",
      });
      expect(
        database
          .query(
            `SELECT status,input_hash,worker_id,lease_token,lease_expires_at,
                    error_code
               FROM country_sweep_tasks WHERE id='task-orphan'`
          )
          .get()
      ).toEqual({
        error_code: "legacy_orphaned_claim",
        input_hash: "0".repeat(64),
        lease_expires_at: null,
        lease_token: null,
        status: "queued",
        worker_id: null,
      });
      database.run(
        `UPDATE country_sweep_tasks SET input_hash=?
          WHERE id='task-unclaimed'`,
        ["c".repeat(64)]
      );
      expect(() =>
        database.run(
          `UPDATE country_sweep_tasks SET input_hash=?
            WHERE id='task-unclaimed'`,
          ["d".repeat(64)]
        )
      ).toThrow("country task input is immutable");
      expect(
        database
          .query(
            `SELECT attempt_number,lease_token,source_hash,status
               FROM agent_task_runs WHERE id='run-active'`
          )
          .get()
      ).toEqual({
        attempt_number: 2,
        lease_token: activeLease,
        source_hash: activeHash,
        status: "running",
      });
      expect(
        database
          .query(
            `SELECT
               (SELECT source_sweep_id FROM organizations
                 WHERE id='organization-populated') organization_ref,
               (SELECT source_sweep_id FROM organization_evidence
                 WHERE id='evidence-populated') evidence_ref,
               (SELECT sweep_id FROM campaign_markets
                 WHERE campaign_id='campaign-populated'
                   AND country_code='TJ') campaign_ref`
          )
          .get()
      ).toEqual({
        campaign_ref: "sweep-populated",
        evidence_ref: "sweep-populated",
        organization_ref: "sweep-populated",
      });
    } finally {
      database.close();
    }
  });
});

function migratedThrough53() {
  const database = new Database(":memory:", { strict: true });
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(migrationsDirectory)
    .filter((entry) => entry.endsWith(".sql"))
    .filter((entry) => Number(entry.slice(0, 4)) <= 53)
    .sort()) {
    database.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
  return database;
}

function seedHistoricalCountrySweep(database: Database) {
  database.exec(`
    INSERT INTO users (
      id,name,email,email_verified,created_at,updated_at
    ) VALUES (
      'user-populated','Migration User','migration@example.test',1,
      '${timestamp}','${timestamp}'
    );

    INSERT INTO agent_runners (
      id,user_id,name,token_hash,capabilities_json,codex_version,last_seen_at,
      created_at,updated_at
    ) VALUES (
      'runner-populated','user-populated','Migration Runner','runner-token-hash',
      '["research"]','codex-cli migration','${timestamp}','${timestamp}',
      '${timestamp}'
    );

    INSERT INTO country_sweeps (
      id,country_code,country_name,requested_by_user_id,status,
      requested_scope_json,coverage_summary_json,requested_at,started_at,
      updated_at
    ) VALUES (
      'sweep-populated','TJ','Tajikistan','user-populated','claimed','{}','{}',
      '${timestamp}','${timestamp}','${timestamp}'
    );

    INSERT INTO country_sweep_tasks (
      id,sweep_id,phase,scope_key,status,input_json,worker_id,claimed_at,
      lease_expires_at,attempt_count,created_at,updated_at
    ) VALUES
      (
        'task-active','sweep-populated','discovery','country:TJ','claimed',
        '{"countryCode":"TJ"}','runner-populated','${timestamp}',
        '${leaseExpiry}',1,'${timestamp}','${timestamp}'
      ),
      (
        'task-orphan','sweep-populated','coverage_audit','audit:TJ','claimed',
        '{"countryCode":"TJ"}','runner-populated','${timestamp}',
        '${leaseExpiry}',1,'${timestamp}','${timestamp}'
      ),
      (
        'task-completed','sweep-populated','verification','verify:complete',
        'completed','{}',NULL,NULL,NULL,1,'${timestamp}','${timestamp}'
      ),
      (
        'task-failed','sweep-populated','verification','verify:failed',
        'failed','{}',NULL,NULL,NULL,3,'${timestamp}','${timestamp}'
      ),
      (
        'task-unclaimed','sweep-populated','discovery','search:unclaimed',
        'queued','{}',NULL,NULL,NULL,0,'${timestamp}','${timestamp}'
      );

    INSERT INTO agent_task_runs (
      id,user_id,runner_id,task_type,source_task_id,prompt_version,model,
      reasoning_effort,source_hash,prompt_hash,status,started_at,
      lease_expires_at,updated_at,attempt_number,lease_token
    ) VALUES (
      'run-active','user-populated','runner-populated',
      'country_sweep.discovery','task-active','country-sweep.v1','codex',
      'medium','${activeHash}','${"b".repeat(64)}','running','${timestamp}',
      '${leaseExpiry}','${timestamp}',2,'${activeLease}'
    );

    INSERT INTO organizations (
      id,country_code,country_name,name,identity_key,city,website_url,
      canonical_domain,market_segment,status,outreach_eligibility,evidence_url,
      source_sweep_id,created_at,updated_at
    ) VALUES (
      'organization-populated','TJ','Tajikistan','Migration School',
      'domain:migration-school.tj','Dushanbe','https://migration-school.tj',
      'migration-school.tj','private_school','active','eligible',
      'https://migration-school.tj','sweep-populated','${timestamp}',
      '${timestamp}'
    );

    INSERT INTO organization_evidence (
      id,organization_id,source_sweep_id,source_kind,evidence_kind,
      evidence_status,source_url,observed_at,created_at
    ) VALUES (
      'evidence-populated','organization-populated','sweep-populated',
      'country_sweep','organization_profile','active',
      'https://migration-school.tj','${timestamp}','${timestamp}'
    );

    INSERT INTO campaigns (
      id,user_id,name,status,daily_pace,stop_after_human_replies,
      posted_target_percent,first_five_required,policy_snapshot_json,
      created_at,updated_at
    ) VALUES (
      'campaign-populated','user-populated','Migration Campaign','draft',5,3,
      80,1,'{}','${timestamp}','${timestamp}'
    );

    INSERT INTO campaign_markets (
      campaign_id,country_code,country_name,sweep_id,added_at
    ) VALUES (
      'campaign-populated','TJ','Tajikistan','sweep-populated','${timestamp}'
    );
  `);
}
