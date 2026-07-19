import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("Codex job analysis tasks", () => {
  it("round-robins position and match-fact work through one runner protocol", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "agent-analysis@example.test"
    );
    const timestamp = "2026-07-18T00:00:00.000Z";
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO jobs
          (id,title,salary,description,apply_url,first_seen_at,updated_at)
         VALUES ('agent-analysis-job','English teacher','25,000 CNY monthly',
                 'We need an English teacher. Salary is 25,000 CNY monthly.',
                 'https://example.test/apply',?,?)`
      ).bind(timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO user_jobs
          (id,user_id,job_id,created_at,updated_at)
         VALUES ('agent-analysis-user-job',?,'agent-analysis-job',?,?)`
      ).bind(userId, timestamp, timestamp),
    ]);
    const token = await pairAgent(cookie);

    const positionClaim = await agentPost("/api/agent-tasks/claim", token, {
      runnerVersion: "codex-cli test",
    });
    const positionPayload = (await positionClaim.json()) as {
      task: { runId: string; taskType: string };
    };
    expect(positionPayload.task.taskType).toBe("job.position_analysis");

    const positionComplete = await agentPost(
      `/api/agent-tasks/${positionPayload.task.runId}/complete`,
      token,
      {
        output: {
          positions: [
            {
              audiences: [],
              certainty: "explicit",
              compensationEvidence: ["Salary is 25,000 CNY monthly"],
              employmentTypes: [],
              evidence: ["English teacher"],
              locations: [],
              requirements: [],
              roleFamily: "english_language",
              subjects: [{ evidence: "English teacher", value: "english" }],
              title: "English teacher",
            },
          ],
          reviewNotes: [],
          scope: "direct",
        },
      }
    );
    expect(positionComplete.status).toBe(200);

    const factsClaim = await agentPost("/api/agent-tasks/claim", token, {
      runnerVersion: "codex-cli test",
    });
    const factsPayload = (await factsClaim.json()) as {
      task: { runId: string; taskType: string };
    };
    expect(factsPayload.task.taskType).toBe("job.match_facts");

    const factsComplete = await agentPost(
      `/api/agent-tasks/${factsPayload.task.runId}/complete`,
      token,
      {
        output: {
          audiences: [],
          benefits: [],
          economics: {
            compensation: {
              amountMaximum: null,
              amountMinimum: 25_000,
              currency: "CNY",
              evidence: ["Salary is 25,000 CNY monthly"],
              kind: "amount",
              period: "month",
              qualifier: "exact",
              taxBasis: "unspecified",
            },
            workload: null,
          },
          employmentTypes: [],
          requirements: [],
          reviewNotes: [],
        },
      }
    );
    expect(factsComplete.status).toBe(200);

    const analyses = await testEnv.DB.prepare(
      `SELECT task_type,status,model FROM agent_task_runs
        WHERE user_id=? ORDER BY started_at`
    )
      .bind(userId)
      .all();
    expect(analyses.results).toEqual([
      {
        model: "gpt-5.6-luna",
        status: "completed",
        task_type: "job.position_analysis",
      },
      {
        model: "gpt-5.6-luna",
        status: "completed",
        task_type: "job.match_facts",
      },
    ]);
    await expect(
      testEnv.DB.prepare(
        "SELECT model_provider,model_id FROM job_match_facts WHERE job_id='agent-analysis-job'"
      ).first()
    ).resolves.toEqual({
      model_id: "gpt-5.6-luna",
      model_provider: "codex",
    });
  });
});

async function pairAgent(cookie: string) {
  const pairing = await sessionPost("/api/agent-runner-pairings", cookie, {
    capabilities: ["research", "extraction"],
  });
  const pairingPayload = (await pairing.json()) as {
    pairing: { code: string };
  };
  const exchange = await publicPost("/api/agent-runner-pairings/exchange", {
    code: pairingPayload.pairing.code,
    codexVersion: "codex-cli test",
    runnerName: "Analysis agent",
  });
  const exchangePayload = (await exchange.json()) as {
    runner: { token: string };
  };
  return exchangePayload.runner.token;
}

function sessionPost(
  path: string,
  cookie: string,
  body: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie },
    method: "POST",
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
