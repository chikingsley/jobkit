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
      "onboarding-new@example.test",
      "member"
    );
    const response = await exports.default.fetch(
      "https://outreach.test/api/onboarding",
      { headers: { cookie } }
    );
    const state = (await response.json()) as {
      completedAt: string | null;
      documents: unknown[];
      hasPreferences: boolean;
      hasProfile: boolean;
      preferences: typeof defaultPreferences;
      profile: typeof defaultProfile;
    };

    expect(response.status).toBe(200);
    expect(state).toMatchObject({
      completedAt: null,
      documents: [],
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
      message:
        "Profile, preferences, and a resume are required before onboarding",
      ok: false,
    });
  });

  it("completes after the owned profile, preferences, and resume are saved", async () => {
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
    const resume = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    const [profileResponse, preferencesResponse, documentResponse] =
      await Promise.all([
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
        exports.default.fetch("https://outreach.test/api/documents", {
          body: resume,
          headers: {
            "content-length": String(resume.byteLength),
            "content-type": "application/pdf",
            cookie,
            "x-jobkit-category": "resume",
            "x-jobkit-filename": "resume.pdf",
          },
          method: "PUT",
        }),
      ]);
    const response = await exports.default.fetch(
      "https://outreach.test/api/onboarding/complete",
      { headers: { cookie }, method: "POST" }
    );

    expect(profileResponse.status).toBe(200);
    expect(preferencesResponse.status).toBe(200);
    expect(documentResponse.status).toBe(200);
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
          "content-type": "application/zip",
          cookie,
          "x-jobkit-filename": "resume.zip",
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

  it("requires a paired extraction runner before storing a resume", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "onboarding-unpaired@example.test"
    );
    const resume = "Alex Teacher\nalex@example.test";
    const response = await exports.default.fetch(
      "https://outreach.test/api/profile-imports",
      {
        body: resume,
        headers: {
          "content-length": String(new TextEncoder().encode(resume).byteLength),
          "content-type": "text/plain",
          cookie,
          "x-jobkit-filename": "resume.txt",
        },
        method: "PUT",
      }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      message: "Pair a Codex agent before importing a resume",
      ok: false,
    });
    await expect(
      testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM user_documents WHERE user_id=?"
      )
        .bind(userId)
        .first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM profile_imports WHERE user_id=?"
      )
        .bind(userId)
        .first()
    ).resolves.toEqual({ count: 0 });
  });
});
