import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultAutomationPolicy } from "../../../src/features/automation/schema";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("automation policy", () => {
  it("starts in review and persists channel-specific pacing", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "automation-policy@example.test"
    );
    const initial = await exports.default.fetch(
      "https://outreach.test/api/automation-policy",
      { headers: { cookie } }
    );
    const policy = {
      allowedBoards: ["seriousteachers"],
      boardForm: { dailyLimit: 2, mode: "review" },
      email: { dailyLimit: 4, mode: "auto" },
      excludedMarketSegments: ["language_center", "training_center"],
      minimumFit: "strong",
      paused: false,
      requireKnownCompensation: true,
      routeFreshnessDays: 14,
    } as const;
    const saved = await exports.default.fetch(
      "https://outreach.test/api/automation-policy",
      {
        body: JSON.stringify(policy),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );

    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      policy: defaultAutomationPolicy,
      updatedAt: null,
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ policy });
    expect(
      await testEnv.DB.prepare(
        `SELECT email_mode,email_daily_limit,board_form_mode,
                board_form_daily_limit,route_freshness_days
           FROM user_automation_policies WHERE user_id=?`
      )
        .bind(userId)
        .first()
    ).toEqual({
      board_form_daily_limit: 2,
      board_form_mode: "review",
      email_daily_limit: 4,
      email_mode: "auto",
      route_freshness_days: 14,
    });
  });

  it("persists user-selected pacing and freshness without a product ceiling", async () => {
    const { cookie } = await createAuthenticatedUser(
      "automation-unbounded@example.test"
    );
    const policy = {
      allowedBoards: [],
      boardForm: { dailyLimit: 180, mode: "review" },
      email: { dailyLimit: 250, mode: "auto" },
      excludedMarketSegments: [],
      minimumFit: "strong",
      paused: false,
      requireKnownCompensation: false,
      routeFreshnessDays: 365,
    };
    const response = await exports.default.fetch(
      "https://outreach.test/api/automation-policy",
      {
        body: JSON.stringify(policy),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ policy });
  });
});
