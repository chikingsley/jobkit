import type { D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { createAuthenticatedUser } from "../.././auth";

export interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

export const testEnv = env as TestEnv;

export async function createSweep(email: string) {
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

export async function createResearchRunner(cookie: string, runnerName: string) {
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

export async function claimTask(token: string) {
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

export function requireTask<T>(task: T | null): T {
  if (!task) {
    throw new Error("Country task was not claimed");
  }
  return task;
}

export async function readSourceTaskId(runId: string) {
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

export function failTask(
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

export function expireTaskPair(task: { leaseToken: string; runId: string }) {
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

export function emptyOutput() {
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

export function oneOrganizationOutput() {
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

export function authenticatedRequest(
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

export function runnerRequest(
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

export function publicRequest(path: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
