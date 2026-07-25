import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    import.meta.dir,
    "../../migrations/0052_agent_task_attempt_leases.sql"
  ),
  "utf8"
);

const now = "2026-07-22T12:00:00.000Z";
let database: Database;

beforeEach(() => {
  database = priorSchema();
});

describe("agent task attempt lease migration", () => {
  test("preserves foreign-key dependents and assigns deterministic history", () => {
    insertRequest("request-1", "completed", "runner-1");
    insertRun("run-1", "request-1", "completed", "2026-07-22T10:00:00.000Z");
    insertRun("run-2", "request-1", "failed", "2026-07-22T11:00:00.000Z");
    database.run(
      "INSERT INTO agent_task_artifacts (id,run_id) VALUES ('artifact-1','run-1')"
    );
    database.run(
      "INSERT INTO test_lab_runs (id,agent_task_request_id) VALUES ('test-1','request-1')"
    );
    database.run(
      "INSERT INTO duplicate_evidence (id,agent_task_run_id) VALUES ('duplicate-1','run-2')"
    );

    database.exec(migration);

    expect(
      database
        .query(
          `SELECT id,attempt_number,lease_token
             FROM agent_task_runs ORDER BY attempt_number`
        )
        .all()
    ).toEqual([
      {
        attempt_number: 1,
        id: "run-1",
        lease_token: "historical:run-1",
      },
      {
        attempt_number: 2,
        id: "run-2",
        lease_token: "historical:run-2",
      },
    ]);
    expect(
      database
        .query(
          `SELECT attempt_count,max_attempts,runner_id,lease_token
             FROM agent_task_requests WHERE id='request-1'`
        )
        .get()
    ).toEqual({
      attempt_count: 2,
      lease_token: null,
      max_attempts: 3,
      runner_id: null,
    });
    expect(
      database.query("SELECT COUNT(*) count FROM agent_task_artifacts").get()
    ).toEqual({
      count: 1,
    });
    expect(
      database.query("SELECT COUNT(*) count FROM test_lab_runs").get()
    ).toEqual({
      count: 1,
    });
    expect(
      database.query("SELECT COUNT(*) count FROM duplicate_evidence").get()
    ).toEqual({
      count: 1,
    });
    expect(() =>
      insertRun(
        "run-duplicate",
        "request-1",
        "failed",
        "2026-07-22T13:00:00.000Z",
        2,
        "new-token"
      )
    ).toThrow();
  });

  test("aligns a historical claimed request with its active run", () => {
    insertRequest("request-active", "claimed", "runner-1");
    insertRun(
      "run-active",
      "request-active",
      "running",
      "2026-07-22T11:00:00.000Z"
    );

    database.exec(migration);

    const request = database
      .query(
        `SELECT status,attempt_count,lease_token,runner_id,lease_expires_at
           FROM agent_task_requests WHERE id='request-active'`
      )
      .get();
    const run = database
      .query(
        `SELECT attempt_number,lease_token
           FROM agent_task_runs WHERE id='run-active'`
      )
      .get();
    expect(request).toEqual({
      attempt_count: 1,
      lease_expires_at: "2099-01-01T00:00:00.000Z",
      lease_token: "historical:run-active",
      runner_id: "runner-1",
      status: "claimed",
    });
    expect(run).toEqual({
      attempt_number: 1,
      lease_token: "historical:run-active",
    });
  });

  test("recovers an orphaned historical claim as queued work", () => {
    insertRequest("request-orphan", "claimed", "runner-1");

    database.exec(migration);

    expect(
      database
        .query(
          `SELECT status,runner_id,lease_token,lease_expires_at,last_error_code
             FROM agent_task_requests WHERE id='request-orphan'`
        )
        .get()
    ).toEqual({
      last_error_code: "legacy_orphaned_claim",
      lease_expires_at: null,
      lease_token: null,
      runner_id: null,
      status: "queued",
    });
  });

  test("enforces request lease and terminal history invariants", () => {
    insertRequest("request-guard", "queued", null);
    database.exec(migration);

    expect(() =>
      database.run(
        `UPDATE agent_task_requests
            SET status='claimed',runner_id='runner-1',attempt_count=1
          WHERE id='request-guard'`
      )
    ).toThrow("invalid agent task request lease state");

    database.run(
      `UPDATE agent_task_requests
          SET status='failed',completed_at=?,last_error_code='invalid_input'
        WHERE id='request-guard'`,
      [now]
    );
    expect(() =>
      database.run(
        "UPDATE agent_task_requests SET error_detail='changed' WHERE id='request-guard'"
      )
    ).toThrow("terminal agent task request is immutable");
  });
});

