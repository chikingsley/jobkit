import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
const timestamp = "2026-07-15T00:00:00.000Z";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("country markets and campaigns", () => {
  it("lists a country and snapshots review targets for its current jobs", async () => {
    const { cookie } = await createAuthenticatedUser(
      "country-campaign@example.test"
    );
    await seedPolandJob();

    const countries = await request("/api/countries", cookie);
    const campaign = await request(
      "/api/countries/PL/campaigns",
      cookie,
      "POST",
      {
        executionMode: "review_each",
        includeOpenPositions: true,
        includeSchoolOutreach: false,
      }
    );
    const campaignPayload = (await campaign.json()) as {
      campaign: {
        campaignId: string;
        executionMode: string;
        targetCount: number;
      };
      ok: boolean;
    };

    expect(countries.status).toBe(200);
    expect(await countries.json()).toMatchObject({
      countries: [
        {
          countryCode: "PL",
          countryName: "Poland",
          openPositionCount: 1,
        },
      ],
    });
    expect(campaign.status).toBe(200);
    expect(campaignPayload).toMatchObject({
      campaign: { executionMode: "review_each", targetCount: 1 },
      ok: true,
    });
    expect(
      await testEnv.DB.prepare(
        `SELECT t.status,t.channel,t.route_id,c.policy_snapshot_json
           FROM country_campaign_targets t
           JOIN country_campaigns c ON c.id=t.campaign_id`
      ).first()
    ).toMatchObject({
      channel: "email",
      route_id: "route-poland",
      status: "review",
    });

    const detail = await request(
      `/api/country-campaigns/${campaignPayload.campaign.campaignId}`,
      cookie
    );
    const detailPayload = (await detail.json()) as {
      campaign: {
        targetCounts: Record<string, number>;
        targets: Array<{ id: string }>;
      };
    };
    const [target] = detailPayload.campaign.targets;
    expect(detail.status).toBe(200);
    expect(detailPayload.campaign.targetCounts).toMatchObject({ review: 1 });
    if (!target) {
      throw new Error("Campaign target was not returned");
    }

    const approved = await request(
      `/api/country-campaigns/${campaignPayload.campaign.campaignId}/targets/${target.id}`,
      cookie,
      "PATCH",
      { reason: "", status: "approved" }
    );
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      campaign: { targetCounts: { approved: 1, review: 0 } },
      ok: true,
    });

    const held = await request(
      `/api/country-campaigns/${campaignPayload.campaign.campaignId}/targets/${target.id}`,
      cookie,
      "PATCH",
      { reason: "Recipient needs verification", status: "held" }
    );
    expect(held.status).toBe(200);
    expect(await held.json()).toMatchObject({
      campaign: {
        targetCounts: { approved: 0, held: 1 },
        targets: [
          { holdReason: "Recipient needs verification", status: "held" },
        ],
      },
      ok: true,
    });
    expect(
      await testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM country_campaign_target_events
          WHERE target_id=?`
      )
        .bind(target.id)
        .first<number>("count")
    ).toBe(2);
  });

  it("claims discovery work and persists a verified school contact", async () => {
    const { cookie } = await createAuthenticatedUser(
      "country-sweep@example.test"
    );
    const queued = await request("/api/countries/TJ/sweeps", cookie, "POST", {
      includeDirectories: false,
      includeKnownSources: false,
      includeMaps: false,
      includeSearch: true,
    });
    const pairingResponse = await request(
      "/api/agent-runner-pairings",
      cookie,
      "POST",
      { capabilities: ["research"] }
    );
    const pairingPayload = (await pairingResponse.json()) as {
      pairing: { code: string };
    };
    const exchange = await publicRequest(
      "/api/agent-runner-pairings/exchange",
      {
        code: pairingPayload.pairing.code,
        codexVersion: "codex-cli test",
        runnerName: "Integration runner",
      }
    );
    const runnerPayload = (await exchange.json()) as {
      runner: { token: string };
    };
    const forbidden = await runnerRequest(
      "/api/jobs/not-a-runner-operation/approve",
      runnerPayload.runner.token,
      {}
    );
    const claim = await runnerRequest(
      "/api/agent-tasks/claim",
      runnerPayload.runner.token,
      { runnerVersion: "codex-cli test" }
    );
    const claimPayload = (await claim.json()) as {
      task: { runId: string; taskType: string };
    };
    const completed = await runnerRequest(
      `/api/agent-tasks/${claimPayload.task.runId}/complete`,
      runnerPayload.runner.token,
      {
        output: {
          coverageSummary: { source: "search" },
          notes: [],
          organizations: [
            {
              canonicalDomain: "example-school.tj",
              city: "Dushanbe",
              contactPoints: [
                {
                  evidenceUrl: "https://example-school.tj/contact",
                  kind: "email",
                  label: "Hiring",
                  status: "active",
                  value: "jobs@example-school.tj",
                },
              ],
              evidenceUrl: "https://example-school.tj",
              lastVerifiedAt: timestamp,
              marketSegment: "private_school",
              name: "Example School",
              outreachEligibility: "eligible",
              region: "Dushanbe",
              status: "active",
              websiteUrl: "https://example-school.tj",
            },
          ],
        },
      }
    );

    expect(queued.status).toBe(200);
    expect(pairingResponse.status).toBe(200);
    expect(exchange.status).toBe(200);
    expect(forbidden.status).toBe(403);
    expect(claim.status).toBe(200);
    expect(claimPayload.task).toMatchObject({
      taskType: "country_sweep.discovery",
    });
    expect(completed.status).toBe(200);
    expect(
      await testEnv.DB.prepare(
        `SELECT o.country_code,o.name,o.status,cp.kind,cp.value,cp.status contact_status
           FROM organizations o
           JOIN organization_contact_points cp ON cp.organization_id=o.id`
      ).first()
    ).toEqual({
      contact_status: "active",
      country_code: "TJ",
      kind: "email",
      name: "Example School",
      status: "active",
      value: "jobs@example-school.tj",
    });
    expect(
      await testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM country_sweep_tasks
          WHERE phase='verification'`
      ).first<number>("count")
    ).toBe(1);
    expect(
      await testEnv.DB.prepare(
        "SELECT status,prompt_version,model FROM agent_task_runs WHERE id=?"
      )
        .bind(claimPayload.task.runId)
        .first()
    ).toMatchObject({
      model: "gpt-5.6-terra",
      prompt_version: "country-sweep-v1",
      status: "completed",
    });
  });
});

async function seedPolandJob() {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO jobs
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
}

function request(
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
