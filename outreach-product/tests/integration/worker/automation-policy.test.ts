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
  it("starts disabled and persists explicit safety limits", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "automation-policy@example.test"
    );
    const initial = await exports.default.fetch(
      "https://outreach.test/api/automation-policy",
      { headers: { cookie } }
    );
    const policy = {
      allowedBoards: ["seriousteachers"],
      dailyApplicationLimit: 2,
      minimumFit: "strong",
      mode: "review",
      requireKnownCompensation: true,
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
        "SELECT mode,daily_application_limit FROM user_automation_policies WHERE user_id=?"
      )
        .bind(userId)
        .first()
    ).toEqual({ daily_application_limit: 2, mode: "review" });
  });
});