function priorSchema() {
  const db = new Database(":memory:", { strict: true });
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE agent_runners (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      revoked_at TEXT
    );
    CREATE TABLE agent_task_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_type TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
      status TEXT NOT NULL CHECK (
        status IN ('queued','claimed','completed','failed','cancelled')
      ),
      runner_id TEXT REFERENCES agent_runners(id) ON DELETE SET NULL,
      lease_expires_at TEXT,
      result_json TEXT,
      error_detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      claimed_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE agent_task_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      runner_id TEXT NOT NULL REFERENCES agent_runners(id) ON DELETE RESTRICT,
      task_type TEXT NOT NULL,
      source_task_id TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning_effort TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
      result_json TEXT,
      error_detail TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_agent_task_runs_active_source
      ON agent_task_runs(user_id,task_type,source_task_id)
      WHERE status='running';
    CREATE TABLE agent_task_artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_task_runs(id) ON DELETE CASCADE
    );
    CREATE TABLE test_lab_runs (
      id TEXT PRIMARY KEY,
      agent_task_request_id TEXT REFERENCES agent_task_requests(id)
        ON DELETE SET NULL
    );
    CREATE TABLE duplicate_evidence (
      id TEXT PRIMARY KEY,
      agent_task_run_id TEXT REFERENCES agent_task_runs(id) ON DELETE RESTRICT
    );
    INSERT INTO users (id) VALUES ('user-1');
    INSERT INTO agent_runners (id,user_id) VALUES ('runner-1','user-1');
  `);
  return db;
}

function insertRequest(
  id: string,
  status: "claimed" | "completed" | "queued",
  runnerId: string | null
) {
  database
    .query(
      `INSERT INTO agent_task_requests (
        id,user_id,task_type,subject_type,subject_id,status,runner_id,
        lease_expires_at,created_at,completed_at,updated_at
      ) VALUES (
        $id,'user-1','profile.import','profile_import',$id,$status,$runnerId,
        $leaseExpiresAt,$now,$completedAt,$now
      )`
    )
    .run({
      completedAt: status === "completed" ? now : null,
      id,
      leaseExpiresAt: status === "claimed" ? "2099-01-01T00:00:00.000Z" : null,
      now,
      runnerId,
      status,
    });
}

function insertRun(
  id: string,
  sourceTaskId: string,
  status: "completed" | "failed" | "running",
  startedAt: string,
  attemptNumber?: number,
  leaseToken?: string
) {
  const columns = attemptNumber ? ",attempt_number,lease_token" : "";
  const values = attemptNumber ? ",$attemptNumber,$leaseToken" : "";
  const query = database.query(
    `INSERT INTO agent_task_runs (
        id,user_id,runner_id,task_type,source_task_id,prompt_version,model,
        reasoning_effort,source_hash,prompt_hash,status,started_at,
        lease_expires_at,completed_at,updated_at${columns}
      ) VALUES (
        $id,'user-1','runner-1','profile.import',$sourceTaskId,'v1','model',
        'medium','source','prompt',$status,$startedAt,
        '2099-01-01T00:00:00.000Z',$completedAt,$startedAt${values}
      )`
  );
  const bindings = {
    completedAt: status === "running" ? null : startedAt,
    id,
    sourceTaskId,
    startedAt,
    status,
  };
  if (attemptNumber) {
    query.run({
      ...bindings,
      attemptNumber,
      leaseToken: leaseToken ?? "",
    });
    return;
  }
  query.run(bindings);
}
