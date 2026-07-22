import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { reapAgentTasks } from "../../../worker/services/agent-task-broker";
import { materializeOneCountrySweepItem } from "../../../worker/services/country-materialization/materializer";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("country sweep task leases", () => {
  it("atomically claims one task and consumes one attempt in a race", async () => {
    const { cookie, userId } = await createSweep("country-race@example.test");
    const [firstRunner, secondRunner] = await Promise.all([
      createResearchRunner(cookie, "Country race one"),
      createResearchRunner(cookie, "Country race two"),
    ]);

    const claims = await Promise.all([
      claimTask(firstRunner.token),
      claimTask(secondRunner.token),
    ]);
    const claimed = claims.filter((task) => task !== null);

    expect(claimed).toHaveLength(1);
    expect(
      await testEnv.DB.prepare(
        `SELECT task.status,task.attempt_count,task.lease_token,
                run.attempt_number,run.lease_token run_lease_token
           FROM country_sweep_tasks task
           JOIN agent_task_runs run ON run.source_task_id=task.id
          WHERE run.status='running' AND run.user_id=?`
      )
        .bind(userId)
        .first()
    ).toMatchObject({
      attempt_count: 1,
      attempt_number: 1,
      status: "claimed",
    });
    const leases = await testEnv.DB.prepare(
      `SELECT task.lease_token task_token,run.lease_token run_token
         FROM country_sweep_tasks task
         JOIN agent_task_runs run ON run.source_task_id=task.id
        WHERE run.status='running' AND run.user_id=?`
    )
      .bind(userId)
      .first<{ run_token: string; task_token: string }>();
    expect(leases?.task_token).toBe(claimed[0]?.leaseToken);
    expect(leases?.run_token).toBe(claimed[0]?.leaseToken);
    await expect(
      testEnv.DB.prepare(
        `SELECT task.attempt_count
           FROM country_sweep_tasks task
           JOIN country_sweeps sweep ON sweep.id=task.sweep_id
          WHERE sweep.requested_by_user_id=?`
      )
        .bind(userId)
        .first("attempt_count")
    ).resolves.toBe(1);
    await expect(
      testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM agent_task_runs WHERE user_id=?"
      )
        .bind(userId)
        .first("count")
    ).resolves.toBe(1);
  });

  it("rejects stale tokens and extends both active leases together", async () => {
    const { cookie } = await createSweep("country-heartbeat@example.test");
    const runner = await createResearchRunner(cookie, "Country heartbeat");
    const task = requireTask(await claimTask(runner.token));
    const stale = await runnerRequest(
      `/api/agent-tasks/${task.runId}/heartbeat`,
      runner.token,
      { leaseToken: "stale-country-token" }
    );
    expect(stale.status).toBe(409);

    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `UPDATE country_sweep_tasks
              SET lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 minute')
            WHERE lease_token=?`
      ).bind(task.leaseToken),
      testEnv.DB.prepare(
        `UPDATE agent_task_runs
              SET lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 minute')
            WHERE id=?`
      ).bind(task.runId),
    ]);
    const heartbeat = await runnerRequest(
      `/api/agent-tasks/${task.runId}/heartbeat`,
      runner.token,
      { leaseToken: task.leaseToken }
    );
    expect(heartbeat.status).toBe(200);
    const leases = await testEnv.DB.prepare(
      `SELECT task.lease_expires_at task_expiry,run.lease_expires_at run_expiry
         FROM country_sweep_tasks task
         JOIN agent_task_runs run ON run.source_task_id=task.id
        WHERE run.id=?`
    )
      .bind(task.runId)
      .first<{ run_expiry: string; task_expiry: string }>();
    expect(leases?.run_expiry).toBe(leases?.task_expiry);
    expect(Date.parse(leases?.run_expiry ?? "")).toBeGreaterThan(Date.now());

    const [staleCompletion, staleFailure] = await Promise.all([
      runnerRequest(`/api/agent-tasks/${task.runId}/complete`, runner.token, {
        leaseToken: "stale-country-token",
        output: emptyOutput(),
      }),
      runnerRequest(`/api/agent-tasks/${task.runId}/fail`, runner.token, {
        error: "stale failure",
        errorCode: "provider_unavailable",
        leaseToken: "stale-country-token",
      }),
    ]);
    expect(staleCompletion.status).toBe(409);
    expect(staleFailure.status).toBe(409);
    await expect(
      testEnv.DB.prepare(
        "SELECT status FROM country_sweep_tasks WHERE lease_token=?"
      )
        .bind(task.leaseToken)
        .first("status")
    ).resolves.toBe("claimed");
  });

  it("pins a migrated input hash before consuming its first attempt", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "country-legacy-hash@example.test"
    );
    const sweepId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO country_sweeps
          (id,country_code,country_name,requested_by_user_id,status,
           requested_scope_json,task_total,requested_at,updated_at)
         VALUES (?, 'TJ','Tajikistan',?,'queued','{}',1,
                 '2026-07-22T00:00:00.000Z','2026-07-22T00:00:00.000Z')`
      ).bind(sweepId, userId),
      testEnv.DB.prepare(
        `INSERT INTO country_sweep_tasks
          (id,sweep_id,phase,scope_key,status,input_json,input_hash,
           created_at,updated_at)
         VALUES (?,?,'discovery','legacy:TJ','queued',?, ?,
                 '2026-07-22T00:00:00.000Z','2026-07-22T00:00:00.000Z')`
      ).bind(
        taskId,
        sweepId,
        JSON.stringify({ countryCode: "TJ", phase: "discovery" }),
        "0".repeat(64)
      ),
    ]);
    const runner = await createResearchRunner(cookie, "Country legacy hash");

    await expect(claimTask(runner.token)).resolves.toBeNull();
    const pinned = await testEnv.DB.prepare(
      `SELECT status,attempt_count,input_hash FROM country_sweep_tasks
        WHERE id=?`
    )
      .bind(taskId)
      .first<{ attempt_count: number; input_hash: string; status: string }>();
    expect(pinned).toMatchObject({ attempt_count: 0, status: "queued" });
    expect(pinned?.input_hash).toHaveLength(64);
    expect(pinned?.input_hash).not.toBe("0".repeat(64));

    const claimed = requireTask(await claimTask(runner.token));
    expect(claimed.attemptNumber).toBe(1);
    await expect(readSourceTaskId(claimed.runId)).resolves.toBe(taskId);
  });

  it("retries transient failures and fences an earlier attempt", async () => {
    const { cookie } = await createSweep("country-retry@example.test");
    const runner = await createResearchRunner(cookie, "Country retry");
    const first = requireTask(await claimTask(runner.token));
    const failed = await failTask(
      runner.token,
      first,
      "provider_unavailable",
      "Temporary provider outage"
    );
    expect(failed.status).toBe(200);

    const second = requireTask(await claimTask(runner.token));
    const sourceTaskId = await readSourceTaskId(second.runId);
    expect(second.attemptNumber).toBe(2);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    const staleCompletion = await runnerRequest(
      `/api/agent-tasks/${first.runId}/complete`,
      runner.token,
      { leaseToken: first.leaseToken, output: emptyOutput() }
    );
    expect(staleCompletion.status).toBe(409);
    expect(
      await testEnv.DB.prepare(
        `SELECT status,attempt_count,lease_token
           FROM country_sweep_tasks WHERE id=?`
      )
        .bind(sourceTaskId)
        .first()
    ).toMatchObject({
      attempt_count: 2,
      lease_token: second.leaseToken,
      status: "claimed",
    });
    expect(
      await testEnv.DB.prepare(
        "SELECT status,error_code FROM agent_task_runs WHERE id=?"
      )
        .bind(first.runId)
        .first()
    ).toEqual({ error_code: "provider_unavailable", status: "failed" });
  });

  it("exhausts retryable attempts and records exact sweep gaps", async () => {
    const { cookie } = await createSweep("country-exhaustion@example.test");
    const runner = await createResearchRunner(cookie, "Country exhaustion");
    let sourceTaskId = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: The next attempt exists only after the prior failure commits.
      const task = requireTask(await claimTask(runner.token));
      sourceTaskId ||= await readSourceTaskId(task.runId);
      expect(task.attemptNumber).toBe(attempt);
      const response = await failTask(
        runner.token,
        task,
        "provider_unavailable",
        `Temporary failure ${attempt.toString()}`
      );
      expect(response.status).toBe(200);
    }
    expect(
      await testEnv.DB.prepare(
        `SELECT status,attempt_count,error_code FROM country_sweep_tasks
          WHERE id=?`
      )
        .bind(sourceTaskId)
        .first()
    ).toEqual({
      attempt_count: 3,
      error_code: "provider_unavailable",
      status: "failed",
    });
    expect(
      await testEnv.DB.prepare(
        `SELECT status,task_total,task_completed,task_failed,
                missing_scope_count FROM country_sweeps
          WHERE id=(SELECT sweep_id FROM country_sweep_tasks WHERE id=?)`
      )
        .bind(sourceTaskId)
        .first()
    ).toEqual({
      missing_scope_count: 1,
      status: "running",
      task_completed: 0,
      task_failed: 1,
      task_total: 2,
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM country_sweep_tasks
          WHERE phase='coverage_audit' AND status='queued'
            AND sweep_id=(SELECT sweep_id FROM country_sweep_tasks WHERE id=?)`
      )
        .bind(sourceTaskId)
        .first("count")
    ).resolves.toBe(1);
  });

  it("reaps expired attempts through retry and terminal exhaustion", async () => {
    const { cookie, userId } = await createSweep("country-expiry@example.test");
    const runner = await createResearchRunner(cookie, "Country expiry");
    let sourceTaskId = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: Each reap creates the next eligible durable attempt.
      const task = requireTask(await claimTask(runner.token));
      sourceTaskId ||= await readSourceTaskId(task.runId);
      await expireTaskPair(task);
      await reapAgentTasks(testEnv, userId);
      const row = await testEnv.DB.prepare(
        "SELECT status,attempt_count,error_code FROM country_sweep_tasks WHERE id=?"
      )
        .bind(sourceTaskId)
        .first();
      expect(row).toMatchObject({
        attempt_count: attempt,
        error_code: "lease_expired",
        status: attempt < 3 ? "queued" : "failed",
      });
    }
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM agent_task_runs
          WHERE status='failed' AND error_code='lease_expired'
            AND source_task_id=?`
      )
        .bind(sourceTaskId)
        .first("count")
    ).resolves.toBe(3);
    expect(
      await testEnv.DB.prepare(
        `SELECT task_total,task_failed,missing_scope_count
           FROM country_sweeps WHERE requested_by_user_id=?`
      )
        .bind(userId)
        .first()
    ).toEqual({ missing_scope_count: 1, task_failed: 1, task_total: 2 });
  });

  it("keeps country-only maintenance active until every expired lease is selected", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "country-maintenance-drain@example.test"
    );
    const sweep = await authenticatedRequest(
      "/api/countries/TJ/sweeps",
      cookie,
      "POST",
      {}
    );
    expect(sweep.status).toBe(200);
    const [firstRunner, secondRunner] = await Promise.all([
      createResearchRunner(cookie, "Country drain one"),
      createResearchRunner(cookie, "Country drain two"),
    ]);
    const firstTask = requireTask(await claimTask(firstRunner.token));
    const secondTask = requireTask(await claimTask(secondRunner.token));
    await Promise.all([expireTaskPair(firstTask), expireTaskPair(secondTask)]);

    await expect(reapAgentTasks(testEnv, userId)).resolves.toEqual({
      processed: 1,
      selected: 1,
    });
    await expect(reapAgentTasks(testEnv, userId)).resolves.toEqual({
      processed: 1,
      selected: 1,
    });
    await expect(reapAgentTasks(testEnv, userId)).resolves.toEqual({
      processed: 0,
      selected: 0,
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM country_sweep_tasks task
          JOIN country_sweeps sweep ON sweep.id=task.sweep_id
         WHERE sweep.requested_by_user_id=? AND task.status='claimed'`
      )
        .bind(userId)
        .first<number>("count")
    ).resolves.toBe(0);
  });

  it("fences a revoked runner and requeues its exact attempt", async () => {
    const { cookie } = await createSweep("country-revoked@example.test");
    const runner = await createResearchRunner(cookie, "Country revoked");
    const task = requireTask(await claimTask(runner.token));
    const sourceTaskId = await readSourceTaskId(task.runId);

    const revoked = await authenticatedRequest(
      `/api/agent-runners/${runner.id}`,
      cookie,
      "DELETE"
    );
    expect(revoked.status).toBe(200);
    expect(
      await testEnv.DB.prepare(
        `SELECT status,attempt_count,error_code,worker_id,lease_token
           FROM country_sweep_tasks WHERE id=?`
      )
        .bind(sourceTaskId)
        .first()
    ).toEqual({
      attempt_count: 1,
      error_code: "runner_revoked",
      lease_token: null,
      status: "queued",
      worker_id: null,
    });
    expect(
      await testEnv.DB.prepare(
        "SELECT status,error_code FROM agent_task_runs WHERE id=?"
      )
        .bind(task.runId)
        .first()
    ).toEqual({ error_code: "runner_revoked", status: "failed" });
  });

  it("accepts immutable output before domain work and rolls back a guarded materialization", async () => {
    const { cookie, userId } = await createSweep(
      "country-rollback@example.test"
    );
    const runner = await createResearchRunner(cookie, "Country rollback");
    const task = requireTask(await claimTask(runner.token));
    const sweep = await testEnv.DB.prepare(
      "SELECT id FROM country_sweeps WHERE requested_by_user_id=?"
    )
      .bind(userId)
      .first<{ id: string }>();
    if (!sweep) {
      throw new Error("Country sweep was not created");
    }
    await testEnv.DB.prepare(
      `INSERT INTO organizations
        (id,country_code,country_name,name,identity_key,city,region,website_url,
         canonical_domain,market_segment,status,outreach_eligibility,
         evidence_url,source_sweep_id,created_at,updated_at)
       VALUES (
         'existing-school','TJ','Tajikistan','Existing School',
         'domain:existing-school.tj','Dushanbe','','https://existing-school.tj',
         'existing-school.tj','private_school','active','eligible',
         'https://existing-school.tj',?,
         '2026-07-22T00:00:00.000Z','2026-07-22T00:00:00.000Z'
       )`
    )
      .bind(sweep.id)
      .run();
    await testEnv.DB.prepare(
      `CREATE TRIGGER ignore_country_organization_update
       BEFORE UPDATE ON organizations
       WHEN OLD.id='existing-school'
       BEGIN
         SELECT RAISE(IGNORE);
       END`
    ).run();

    const response = await runnerRequest(
      `/api/agent-tasks/${task.runId}/complete`,
      runner.token,
      { leaseToken: task.leaseToken, output: oneOrganizationOutput() }
    );
    expect(response.status).toBe(200);
    const accepted = (await response.json()) as {
      result: { domainResult: { outputId: string } };
    };
    expect(
      await testEnv.DB.prepare(
        `SELECT task.status,task.output_json,run.status run_status,
                run.result_json
           FROM country_sweep_tasks task
           JOIN agent_task_runs run ON run.source_task_id=task.id
          WHERE run.id=?`
      )
        .bind(task.runId)
        .first()
    ).toEqual({
      output_json: expect.any(String),
      result_json: expect.any(String),
      run_status: "completed",
      status: "materializing",
    });
    await expect(
      materializeOneCountrySweepItem(
        testEnv,
        accepted.result.domainResult.outputId
      )
    ).rejects.toThrow("Country materialization lease changed");
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM organization_evidence evidence
          JOIN organizations organization ON organization.id=evidence.organization_id
         WHERE organization.id='existing-school'`
      ).first("count")
    ).resolves.toBe(0);
    expect(
      await testEnv.DB.prepare(
        `SELECT status,attempt_count FROM country_sweep_materialization_items
          WHERE output_id=? AND kind='organizations_chunk'`
      )
        .bind(accepted.result.domainResult.outputId)
        .first()
    ).toEqual({ attempt_count: 1, status: "queued" });
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM country_sweep_output_organizations
          WHERE output_id=?`
      )
        .bind(accepted.result.domainResult.outputId)
        .first("count")
    ).resolves.toBe(0);
  });
});

