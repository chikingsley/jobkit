import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { decodeGmailPushData } from "../../../worker/services/gmail-replies";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("hosted Gmail integration", () => {
  it("reports the linked scope and durable mailbox watch", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "gmail-status@example.test"
    );
    const timestamp = "2026-07-16T00:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user_accounts
          (id,account_id,provider_id,user_id,scope,created_at,updated_at)
         VALUES (?,?, 'google', ?, ?, ?, ?)`
      ).bind(
        "google-account",
        "gmail-status@example.test",
        userId,
        "https://www.googleapis.com/auth/gmail.compose,https://www.googleapis.com/auth/gmail.readonly",
        timestamp,
        timestamp
      ),
      env.DB.prepare(
        `INSERT INTO gmail_mailbox_watches
          (user_id,email_address,history_id,expiration_at,status,
           last_error,created_at,updated_at)
         VALUES (?,?,?,?,'active','',?,?)`
      ).bind(
        userId,
        "gmail-status@example.test",
        "1234",
        "2026-07-20T00:00:00.000Z",
        timestamp,
        timestamp
      ),
    ]);

    const response = await exports.default.fetch(
      "https://outreach.test/api/gmail/status",
      { headers: { cookie } }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      available: true,
      connected: true,
      emailAddress: "gmail-status@example.test",
      ok: true,
      watch: { status: "active" },
    });
  });

  it("decodes the wrapped Gmail Pub/Sub notification", () => {
    const data = btoa(
      JSON.stringify({
        emailAddress: "Candidate@Example.com",
        historyId: "987654321",
      })
    );

    expect(decodeGmailPushData(data)).toEqual({
      emailAddress: "candidate@example.com",
      historyId: "987654321",
    });
  });

  it("preserves Gmail's numeric history ID compatibility form", () => {
    const data = btoa(
      '{"emailAddress":"Candidate@Example.com","historyId":9007199254740993}'
    );

    expect(decodeGmailPushData(data)).toEqual({
      emailAddress: "candidate@example.com",
      historyId: "9007199254740993",
    });
  });

  it("rejects non-decimal history IDs", () => {
    const data = btoa(
      '{"emailAddress":"candidate@example.com","historyId":1e3}'
    );

    expect(() => decodeGmailPushData(data)).toThrow(
      "Invalid Gmail Pub/Sub data"
    );
  });
});
