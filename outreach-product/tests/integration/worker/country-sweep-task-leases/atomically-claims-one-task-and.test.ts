import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { reapAgentTasks } from "../../../../worker/services/agent-task-broker";
import { createAuthenticatedUser } from ".././auth";
import {
  authenticatedRequest,
  claimTask,
  createResearchRunner,
  createSweep,
  emptyOutput,
  expireTaskPair,
  failTask,
  readSourceTaskId,
  requireTask,
  runnerRequest,
  testEnv,
} from "./support/model";

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
});
