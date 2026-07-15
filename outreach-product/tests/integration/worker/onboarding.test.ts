import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultPreferences } from "../../../src/features/preferences/schema";
import { defaultProfile } from "../../../src/features/profile/schema";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("candidate onboarding", () => {
  it("starts a new user with an owned neutral profile proposal", async () => {
    const { cookie } = await createAuthenticatedUser(
      "onboarding-new@example.test"
    );
    const response = await exports.default.fetch(
      "https://outreach.test/api/onboarding",
      { headers: { cookie } }
    );
    const state = (await response.json()) as {
      completedAt: string | null;
      hasPreferences: boolean;
      hasProfile: boolean;
      preferences: typeof defaultPreferences;
      profile: typeof defaultProfile;
    };

    expect(response.status).toBe(200);
    expect(state).toMatchObject({
      completedAt: null,
      hasPreferences: false,
      hasProfile: false,
      profile: {
        email: "onboarding-new@example.test",
        fullName: "Integration User",
      },
    });
    expect(state.preferences.countries).toEqual({
      acceptable: [],
      excluded: [],
      preferred: [],
    });
  });

  it("requires both persisted sections before completion", async () => {
    const { cookie } = await createAuthenticatedUser(
      "onboarding-incomplete@example.test"
    );
    const response = await exports.default.fetch(
      "https://outreach.test/api/onboarding/complete",
      { headers: { cookie }, method: "POST" }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: "Profile and preferences are required before onboarding",
      ok: false,
    });
  });

  it("completes after the owned profile and preferences are saved", async () => {
    const email = "onboarding-complete@example.test";
    const { cookie, userId } = await createAuthenticatedUser(email);
    const profile = {
      ...defaultProfile,
      citizenship: "United States",
      currentLocation: "Seattle, United States",
      email,
      fullName: "Integration User",
      preferredName: "Integration",
    };
    const headers = { "content-type": "application/json", cookie };
    const [profileResponse, preferencesResponse] = await Promise.all([
      exports.default.fetch("https://outreach.test/api/profile", {
        body: JSON.stringify(profile),
        headers,
        method: "PUT",
      }),
      exports.default.fetch("https://outreach.test/api/preferences", {
        body: JSON.stringify(defaultPreferences),
        headers,
        method: "PUT",
      }),
    ]);
    const response = await exports.default.fetch(
      "https://outreach.test/api/onboarding/complete",
      { headers: { cookie }, method: "POST" }
    );

    expect(profileResponse.status).toBe(200);
    expect(preferencesResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      message: "Onboarding complete",
      ok: true,
    });
    expect(
      await testEnv.DB.prepare(
        "SELECT user_id,completed_at FROM user_onboarding WHERE user_id=?"
      )
        .bind(userId)
        .first()
    ).toMatchObject({ user_id: userId });
  });

  it("rejects unsupported resume formats before storing anything", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "onboarding-upload@example.test"
    );
    const response = await exports.default.fetch(
      "https://outreach.test/api/profile-imports",
      {
        body: "not a resume",
        headers: {
          "content-type": "text/plain",
          cookie,
          "x-jobkit-filename": "resume.txt",
        },
        method: "PUT",
      }
    );

    expect(response.status).toBe(415);
    expect(
      await testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM user_documents WHERE user_id=?"
      )
        .bind(userId)
        .first()
    ).toEqual({ count: 0 });
    expect(
      await testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM profile_imports WHERE user_id=?"
      )
        .bind(userId)
        .first()
    ).toEqual({ count: 0 });
  });
});