async function createSweep(email: string) {
  const auth = await createAuthenticatedUser(email);
  const response = await authenticatedRequest(
    "/api/countries/TJ/sweeps",
    auth.cookie,
    "POST",
    {
      includeDirectories: false,
      includeKnownSources: false,
      includeMaps: false,
      includeSearch: true,
    }
  );
  if (!response.ok) {
    throw new Error(`Country sweep setup failed: ${await response.text()}`);
  }
  return auth;
}

async function createResearchRunner(cookie: string, runnerName: string) {
  const pairingResponse = await authenticatedRequest(
    "/api/agent-runner-pairings",
    cookie,
    "POST",
    { capabilities: ["research"] }
  );
  const pairing = (await pairingResponse.json()) as {
    pairing: { code: string };
  };
  const exchangeResponse = await publicRequest(
    "/api/agent-runner-pairings/exchange",
    {
      code: pairing.pairing.code,
      codexVersion: "codex-cli test",
      runnerName,
    }
  );
  const exchange = (await exchangeResponse.json()) as {
    runner: { runnerId: string; token: string };
  };
  return { id: exchange.runner.runnerId, token: exchange.runner.token };
}

async function claimTask(token: string) {
  const response = await runnerRequest("/api/agent-tasks/claim", token, {
    runnerVersion: "codex-cli test",
  });
  if (!response.ok) {
    throw new Error(`Country claim failed: ${await response.text()}`);
  }
  const payload = (await response.json()) as {
    task: {
      attemptNumber: number;
      leaseToken: string;
      runId: string;
      taskType: string;
    } | null;
  };
  return payload.task;
}

