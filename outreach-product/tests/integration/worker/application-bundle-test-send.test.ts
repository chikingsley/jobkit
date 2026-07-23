import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
const timestamp = "2026-07-18T00:00:00.000Z";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("ANESL application set test sends", () => {
  it("rejects a recipient outside the account email and allowlist", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "anesl-test-send-foreign@example.test"
    );
    const bundleId = await seedTestSendBundle(userId, "BJ7001");

    const response = await postTestSend(
      bundleId,
      cookie,
      "arbitrary-outsider@example.com"
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      message:
        "Test sends can only go to your account email or an ownership-verified Test Lab delivery address",
      ok: false,
    });
    await expect(
      testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM application_bundle_test_sends WHERE bundle_id=?"
      )
        .bind(bundleId)
        .first()
    ).resolves.toEqual({ count: 0 });
  });

  it("sends a test to the signed-in account email", async () => {
    const email = "anesl-test-send-owner@example.test";
    const { cookie, userId } = await createAuthenticatedUser(email);
    const bundleId = await seedTestSendBundle(userId, "BJ7002");
    await seedActiveGmail(userId, email);

    const gmailFetch = mockGmailFetch(email);
    try {
      const response = await postTestSend(bundleId, cookie, email);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        testSend: { recipient: email, status: "sent" },
      });
    } finally {
      gmailFetch.mockRestore();
    }
  });

  it("sends a test to an ownership-verified allowlisted address", async () => {
    const email = "anesl-test-send-allowlist@example.test";
    const allowlisted = "anesl-test-send-mailbox@example.test";
    const { cookie, userId } = await createAuthenticatedUser(email);
    const bundleId = await seedTestSendBundle(userId, "BJ7003");
    await seedActiveGmail(userId, email);
    await testEnv.DB.prepare(
      `INSERT INTO test_delivery_allowlist
        (user_id,email,ownership_basis,created_at)
       VALUES (?,?,'gmail_mailbox',?)`
    )
      .bind(userId, allowlisted, timestamp)
      .run();

    const gmailFetch = mockGmailFetch(email);
    try {
      const response = await postTestSend(bundleId, cookie, allowlisted);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        testSend: { recipient: allowlisted, status: "sent" },
      });
    } finally {
      gmailFetch.mockRestore();
    }
  });
});

async function seedTestSendBundle(userId: string, reference: string) {
  const contactId = `contact:test-send-${reference}`;
  const channelId = `contact-channel:test-send-${reference}`;
  const jobId = `anesl:${reference}`;
  const userJobId = `user-job:${reference}`;
  const draftId = `draft:${reference}`;
  const bundleId = `bundle:${reference}`;
  const channelEmail = `hr-${reference.toLowerCase()}@anesl.com`;
  const message = `Hello Mr. Yang,

I am interested in ${reference}.

Would you be free to speak about the role?

Best,
Integration User`;
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO contacts
        (id,display_name,organization_name,role,status,created_at,updated_at)
       VALUES (?,'Mr. Corey Yang','ANESL','board_intermediary','active',?,?)`
    ).bind(contactId, timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO contact_channels
        (id,contact_id,kind,value,normalized_value,status,created_at,updated_at)
       VALUES (?,?,'email',?,?,'active',?,?)`
    ).bind(
      channelId,
      contactId,
      channelEmail,
      channelEmail,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO job_listings
        (id,board,title,company,country,location,source_url,apply_url,
         contact_name,source_reference,first_seen_at,updated_at)
       VALUES (?,'anesl','English teacher','ANESL','China','China',?,?,
               'Mr. Corey Yang',?,?,?)`
    ).bind(
      jobId,
      `https://example.test/${reference}`,
      `https://example.test/${reference}`,
      reference,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO user_listing_states
        (id,user_id,job_id,status,created_at,updated_at)
       VALUES (?,?,?,'review',?,?)`
    ).bind(userJobId, userId, jobId, timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO application_bundles
        (id,user_id,kind,contact_channel_id,recipient,subject,status,
         created_at,updated_at)
       VALUES (?,?,'anesl_positions',?,?,?,'review',?,?)`
    ).bind(
      bundleId,
      userId,
      channelId,
      channelEmail,
      `Native English Teacher Application - ${reference}`,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO application_drafts
        (id,user_job_id,application_bundle_id,version,message,
         required_opening,status,created_at)
       VALUES (?,?,?,1,?,'Hello Mr. Yang,','draft',?)`
    ).bind(draftId, userJobId, bundleId, message, timestamp),
  ]);
  return bundleId;
}

function seedActiveGmail(userId: string, email: string) {
  return testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO user_accounts
        (id,account_id,provider_id,user_id,access_token,
         access_token_expires_at,scope,created_at,updated_at)
       VALUES (?,?,'google',?,'synthetic-access-token',?,?,?,?)`
    ).bind(
      `google:${userId}`,
      email,
      userId,
      "2099-01-01T00:00:00.000Z",
      "https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly",
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO gmail_mailbox_watches
        (user_id,email_address,history_id,expiration_at,status,last_error,
         created_at,updated_at)
       VALUES (?,?,?,?,'active','',?,?)`
    ).bind(
      userId,
      email,
      "100",
      "2099-01-01T00:00:00.000Z",
      timestamp,
      timestamp
    ),
  ]);
}

function postTestSend(bundleId: string, cookie: string, recipient: string) {
  return exports.default.fetch(
    `https://outreach.test/api/anesl/application-sets/${bundleId}/test-send`,
    {
      body: JSON.stringify({ recipient }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    }
  );
}

function mockGmailFetch(email: string) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith("/users/me/profile")) {
      return Promise.resolve(
        Response.json({ emailAddress: email, historyId: "100" })
      );
    }
    if (url.endsWith("/users/me/drafts")) {
      return Promise.resolve(
        Response.json({
          id: "test-send-draft",
          message: { id: "test-send-draft-message", threadId: "thread" },
        })
      );
    }
    if (url.endsWith("/users/me/drafts/send")) {
      return Promise.resolve(
        Response.json({ id: "test-send-message", threadId: "test-send-thread" })
      );
    }
    if (url.includes("/users/me/messages/test-send-message")) {
      return Promise.resolve(
        Response.json({
          id: "test-send-message",
          labelIds: ["SENT"],
          threadId: "test-send-thread",
        })
      );
    }
    if (url.includes("oauth2.googleapis.com/token")) {
      return Promise.resolve(
        Response.json({
          access_token: "synthetic-access-token",
          expires_in: 3600,
          scope:
            "https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly",
          token_type: "Bearer",
        })
      );
    }
    return Promise.resolve(
      new Response(`Unexpected request: ${url}`, { status: 500 })
    );
  });
}
