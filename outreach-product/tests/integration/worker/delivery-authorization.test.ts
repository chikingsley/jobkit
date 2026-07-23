import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { campaignDeliveryEnabled } from "../../../worker/repositories/campaign-delivery-authorization";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
const routePath = "/api/operator/delivery-authorization";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("delivery authorization", () => {
  it("rejects members from reading or writing the authorization", async () => {
    const { cookie } = await createAuthenticatedUser(
      "delivery-auth-member@example.test",
      "member"
    );
    const read = await sessionGet(routePath, cookie);
    expect(read.status).toBe(403);
    await expect(read.json()).resolves.toMatchObject({
      message: "Operator access is required",
      ok: false,
    });
    const write = await sessionPost(routePath, cookie, {
      enabled: true,
      reason: "Member attempt",
      scope: "campaigns",
    });
    expect(write.status).toBe(403);
    await expect(
      testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM campaign_delivery_authorizations"
      ).first()
    ).resolves.toEqual({ count: 0 });
  });

  it("requires a non-empty reason", async () => {
    const { cookie } = await createAuthenticatedUser(
      "delivery-auth-reason@example.test"
    );
    const response = await sessionPost(routePath, cookie, {
      enabled: true,
      reason: "  ",
      scope: "campaigns",
    });
    expect(response.status).toBe(400);
  });

  it("lets an operator enable then disable with an audited history", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "delivery-auth-operator@example.test"
    );
    await expect(campaignDeliveryEnabled(testEnv.DB, userId)).resolves.toBe(
      false
    );
    const before = await sessionGet(routePath, cookie);
    expect(before.status).toBe(200);
    await expect(before.json()).resolves.toEqual({
      authorization: null,
      history: [],
      ok: true,
    });

    const enabled = await sessionPost(routePath, cookie, {
      enabled: true,
      reason: "Test Lab flow verified end to end",
      scope: "campaigns",
    });
    expect(enabled.status).toBe(200);
    await expect(enabled.json()).resolves.toMatchObject({
      authorization: {
        authorizedBy: userId,
        enabled: true,
        scope: "campaigns",
      },
      message: "Live campaign delivery authorized",
      ok: true,
    });
    await expect(campaignDeliveryEnabled(testEnv.DB, userId)).resolves.toBe(
      true
    );

    const disabled = await sessionPost(routePath, cookie, {
      enabled: false,
      reason: "Locking sends again after the check",
      scope: "campaigns",
    });
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      authorization: { authorizedAt: null, enabled: false },
      message: "Live campaign delivery locked",
      ok: true,
    });
    await expect(campaignDeliveryEnabled(testEnv.DB, userId)).resolves.toBe(
      false
    );

    const after = await sessionGet(routePath, cookie);
    const payload = (await after.json()) as {
      authorization: { enabled: boolean };
      history: {
        actingUserId: string;
        enabled: boolean;
        reason: string;
        scope: string;
      }[];
    };
    expect(payload.authorization.enabled).toBe(false);
    expect(payload.history).toHaveLength(2);
    expect(payload.history.map((event) => event.enabled)).toEqual([
      false,
      true,
    ]);
    for (const event of payload.history) {
      expect(event.actingUserId).toBe(userId);
      expect(event.scope).toBe("campaigns");
      expect(event.reason.length).toBeGreaterThan(0);
    }
  });
});

function sessionGet(path: string, cookie: string) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    headers: { cookie },
  });
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
