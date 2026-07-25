import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationsDirectory = resolve(import.meta.dir, "../../migrations");
const migration = readFileSync(
  resolve(migrationsDirectory, "0056_country_sweep_materialization.sql"),
  "utf8"
);
const timestamp = "2026-07-22T12:00:00.000Z";

describe("country sweep materialization migration", () => {
  test("preserves an active output lease and installs immutable manifests", () => {
    const database = migratedThrough55();
    try {
      seedActiveCountryAttempt(database);
      database.exec(migration);

      expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(database.query("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
      expect(
        database
          .query(
            `SELECT id,sweep_id,task_id,agent_run_id,attempt_number,
                    schema_version,status,next_chunk_ordinal,rolling_sha256,
                    chunk_count,total_bytes
               FROM country_sweep_outputs WHERE task_id='task-active'`
          )
          .get()
      ).toEqual({
        agent_run_id: "run-active",
        attempt_number: 1,
        chunk_count: 0,
        id: "historical-output:run-active",
        next_chunk_ordinal: 0,
        rolling_sha256: "0".repeat(64),
        schema_version: 1,
        status: "uploading",
        sweep_id: "sweep-active",
        task_id: "task-active",
        total_bytes: 0,
      });

      database.run(
        `INSERT INTO country_sweep_output_chunks (
          id,output_id,ordinal,kind,object_key,sha256,byte_length,record_count,
          created_at
        ) VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          "chunk-1",
          "historical-output:run-active",
          0,
          "organizations",
          "country-sweeps/output/0-hash.json",
          "a".repeat(64),
          100,
          1,
          timestamp,
        ]
      );
      expect(() =>
        database.run(
          "UPDATE country_sweep_output_chunks SET byte_length=101 WHERE id='chunk-1'"
        )
      ).toThrow("country output chunk is immutable");
      expect(() =>
        database.run(
          "DELETE FROM country_sweep_output_chunks WHERE id='chunk-1'"
        )
      ).toThrow("country output chunk is immutable");
      expect(() =>
        database.run(
          `INSERT INTO country_sweep_materialization_items (
            id,output_id,kind,chunk_id,sequence,status,attempt_count,
            lease_owner,lease_token,lease_expires_at,created_at,updated_at
          ) VALUES (
            'bad-item','historical-output:run-active','organizations_chunk',
            'chunk-1',0,'processing',0,'worker','token',?, ?, ?
          )`,
          [timestamp, timestamp, timestamp]
        )
      ).toThrow();

      database.run(
        `UPDATE country_sweep_outputs
            SET status='accepted',next_chunk_ordinal=1,
                rolling_sha256=?,manifest_sha256=?,chunk_count=1,
                total_bytes=100,organization_count=1,contact_count=0,
                scope_count=0,coverage_summary_json='{"resultCount":1}',
                accepted_at=?,updated_at=?
          WHERE id='historical-output:run-active'`,
        ["b".repeat(64), "c".repeat(64), timestamp, timestamp]
      );
      const acceptedManifestMutations = [
        "next_chunk_ordinal=2",
        `rolling_sha256='${"d".repeat(64)}'`,
        `manifest_sha256='${"e".repeat(64)}'`,
        "chunk_count=2",
        "total_bytes=101",
        "organization_count=2",
        "contact_count=1",
        "scope_count=1",
        `coverage_summary_json='{"resultCount":2}'`,
        "accepted_at='2026-07-23T12:00:00.000Z'",
      ];
      for (const mutation of acceptedManifestMutations) {
        expect(() =>
          database.run(
            `UPDATE country_sweep_outputs SET ${mutation}
              WHERE id='historical-output:run-active'`
          )
        ).toThrow("accepted country output manifest is immutable");
      }
      expect(() =>
        database.run(
          `INSERT INTO country_sweep_output_chunks (
            id,output_id,ordinal,kind,object_key,sha256,byte_length,record_count,
            created_at
          ) VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            "chunk-after-acceptance",
            "historical-output:run-active",
            1,
            "organizations",
            "country-sweeps/output/1-late-hash.json",
            "f".repeat(64),
            100,
            1,
            timestamp,
          ]
        )
      ).toThrow("accepted country output manifest is immutable");

      database.run(
        `UPDATE country_sweep_outputs
            SET status='failed',updated_at=?
          WHERE id='historical-output:run-active'`,
        [timestamp]
      );
      expect(() =>
        database.run(
          `UPDATE country_sweep_outputs
              SET error_detail='changed',updated_at=?
            WHERE id='historical-output:run-active'`,
          [timestamp]
        )
      ).toThrow("terminal country output is immutable");
    } finally {
      database.close();
    }
  });
});

function migratedThrough55() {
  const database = new Database(":memory:", { strict: true });
  database.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(migrationsDirectory)
    .filter((entry) => entry.endsWith(".sql"))
    .filter((entry) => Number(entry.slice(0, 4)) <= 55)
    .sort()) {
    database.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
  }
  return database;
}

function seedActiveCountryAttempt(database: Database) {
  database.exec(`
    INSERT INTO users (
      id,name,email,email_verified,created_at,updated_at
    ) VALUES (
      'user-active','Active User','active@example.test',1,
      '${timestamp}','${timestamp}'
    );

    INSERT INTO agent_runners (
      id,user_id,name,token_hash,capabilities_json,codex_version,last_seen_at,
      created_at,updated_at
    ) VALUES (
      'runner-active','user-active','Active Runner','runner-token-hash',
      '["research"]','codex-cli migration','${timestamp}','${timestamp}',
      '${timestamp}'
    );

    INSERT INTO country_sweeps (
      id,country_code,country_name,requested_by_user_id,status,
      requested_scope_json,coverage_summary_json,task_total,requested_at,
      started_at,updated_at
    ) VALUES (
      'sweep-active','TJ','Tajikistan','user-active','running','{}','{}',1,
      '${timestamp}','${timestamp}','${timestamp}'
    );

    INSERT INTO country_sweep_tasks (
      id,sweep_id,phase,scope_key,status,input_json,input_hash,worker_id,
      claimed_at,lease_token,lease_expires_at,attempt_count,max_attempts,
      created_at,updated_at
    ) VALUES (
      'task-active','sweep-active','discovery','country:TJ','claimed',
      '{"countryCode":"TJ"}','${"a".repeat(64)}','runner-active',
      '${timestamp}','active-lease','2099-01-01T00:00:00.000Z',1,3,
      '${timestamp}','${timestamp}'
    );

    INSERT INTO agent_task_runs (
      id,user_id,runner_id,task_type,source_task_id,prompt_version,model,
      reasoning_effort,source_hash,prompt_hash,status,started_at,
      lease_expires_at,updated_at,attempt_number,lease_token
    ) VALUES (
      'run-active','user-active','runner-active','country_sweep.discovery',
      'task-active','country-sweep.v1','codex','medium','${"a".repeat(64)}',
      '${"b".repeat(64)}','running','${timestamp}',
      '2099-01-01T00:00:00.000Z','${timestamp}',1,'active-lease'
    );
  `);
}
