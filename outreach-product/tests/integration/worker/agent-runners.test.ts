import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("Codex agent pairing", () => {
  it("rejects session authentication on runner-only task routes", async () => {
    const { cookie } = await createAuthenticatedUser(
      "runner-session@example.test"
    );
    const response = await sessionRequest(
      "/api/agent-tasks/claim",
      cookie,
      "POST",
      { runnerVersion: "codex-cli 1.0.0" }
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      message: "Agent runner authentication is required",
      ok: false,
    });
  });

  it("exchanges a one-time pairing code and restricts the resulting token", async () => {
    const { cookie } = await createAuthenticatedUser("agent@example.test");
    const pairing = await sessionRequest(
      "/api/agent-runner-pairings",
      cookie,
      "POST",
      { capabilities: ["research", "evaluation"] }
    );
    const pairingPayload = (await pairing.json()) as {
      pairing: { code: string };
    };
    const request = {
      code: pairingPayload.pairing.code,
      codexVersion: "codex-cli 1.2.3",
      runnerName: "Test Codex agent",
    };
    const exchange = await publicPost(
      "/api/agent-runner-pairings/exchange",
      request
    );
    const exchangePayload = (await exchange.json()) as {
      runner: { runnerId: string; token: string };
    };
    const reused = await publicPost(
      "/api/agent-runner-pairings/exchange",
      request
    );
    const forbidden = await agentPost(
      "/api/jobs/job-id/generate",
      exchangePayload.runner.token,
      {}
    );
    const emptyClaim = await agentPost(
      "/api/agent-tasks/claim",
      exchangePayload.runner.token,
      { runnerVersion: "codex-cli 1.2.4" }
    );

    expect(pairing.status).toBe(200);
    expect(exchange.status).toBe(200);
    expect(reused.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expect(emptyClaim.status).toBe(200);
    expect(await emptyClaim.json()).toMatchObject({ ok: true, task: null });

    const listed = await sessionRequest("/api/agent-runners", cookie);
    expect(await listed.json()).toMatchObject({
      runners: [
        {
          capabilities: ["research", "evaluation"],
          codexVersion: "codex-cli 1.2.4",
          id: exchangePayload.runner.runnerId,
          name: "Test Codex agent",
        },
      ],
    });

    const timestamp = new Date().toISOString();
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO agent_task_requests
          (id,user_id,task_type,subject_type,subject_id,input_json,status,
           runner_id,claimed_at,lease_expires_at,created_at,updated_at)
         SELECT 'revoked-request',user_id,'application.message','job','job-1',
                '{}','claimed',id,?,?,?,?
           FROM agent_runners WHERE id=?`
      ).bind(
        timestamp,
        "2099-01-01T00:00:00.000Z",
        timestamp,
        timestamp,
        exchangePayload.runner.runnerId
      ),
      testEnv.DB.prepare(
        `INSERT INTO agent_task_runs
          (id,user_id,runner_id,task_type,source_task_id,prompt_version,model,
           reasoning_effort,source_hash,prompt_hash,status,started_at,
           lease_expires_at,updated_at)
         SELECT 'revoked-run',user_id,id,'application.message',
                'revoked-request','test-v1','gpt-5.6-luna','medium','source',
                'prompt','running',?,?,?
           FROM agent_runners WHERE id=?`
      ).bind(
        timestamp,
        "2099-01-01T00:00:00.000Z",
        timestamp,
        exchangePayload.runner.runnerId
      ),
    ]);

    const revoked = await sessionRequest(
      `/api/agent-runners/${exchangePayload.runner.runnerId}`,
      cookie,
      "DELETE"
    );
    const afterRevoke = await agentPost(
      "/api/agent-tasks/claim",
      exchangePayload.runner.token,
      { runnerVersion: "codex-cli 1.2.4" }
    );
    expect(revoked.status).toBe(200);
    expect(afterRevoke.status).toBe(401);
    await expect(
      testEnv.DB.prepare(
        "SELECT status,runner_id,error_detail FROM agent_task_requests WHERE id='revoked-request'"
      ).first()
    ).resolves.toEqual({
      error_detail: "Runner revoked; task requeued",
      runner_id: null,
      status: "queued",
    });
    await expect(
      testEnv.DB.prepare(
        "SELECT status,error_detail FROM agent_task_runs WHERE id='revoked-run'"
      ).first()
    ).resolves.toEqual({ error_detail: "Runner revoked", status: "failed" });
  });

  it("lists, cancels, and explicitly retries durable task requests", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "task-controls@example.test"
    );
    const timestamp = new Date().toISOString();
    await testEnv.DB.prepare(
      `INSERT INTO agent_task_requests
        (id,user_id,task_type,subject_type,subject_id,input_json,status,
         created_at,updated_at)
       VALUES ('cancel-me',?,'application.message','job','job-1',
               '{"kind":"job_draft","mode":"generate","jobId":"job-1"}',
               'queued',?,?)`
    )
      .bind(userId, timestamp, timestamp)
      .run();

    const cancelled = await sessionRequest(
      "/api/agent-task-requests/cancel-me",
      cookie,
      "DELETE"
    );
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toMatchObject({
      taskRequest: { id: "cancel-me", status: "cancelled" },
    });

    const retried = await sessionRequest(
      "/api/agent-task-requests/cancel-me/retry",
      cookie,
      "POST"
    );
    expect(retried.status).toBe(202);
    const retryPayload = (await retried.json()) as {
      taskRequest: { id: string; status: string };
    };
    expect(retryPayload.taskRequest).toMatchObject({ status: "queued" });
    expect(retryPayload.taskRequest.id).not.toBe("cancel-me");

    const history = await sessionRequest("/api/agent-tasks", cookie);
    await expect(history.json()).resolves.toMatchObject({
      requests: [
        { id: retryPayload.taskRequest.id, status: "queued" },
        { id: "cancel-me", status: "cancelled" },
      ],
    });
  });

  it("rejects an expired pairing code", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "expired-agent@example.test"
    );
    const pairing = await sessionRequest(
      "/api/agent-runner-pairings",
      cookie,
      "POST",
      { capabilities: ["research"] }
    );
    const payload = (await pairing.json()) as { pairing: { code: string } };
    await testEnv.DB.prepare(
      "UPDATE agent_runner_pairings SET expires_at=? WHERE user_id=?"
    )
      .bind("2000-01-01T00:00:00.000Z", userId)
      .run();

    const exchange = await publicPost("/api/agent-runner-pairings/exchange", {
      code: payload.pairing.code,
      codexVersion: "codex-cli test",
      runnerName: "Expired agent",
    });
    expect(exchange.status).toBe(401);
  });
});

function sessionRequest(
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

function publicPost(path: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function agentPost(path: string, token: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}
