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