function requireTask<T>(task: T | null): T {
  if (!task) {
    throw new Error("Country task was not claimed");
  }
  return task;
}

async function readSourceTaskId(runId: string) {
  const row = await testEnv.DB.prepare(
    "SELECT source_task_id FROM agent_task_runs WHERE id=?"
  )
    .bind(runId)
    .first<{ source_task_id: string }>();
  if (!row) {
    throw new Error(`Agent task run ${runId} was not found`);
  }
  return row.source_task_id;
}

function failTask(
  token: string,
  task: { leaseToken: string; runId: string },
  errorCode: string,
  error: string
) {
  return runnerRequest(`/api/agent-tasks/${task.runId}/fail`, token, {
    error,
    errorCode,
    leaseToken: task.leaseToken,
  });
}

function expireTaskPair(task: { leaseToken: string; runId: string }) {
  return testEnv.DB.batch([
    testEnv.DB.prepare(
      `UPDATE country_sweep_tasks
            SET lease_expires_at='2000-01-01T00:00:00.000Z'
          WHERE lease_token=?`
    ).bind(task.leaseToken),
    testEnv.DB.prepare(
      `UPDATE agent_task_runs
            SET lease_expires_at='2000-01-01T00:00:00.000Z'
          WHERE id=?`
    ).bind(task.runId),
  ]);
}

function emptyOutput() {
  return {
    coverageSummary: {
      citiesChecked: [],
      gaps: [],
      needsAnotherPass: false,
      nextScopes: [],
      queriesChecked: [],
      resultCount: 0,
      sourcesChecked: [],
    },
    notes: [],
    organizations: [],
  };
}

function oneOrganizationOutput() {
  return {
    ...emptyOutput(),
    coverageSummary: {
      ...emptyOutput().coverageSummary,
      resultCount: 1,
    },
    organizations: [
      {
        canonicalDomain: "existing-school.tj",
        city: "Dushanbe",
        contactPoints: [],
        evidenceUrl: "https://existing-school.tj",
        lastVerifiedAt: "2026-07-22T00:00:00.000Z",
        marketSegment: "private_school",
        name: "Existing School",
        outreachEligibility: "eligible",
        region: "",
        status: "active",
        websiteUrl: "https://existing-school.tj",
      },
    ],
  };
}

function authenticatedRequest(
  path: string,
  cookie: string,
  method = "GET",
  body?: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      cookie,
    },
    method,
  });
}

function runnerRequest(
  path: string,
  token: string,
  body: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

function publicRequest(path: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
