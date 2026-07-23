import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { COUNTRY_SWEEP_PROMPT_VERSION } from "../../../../src/agent-tasks/country-sweep";
import { createAuthenticatedUser } from ".././auth";
import {
  materializeCountryCompletionResponse,
  publicRequest,
  request,
  runnerRequest,
  testEnv,
  timestamp,
} from "./support/model";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("country markets and campaigns", () => {
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
      task: { leaseToken: string; runId: string; taskType: string };
    };
    const completed = await runnerRequest(
      `/api/agent-tasks/${claimPayload.task.runId}/complete`,
      runnerPayload.runner.token,
      {
        leaseToken: claimPayload.task.leaseToken,
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
    await materializeCountryCompletionResponse(completed);
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
