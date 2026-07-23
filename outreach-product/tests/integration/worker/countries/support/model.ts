import type { D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import type { CountrySweepTaskOutput } from "../../../../../src/features/countries/schema";
import { materializeOneCountrySweepItem } from "../../../../../worker/services/country-materialization/materializer";
import { seedStrongEnglishMatch } from "../.././campaign-match-fixtures";

export interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

export const testEnv = env as TestEnv;

export const timestamp = "2026-07-15T00:00:00.000Z";

export function emptySweepOutput() {
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

export async function seedPolandJob() {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_listings
        (id,board,title,company,country,location,source_url,apply_url,
         first_seen_at,updated_at,opportunity_scope,market_segments_json,
         message_route)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      "poland-job",
      "eslcafe-modern",
      "English teacher",
      "Example School",
      "Poland",
      "Warsaw",
      "https://example.test/poland-job",
      "https://example.test/poland-job",
      timestamp,
      timestamp,
      "direct",
      '["private_school"]',
      "advertised_position"
    ),
    testEnv.DB.prepare(
      `INSERT INTO application_routes
        (id,job_id,kind,destination,source_evidence,last_verified_at,status,
         created_at,updated_at)
       VALUES (?,?,'email',?,?,?,'active',?,?)`
    ).bind(
      "route-poland",
      "poland-job",
      "jobs@example.test",
      "https://example.test/poland-job",
      timestamp,
      timestamp,
      timestamp
    ),
  ]);
  await seedStrongEnglishMatch(testEnv.DB, "poland-job", timestamp);
}

export function request(
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

export async function createResearchRunner(cookie: string, runnerName: string) {
  const pairingResponse = await request(
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
    runner: { token: string };
  };
  return exchange.runner.token;
}

export async function claimCountryRunnerTask(token: string) {
  const response = await runnerRequest("/api/agent-tasks/claim", token, {
    runnerVersion: "codex-cli test",
  });
  const payload = (await response.json()) as {
    task: {
      leaseToken: string;
      runId: string;
      taskType: string;
    } | null;
  };
  if (!payload.task) {
    throw new Error("Country task was not claimed");
  }
  return payload.task;
}

export async function completeCountryRunnerTask(
  token: string,
  task: { leaseToken: string; runId: string },
  output: CountrySweepTaskOutput
) {
  const response = await runnerRequest(
    `/api/agent-tasks/${task.runId}/complete`,
    token,
    { leaseToken: task.leaseToken, output }
  );
  if (!response.ok) {
    throw new Error(`Country completion failed: ${await response.text()}`);
  }
  await materializeCountryCompletionResponse(response);
}

export async function materializeCountryCompletionResponse(response: Response) {
  const payload = (await response.json()) as {
    result: { domainResult: { outputId: string } };
  };
  for (let step = 0; step < 20; step += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: Each invocation owns one bounded materialization item and unlocks its successor.
    await materializeOneCountrySweepItem(
      testEnv,
      payload.result.domainResult.outputId,
      `country-test:${step.toString()}`
    );
    const status = await testEnv.DB.prepare(
      "SELECT status FROM country_sweep_outputs WHERE id=?"
    )
      .bind(payload.result.domainResult.outputId)
      .first<string>("status");
    if (status === "materialized") {
      return;
    }
  }
  throw new Error("Country output materialization did not finish");
}
