import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultProfile } from "../../../src/features/profile/schema";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("outreach Worker", () => {
  it("serves health through the production Worker entrypoint", async () => {
    const response = await exports.default.fetch(
      "https://outreach.test/api/health"
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("publishes the OpenAPI contract through the production entrypoint", async () => {
    const response = await exports.default.fetch(
      "https://outreach.test/openapi.json"
    );
    const document = (await response.json()) as {
      info: { title: string };
      openapi: string;
    };

    expect(response.status).toBe(200);
    expect(document.info.title).toBe("JobKit Outreach API");
    expect(document.openapi).toBe("3.1.0");
  });

  it("keeps unknown API routes inside the JSON API boundary", async () => {
    const { cookie } = await createAuthenticatedUser("missing@example.test");
    const response = await exports.default.fetch(
      "https://outreach.test/api/missing",
      { headers: { cookie } }
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      message: "Route not found",
      ok: false,
    });
  });

  it("rejects malformed profile data as a client error", async () => {
    const { cookie } = await createAuthenticatedUser("profile@example.test");
    const response = await exports.default.fetch(
      "https://outreach.test/api/profile",
      {
        body: JSON.stringify({ fullName: 42 }),
        headers: {
          "content-type": "application/json",
          cookie,
        },
        method: "PUT",
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Request did not match the expected schema",
      ok: false,
    });
  });

  it("keeps private workspace routes behind an authenticated session", async () => {
    const response = await exports.default.fetch(
      "https://outreach.test/api/profile"
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      message: "Authentication required",
      ok: false,
    });
  });

  it("persists the browser login as a D1-backed session", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "session@example.test"
    );
    const response = await exports.default.fetch(
      "https://outreach.test/api/auth/get-session",
      { headers: { cookie } }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { id: userId } });
    expect(
      await testEnv.DB.prepare(
        "SELECT user_id,expires_at FROM user_sessions WHERE user_id=?"
      )
        .bind(userId)
        .first()
    ).toMatchObject({ user_id: userId });
  });

  it("keeps each candidate profile scoped to its explicit owner", async () => {
    const first = await createAuthenticatedUser("first@example.test");
    const savedProfile = {
      ...defaultProfile,
      citizenship: "Canada",
      currentLocation: "Toronto, Canada",
      email: "first@example.test",
      fullName: "First Candidate",
      preferredName: "First",
    };
    const saveResponse = await exports.default.fetch(
      "https://outreach.test/api/profile",
      {
        body: JSON.stringify(savedProfile),
        headers: {
          "content-type": "application/json",
          cookie: first.cookie,
        },
        method: "PUT",
      }
    );
    const firstResponse = await exports.default.fetch(
      "https://outreach.test/api/profile",
      { headers: { cookie: first.cookie } }
    );
    const second = await createAuthenticatedUser("second@example.test");
    const secondResponse = await exports.default.fetch(
      "https://outreach.test/api/profile",
      { headers: { cookie: second.cookie } }
    );

    expect(saveResponse.status).toBe(200);
    expect(await firstResponse.json()).toMatchObject({
      profile: { fullName: "First Candidate" },
    });
    expect(await secondResponse.json()).toMatchObject({
      profile: { fullName: "" },
    });
    expect(
      await testEnv.DB.prepare(
        "SELECT user_id FROM user_profiles WHERE user_id=?"
      )
        .bind(first.userId)
        .first()
    ).toEqual({ user_id: first.userId });
  });
});
