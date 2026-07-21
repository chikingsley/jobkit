import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { COUNTRY_SWEEP_PROMPT_VERSION } from "../../../src/agent-tasks/country-sweep";
import {
  claimCountrySweepTask,
  completeCountrySweepTask,
} from "../../../worker/services/country-sweep-tasks";
import { createAuthenticatedUser } from "./auth";
import { seedStrongEnglishMatch } from "./campaign-match-fixtures";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
const timestamp = "2026-07-15T00:00:00.000Z";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("country markets and campaigns", () => {
  it("creates distinct city-scoped discovery work without duplicating cities", async () => {
    const { cookie } = await createAuthenticatedUser(
      "country-city-sweep@example.test"
    );
    const response = await request("/api/countries/TJ/sweeps", cookie, "POST", {
      cities: ["Dushanbe", "Khujand", "Dushanbe"],
      includeDirectories: false,
      includeKnownSources: false,
      includeMaps: false,
      includeSearch: true,
    });

    expect(response.status).toBe(200);
    const tasks = await testEnv.DB.prepare(
      `SELECT scope_key,input_json FROM country_sweep_tasks
        WHERE phase='discovery' ORDER BY scope_key`
    ).all<{ input_json: string; scope_key: string }>();
    expect(tasks.results.map((task) => task.scope_key)).toEqual([
      "search:city:dushanbe",
      "search:city:khujand",
    ]);
    expect(tasks.results.map((task) => JSON.parse(task.input_json))).toEqual([
      expect.objectContaining({ city: "Dushanbe", source: "search" }),
      expect.objectContaining({ city: "Khujand", source: "search" }),
    ]);

    const detail = await request("/api/countries/TJ", cookie);
    const payload = (await detail.json()) as {
      country: { sweeps: Array<{ cities: string[] }> };
    };
    expect(payload.country.sweeps.at(0)?.cities).toEqual([
      "Dushanbe",
      "Khujand",
    ]);
  });

  it("continues a coverage audit through novel scopes and stops when no new scope remains", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "country-coverage@example.test"
    );
    await request("/api/countries/TJ/sweeps", cookie, "POST", {
      includeDirectories: false,
      includeKnownSources: false,
      includeMaps: false,
      includeSearch: true,
    });

    const discovery = await claimCountrySweepTask(
      testEnv.DB,
      userId,
      "coverage-runner"
    );
    if (!discovery) {
      throw new Error("Initial discovery task was not queued");
    }
    await completeCountrySweepTask(
      testEnv.DB,
      userId,
      discovery.id,
      "coverage-runner",
      emptySweepOutput()
    );

    const firstAudit = await claimCountrySweepTask(
      testEnv.DB,
      userId,
      "coverage-runner"
    );
    expect(firstAudit?.phase).toBe("coverage_audit");
    if (!firstAudit) {
      throw new Error("Coverage audit task was not queued");
    }
    const followUp = {
      ...emptySweepOutput(),
      coverageSummary: {
        ...emptySweepOutput().coverageSummary,
        gaps: ["Khorog has not been checked"],
        needsAnotherPass: true,
        nextScopes: [
          {
            city: "Khorog",
            query: "schools Khorog",
            source: "search" as const,
          },
        ],
      },
    };
    await completeCountrySweepTask(
      testEnv.DB,
      userId,
      firstAudit.id,
      "coverage-runner",
      followUp
    );

    const secondDiscovery = await claimCountrySweepTask(
      testEnv.DB,
      userId,
      "coverage-runner"
    );
    expect(secondDiscovery).toMatchObject({
      phase: "discovery",
      scopeKey: "search:khorog:schools-khorog",
    });
    if (!secondDiscovery) {
      throw new Error("Follow-up discovery task was not queued");
    }
    await completeCountrySweepTask(
      testEnv.DB,
      userId,
      secondDiscovery.id,
      "coverage-runner",
      emptySweepOutput()
    );

    const secondAudit = await claimCountrySweepTask(
      testEnv.DB,
      userId,
      "coverage-runner"
    );
    expect(secondAudit?.phase).toBe("coverage_audit");
    if (!secondAudit) {
      throw new Error("Second coverage audit task was not queued");
    }
    await completeCountrySweepTask(
      testEnv.DB,
      userId,
      secondAudit.id,
      "coverage-runner",
      followUp
    );

    await expect(
      testEnv.DB.prepare("SELECT status FROM country_sweeps").first("status")
    ).resolves.toBe("completed");
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM country_sweep_tasks
          WHERE phase='discovery' AND scope_key='search:khorog:schools-khorog'`
      ).first<number>("count")
    ).resolves.toBe(1);
  });

  it("imports historical Tajikistan research without presenting stale rows as open jobs", async () => {
    const { cookie } = await createAuthenticatedUser(
      "country-history@example.test"
    );
    const response = await request("/api/countries/TJ", cookie);
    const payload = (await response.json()) as {
      country: {
        opportunities: unknown[];
        organizations: Array<{
          evidenceCount: number;
          name: string;
          roleSummary: string;
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.country.opportunities).toHaveLength(0);
    expect(payload.country.organizations).toHaveLength(13);
    expect(payload.country.organizations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceCount: 2,
          name: "Modern International School",
        }),
        expect.objectContaining({
          evidenceCount: 2,
          name: "University of Central Asia / SPCE",
        }),
      ])
    );
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) evidence_count,
                SUM(evidence_status='active') active_count
           FROM organization_evidence
          WHERE source_kind='historical_workbook'`
      ).first()
    ).resolves.toEqual({ active_count: 2, evidence_count: 15 });
  });

  it("creates a multi-market campaign from the full stored target pool", async () => {
    const { cookie } = await createAuthenticatedUser(
      "country-campaign@example.test"
    );
    await seedPolandJob();

    const countries = await request("/api/countries", cookie);
    const campaign = await request("/api/campaigns", cookie, "POST", {
      countryCodes: ["PL"],
      dailyPace: 8,
      firstFiveRequired: true,
      postedTargetPercent: 70,
      stopAfterHumanReplies: 2,
    });
    const campaignPayload = (await campaign.json()) as {
      campaign: {
        counts: { total: number };
        id: string;
        markets: Array<{ countryCode: string }>;
        status: string;
      };
      ok: boolean;
    };

    expect(countries.status).toBe(200);
    const countriesPayload = (await countries.json()) as {
      countries: Array<{
        countryCode: string;
        countryName: string;
        openPositionCount: number;
      }>;
    };
    expect(countriesPayload.countries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          countryCode: "PL",
          countryName: "Poland",
          openPositionCount: 1,
        }),
      ])
    );
    expect(campaign.status).toBe(201);
    expect(campaignPayload).toMatchObject({
      campaign: {
        counts: { total: 1 },
        markets: [{ countryCode: "PL" }],
        status: "draft",
      },
      ok: true,
    });
    expect(
      await testEnv.DB.prepare(
        `SELECT t.status,t.channel,t.route_id,c.policy_snapshot_json
           FROM campaign_targets t
           JOIN campaigns c ON c.id=t.campaign_id`
      ).first()
    ).toMatchObject({
      channel: "email",
      route_id: "route-poland",
      status: "eligible",
    });

    const targets = await request(
      `/api/campaigns/${campaignPayload.campaign.id}/targets`,
      cookie
    );
    const targetPayload = (await targets.json()) as {
      targets: { items: Array<{ id: string }>; total: number };
    };
    const [target] = targetPayload.targets.items;
    expect(targets.status).toBe(200);
    expect(targetPayload.targets.total).toBe(1);
    if (!target) {
      throw new Error("Campaign target was not returned");
    }

    const calibration = await request(
      `/api/campaigns/${campaignPayload.campaign.id}/actions`,
      cookie,
      "POST",
      { action: "begin_calibration", reason: "" }
    );
    expect(calibration.status).toBe(200);
    expect(await calibration.json()).toMatchObject({
      campaign: {
        counts: { calibration: 1 },
        dispatches: [{ status: "calibration" }],
        status: "calibrating",
      },
      ok: true,
    });
    expect(
      await testEnv.DB.prepare(
        `SELECT task_type,subject_type,status FROM agent_task_requests
          WHERE subject_type='campaign_dispatch'`
      ).first()
    ).toMatchObject({
      status: "queued",
      subject_type: "campaign_dispatch",
      task_type: "application.message",
    });

    const held = await request(
      `/api/campaigns/${campaignPayload.campaign.id}/targets/${target.id}`,
      cookie,
      "PATCH",
      { reason: "Recipient needs verification", status: "held" }
    );
    expect(held.status).toBe(200);
    expect(await held.json()).toMatchObject({
      campaign: {
        counts: { calibration: 0, held: 1 },
      },
      ok: true,
    });
    expect(
      await testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM campaign_target_events
          WHERE target_id=?`
      )
        .bind(target.id)
        .first<number>("count")
    ).toBe(1);
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
          coverageSummary: {
            citiesChecked: ["Dushanbe"],
            gaps: [],
            needsAnotherPass: false,
            nextScopes: [],
            queriesChecked: ["schools Dushanbe Tajikistan"],
            resultCount: 1,
            sourcesChecked: ["https://example-school.tj"],
          },
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
           JOIN organization_contact_points cp ON cp.organization_id=o.id
          WHERE o.name='Example School'`
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
        `SELECT COUNT(*) count FROM organization_evidence evidence
          JOIN organizations organization ON organization.id=evidence.organization_id
         WHERE organization.name='Example School'
           AND evidence.source_kind='country_sweep'`
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
      prompt_version: COUNTRY_SWEEP_PROMPT_VERSION,
      status: "completed",
    });
  });
});

function emptySweepOutput() {
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

async function seedPolandJob() {
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
