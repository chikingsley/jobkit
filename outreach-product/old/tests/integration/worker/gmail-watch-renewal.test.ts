import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../../worker/env";
import {
  GMAIL_WATCH_AUTH_FAILURE_LIMIT,
  renewExpiringGmailWatches,
} from "../../../worker/services/gmail-integration";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
const appEnv = testEnv as unknown as AppEnv;
const timestamp = "2026-07-20T00:00:00.000Z";

const gmailRoutes = new Map<string, { body: unknown; status: number }>();

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  gmailRoutes.clear();
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname !== "gmail.googleapis.com") {
        return realFetch(input, init);
      }
      const route = gmailRoutes.get(url.pathname);
      if (!route) {
        return Promise.reject(
          new Error(`Unexpected Gmail request: ${url.pathname}`)
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(route.body), { status: route.status })
      );
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedUser(suffix: string, options: { withAccount: boolean }) {
  const emailAddress = `watch-${suffix}@example.test`;
  const user = await createAuthenticatedUser(
    `gmail-watch-${suffix}@example.test`
  );
  if (options.withAccount) {
    await testEnv.DB.prepare(
      `INSERT INTO user_accounts
        (id,account_id,provider_id,user_id,access_token,refresh_token,
         access_token_expires_at,scope,created_at,updated_at)
       VALUES (?,?, 'google', ?, 'test-access-token','test-refresh-token',
         '2030-01-01T00:00:00.000Z',
         'https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly',
         ?,?)`
    )
      .bind(`google-${suffix}`, emailAddress, user.userId, timestamp, timestamp)
      .run();
  }
  return { ...user, emailAddress };
}

function seedWatch(
  userId: string,
  emailAddress: string,
  overrides: {
    authFailures?: number;
    failures?: number;
    status?: string;
  } = {}
) {
  return testEnv.DB.prepare(
    `INSERT INTO gmail_mailbox_watches
      (user_id,email_address,history_id,expiration_at,status,
       renewal_failure_count,renewal_auth_failure_count,last_error,
       created_at,updated_at)
     VALUES (?,?,'1000','2026-07-30T00:00:00.000Z',?,?,?,'',?,?)`
  )
    .bind(
      userId,
      emailAddress,
      overrides.status ?? "error",
      overrides.failures ?? 0,
      overrides.authFailures ?? 0,
      timestamp,
      timestamp
    )
    .run();
}

function readWatch(userId: string) {
  return testEnv.DB.prepare(
    `SELECT next_renewal_attempt_at,renewal_auth_failure_count,
            renewal_failure_count,status
       FROM gmail_mailbox_watches WHERE user_id=?`
  )
    .bind(userId)
    .first<{
      next_renewal_attempt_at: string | null;
      renewal_auth_failure_count: number;
      renewal_failure_count: number;
      status: string;
    }>();
}

function clearBackoff(userId: string) {
  return testEnv.DB.prepare(
    `UPDATE gmail_mailbox_watches SET next_renewal_attempt_at=NULL
      WHERE user_id=?`
  )
    .bind(userId)
    .run();
}

function interceptGmail(status: number, emailAddress: string) {
  const failure = { error: { message: "Backend Error" } };
  gmailRoutes.set("/gmail/v1/users/me/profile", {
    body: status === 200 ? { emailAddress, historyId: "9000" } : failure,
    status,
  });
  gmailRoutes.set("/gmail/v1/users/me/watch", {
    body:
      status === 200
        ? {
            expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
            historyId: "9000",
          }
        : failure,
    status,
  });
  gmailRoutes.set("/gmail/v1/users/me/messages", {
    body: { messages: [] },
    status: 200,
  });
}

describe("gmail watch renewal backoff", () => {
  it("backs off transient failures, retries, and resets on success", async () => {
    const user = await seedUser("transient", { withAccount: true });
    await seedWatch(user.userId, user.emailAddress);
    interceptGmail(500, user.emailAddress);

    await expect(renewExpiringGmailWatches(appEnv)).resolves.toEqual({
      renewed: 0,
      total: 1,
    });
    const failed = await readWatch(user.userId);
    expect(failed).toMatchObject({
      renewal_auth_failure_count: 0,
      renewal_failure_count: 1,
      status: "error",
    });
    expect(failed?.next_renewal_attempt_at).not.toBeNull();
    expect(Date.parse(failed?.next_renewal_attempt_at ?? "")).toBeGreaterThan(
      Date.now()
    );

    await expect(renewExpiringGmailWatches(appEnv)).resolves.toEqual({
      renewed: 0,
      total: 0,
    });

    await clearBackoff(user.userId);
    interceptGmail(200, user.emailAddress);
    await expect(renewExpiringGmailWatches(appEnv)).resolves.toEqual({
      renewed: 1,
      total: 1,
    });
    await expect(readWatch(user.userId)).resolves.toEqual({
      next_renewal_attempt_at: null,
      renewal_auth_failure_count: 0,
      renewal_failure_count: 0,
      status: "active",
    });
  });

  it("terminalizes consecutive auth failures and stops retrying", async () => {
    const user = await seedUser("auth", { withAccount: false });
    await seedWatch(user.userId, user.emailAddress);

    for (
      let attempt = 1;
      attempt <= GMAIL_WATCH_AUTH_FAILURE_LIMIT;
      attempt += 1
    ) {
      // biome-ignore lint/performance/noAwaitInLoops: Each renewal pass must observe the previous failure count.
      await clearBackoff(user.userId);
      const pass = await renewExpiringGmailWatches(appEnv);
      expect(pass).toEqual({ renewed: 0, total: 1 });
      const row = await readWatch(user.userId);
      if (attempt < GMAIL_WATCH_AUTH_FAILURE_LIMIT) {
        expect(row).toMatchObject({
          renewal_auth_failure_count: attempt,
          renewal_failure_count: attempt,
          status: "error",
        });
      } else {
        expect(row).toEqual({
          next_renewal_attempt_at: null,
          renewal_auth_failure_count: GMAIL_WATCH_AUTH_FAILURE_LIMIT,
          renewal_failure_count: GMAIL_WATCH_AUTH_FAILURE_LIMIT,
          status: "revoked",
        });
      }
    }

    await expect(renewExpiringGmailWatches(appEnv)).resolves.toEqual({
      renewed: 0,
      total: 0,
    });

    const status = await exports.default.fetch(
      "https://outreach.test/api/gmail/status",
      { headers: { cookie: user.cookie } }
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      connected: false,
      ok: true,
      watch: {
        renewalFailureCount: GMAIL_WATCH_AUTH_FAILURE_LIMIT,
        status: "revoked",
      },
    });
  });

  it("resets a revoked watch when the user reconnects", async () => {
    const user = await seedUser("reconnect", { withAccount: true });
    await seedWatch(user.userId, user.emailAddress, {
      authFailures: GMAIL_WATCH_AUTH_FAILURE_LIMIT,
      failures: GMAIL_WATCH_AUTH_FAILURE_LIMIT,
      status: "revoked",
    });
    interceptGmail(200, user.emailAddress);

    const reconnect = await exports.default.fetch(
      "https://outreach.test/api/gmail/watch",
      { headers: { cookie: user.cookie }, method: "POST" }
    );
    expect(reconnect.status).toBe(200);
    await expect(reconnect.json()).resolves.toMatchObject({ ok: true });
    await expect(readWatch(user.userId)).resolves.toEqual({
      next_renewal_attempt_at: null,
      renewal_auth_failure_count: 0,
      renewal_failure_count: 0,
      status: "active",
    });
  });
});
