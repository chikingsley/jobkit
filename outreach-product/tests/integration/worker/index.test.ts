import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultProfile,
  PROFILE_SCHEMA_VERSION,
} from "../../../src/features/profile/schema";
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

  it("claims the pre-auth workspace for the first authenticated user only", async () => {
    await testEnv.DB.prepare(
      "UPDATE legacy_data_claims SET claimed_by=NULL,claimed_at=NULL WHERE id=1"
    ).run();
    await testEnv.DB.prepare("DELETE FROM users").run();
    await testEnv.DB.prepare(
      "INSERT INTO user_profiles (id,user_id,profile_json,updated_at,schema_version) VALUES ('legacy',NULL,?,?,?)"
    )
      .bind(
        JSON.stringify({
          ...defaultProfile,
          citizenship: "Canada",
          currentLocation: "Toronto, Canada",
          email: "legacy@example.test",
          fullName: "Legacy Candidate",
          preferredName: "Legacy",
        }),
        "2026-07-14T00:00:00.000Z",
        PROFILE_SCHEMA_VERSION
      )
      .run();
    const first = await createAuthenticatedUser("first@example.test");
    const firstResponse = await exports.default.fetch(
      "https://outreach.test/api/profile",
      { headers: { cookie: first.cookie } }
    );
    const ownership = await testEnv.DB.prepare(
      `SELECT c.claimed_by,p.user_id
       FROM legacy_data_claims c
       LEFT JOIN user_profiles p ON p.id='legacy'
       WHERE c.id=1`
    ).first();
    const second = await createAuthenticatedUser("second@example.test");
    const secondResponse = await exports.default.fetch(
      "https://outreach.test/api/profile",
      { headers: { cookie: second.cookie } }
    );

    expect(ownership).toEqual({
      claimed_by: first.userId,
      user_id: first.userId,
    });
    expect(await firstResponse.json()).toMatchObject({
      profile: { fullName: "Legacy Candidate" },
    });
    expect(await secondResponse.json()).toMatchObject({
      profile: { fullName: "" },
    });
    expect(
      await testEnv.DB.prepare(
        "SELECT claimed_by FROM legacy_data_claims WHERE id=1"
      ).first()
    ).toEqual({ claimed_by: first.userId });
  });
});
