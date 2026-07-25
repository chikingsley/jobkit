import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../../../worker/env";
import { processGmailPush } from "../../../worker/services/gmail-replies";
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

async function seedConnectedMailbox(suffix: string) {
  const emailAddress = `candidate-${suffix}@example.test`;
  const { userId } = await createAuthenticatedUser(
    `gmail-push-${suffix}@example.test`
  );
  const gmailThreadId = `thread-${suffix}`;
  const jobId = `eslcafe-modern:${suffix}`;
  const userJobId = `user-job-${suffix}`;
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO user_accounts
        (id,account_id,provider_id,user_id,access_token,refresh_token,
         access_token_expires_at,scope,created_at,updated_at)
       VALUES (?,?, 'google', ?, 'test-access-token','test-refresh-token',
         '2030-01-01T00:00:00.000Z',?,?,?)`
    ).bind(
      `google-${suffix}`,
      emailAddress,
      userId,
      "https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly",
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO gmail_mailbox_watches
        (user_id,email_address,history_id,expiration_at,status,last_error,
         created_at,updated_at)
       VALUES (?,?,'1000','2026-07-30T00:00:00.000Z','active','',?,?)`
    ).bind(userId, emailAddress, timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO job_listings
        (id,board,title,company,country,location,source_url,apply_url,
         first_seen_at,updated_at)
       VALUES (?, 'eslcafe-modern','English teacher','Test School','China',
         'Jinan',?,?,?,?)`
    ).bind(
      jobId,
      `https://example.test/jobs/${suffix}`,
      `https://example.test/jobs/${suffix}`,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO user_listing_states
        (id,user_id,job_id,status,created_at,updated_at)
       VALUES (?,?,?,'applied',?,?)`
    ).bind(userJobId, userId, jobId, timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO application_drafts
        (id,user_job_id,version,message,status,created_at)
       VALUES (?,?,1,'Hello, is this role still open?','submitted',?)`
    ).bind(`draft-${suffix}`, userJobId, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO application_routes
        (id,job_id,kind,destination,source_evidence,last_verified_at,status,
         created_at,updated_at)
       VALUES (?,?, 'email','school@example.test',?,?,'active',?,?)`
    ).bind(
      `route-${suffix}`,
      jobId,
      `https://example.test/jobs/${suffix}`,
      timestamp,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO application_attempts
        (id,user_job_id,draft_id,route_id,channel,status,recipient,subject,
         gmail_message_id,gmail_thread_id,approved_at,sent_at,created_at,
         updated_at)
       VALUES (?,?,?,?, 'email','sent','school@example.test',
         'English teacher application',?,?,?,?,?,?)`
    ).bind(
      `attempt-${suffix}`,
      userJobId,
      `draft-${suffix}`,
      `route-${suffix}`,
      `gm-out-${suffix}`,
      gmailThreadId,
      timestamp,
      timestamp,
      timestamp,
      timestamp
    ),
  ]);
  return { emailAddress, gmailThreadId, userId };
}

function interceptHistory(messageIds: string[], historyId: string) {
  gmailRoutes.set("/gmail/v1/users/me/history", {
    body: {
      history: [
        { messagesAdded: messageIds.map((id) => ({ message: { id } })) },
      ],
      historyId,
    },
    status: 200,
  });
}

function interceptMessage(messageId: string, status: number, body: unknown) {
  gmailRoutes.set(`/gmail/v1/users/me/messages/${messageId}`, {
    body,
    status,
  });
}

function replyMessage(id: string, threadId: string, recipient: string) {
  return {
    id,
    internalDate: "1753000000000",
    labelIds: ["INBOX"],
    payload: {
      body: { data: btoa("Thanks for applying! When can you interview?") },
      headers: [
        { name: "From", value: "Recruiter <school@example.test>" },
        { name: "To", value: recipient },
        { name: "Subject", value: "Re: English teacher application" },
      ],
      mimeType: "text/plain",
    },
    snippet: "Thanks for applying!",
    threadId,
  };
}

function readWatch(userId: string) {
  return testEnv.DB.prepare(
    `SELECT history_id,last_error,status FROM gmail_mailbox_watches
      WHERE user_id=?`
  )
    .bind(userId)
    .first<{ history_id: string; last_error: string; status: string }>();
}

describe("gmail push sync message fetch tolerance", () => {
  it("skips messages deleted since listing and keeps the watch active", async () => {
    const mailbox = await seedConnectedMailbox("tolerant");
    interceptHistory(["msg-live", "msg-gone"], "2000");
    interceptMessage(
      "msg-live",
      200,
      replyMessage("msg-live", mailbox.gmailThreadId, mailbox.emailAddress)
    );
    interceptMessage("msg-gone", 404, {
      error: { message: "Requested entity was not found." },
    });

    const result = await processGmailPush(appEnv, {
      emailAddress: mailbox.emailAddress,
      historyId: "2000",
      messageId: "pubsub-tolerant",
    });

    expect(result).toEqual({
      duplicate: false,
      messagesRecorded: 1,
      ok: true,
    });
    await expect(readWatch(mailbox.userId)).resolves.toEqual({
      history_id: "2000",
      last_error: "",
      status: "active",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM application_thread_messages
          WHERE user_id=? AND gmail_message_id='msg-live'`
      )
        .bind(mailbox.userId)
        .first<{ count: number }>()
    ).resolves.toEqual({ count: 1 });
  });

  it("still marks the watch on non-404 fetch failures and rethrows", async () => {
    const mailbox = await seedConnectedMailbox("failing");
    interceptHistory(["msg-broken"], "2000");
    interceptMessage("msg-broken", 500, {
      error: { message: "Backend Error" },
    });

    await expect(
      processGmailPush(appEnv, {
        emailAddress: mailbox.emailAddress,
        historyId: "2000",
        messageId: "pubsub-failing",
      })
    ).rejects.toThrow("Backend Error");
    await expect(readWatch(mailbox.userId)).resolves.toMatchObject({
      history_id: "1000",
      status: "error",
    });
  });
});
