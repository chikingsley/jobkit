import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimEmailAttempt,
  createApprovedEmailAttempt,
  EmailAttemptError,
  listEmailAttempts,
  recordFailedEmailAttempt,
  recordGmailDraft,
  recordGmailSent,
  recordUncertainEmailAttempt,
  reserveGmailSend,
} from "../../../worker/services/email-attempts";
import { deliverEmailAttempt } from "../../../worker/services/gmail-integration";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
const timestamp = "2026-07-15T00:00:00.000Z";

interface EmailFixture {
  draftId: string;
  jobId: string;
  routeId: string;
}

async function seedEmailFixture(
  userId: string,
  suffix: string
): Promise<EmailFixture> {
  const jobId = `eslcafe-modern:${suffix}`;
  const userJobId = `user-job-${suffix}`;
  const draftId = `draft-${suffix}`;
  const routeId = `route-${suffix}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO jobs
        (id,board,title,company,country,location,source_url,apply_url,
         first_seen_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      jobId,
      "eslcafe-modern",
      "English language lecturer",
      "Test University",
      "China",
      "Jinan",
      `https://example.test/jobs/${suffix}`,
      `https://example.test/jobs/${suffix}`,
      timestamp,
      timestamp
    ),
    env.DB.prepare(
      `INSERT INTO user_jobs
        (id,user_id,job_id,status,created_at,updated_at)
       VALUES (?,?,?,'review',?,?)`
    ).bind(userJobId, userId, jobId, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO application_drafts
        (id,user_job_id,version,message,status,created_at)
       VALUES (?,?,1,?,'draft',?)`
    ).bind(
      draftId,
      userJobId,
      "Hello,\n\nI teach English and would like to learn more about this role. What age groups would I teach?\n\nBest,\nTest Candidate",
      timestamp
    ),
    env.DB.prepare(
      `INSERT INTO application_routes
        (id,job_id,kind,destination,source_evidence,last_verified_at,status,
         created_at,updated_at)
       VALUES (?,?,'email',?,?,?,'active',?,?)`
    ).bind(
      routeId,
      jobId,
      `${suffix}@example.test`,
      `https://example.test/jobs/${suffix}`,
      timestamp,
      timestamp,
      timestamp
    ),
  ]);
  return { draftId, jobId, routeId };
}

async function approve(userId: string, fixture: EmailFixture): Promise<string> {
  const attempt = await createApprovedEmailAttempt(
    env,
    userId,
    fixture.jobId,
    fixture.draftId,
    fixture.routeId
  );
  if (attempt.status !== "approved") {
    throw new Error("Email attempt approval returned the wrong state");
  }
  return attempt.attemptId;
}

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("email application attempts", () => {
  it("keeps approval, Gmail drafting, and verified sending as explicit states", async () => {
    const { userId } = await createAuthenticatedUser(
      "email-attempt@example.test"
    );
    const fixture = await seedEmailFixture(userId, "happy");
    const attemptId = await approve(userId, fixture);

    const listed = await listEmailAttempts(env.DB, userId, ["approved"]);
    expect(listed).toMatchObject([
      { attemptId, recipient: "happy@example.test" },
    ]);

    const claimPayload = await claimEmailAttempt(env, userId, attemptId);
    expect(claimPayload).toMatchObject({ attachmentCount: 0, attemptId });
    expect(claimPayload.raw.length).toBeGreaterThan(100);

    await recordGmailDraft(
      env.DB,
      userId,
      attemptId,
      "gmail-draft-1",
      "gmail-draft-message-1"
    );
    await reserveGmailSend(env.DB, userId, attemptId, "gmail-draft-1");
    await recordGmailSent(
      env.DB,
      userId,
      attemptId,
      "gmail-draft-1",
      "gmail-message-1",
      "gmail-thread-1"
    );

    expect(
      await env.DB.prepare(
        `SELECT a.status,a.gmail_message_id,a.gmail_thread_id,
                uj.status user_job_status,d.status draft_status
           FROM application_attempts a
           JOIN user_jobs uj ON uj.id=a.user_job_id
           JOIN application_drafts d ON d.id=a.draft_id
          WHERE a.id=?`
      )
        .bind(attemptId)
        .first()
    ).toEqual({
      draft_status: "submitted",
      gmail_message_id: "gmail-message-1",
      gmail_thread_id: "gmail-thread-1",
      status: "sent",
      user_job_status: "applied",
    });
  });

  it("creates, sends, and independently verifies a Gmail draft in the Worker", async () => {
    const { userId } = await createAuthenticatedUser(
      "hosted-gmail@example.test"
    );
    const fixture = await seedEmailFixture(userId, "hosted");
    const attemptId = await approve(userId, fixture);
    const [attempt] = await listEmailAttempts(env.DB, userId, ["approved"]);
    if (!attempt) {
      throw new Error("Approved attempt was not found");
    }

    const gmailFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const url = String(input);
        if (url.endsWith("/users/me/profile")) {
          return Promise.resolve(
            Response.json({
              emailAddress: "hosted-gmail@example.test",
              historyId: "100",
            })
          );
        }
        if (url.endsWith("/users/me/drafts")) {
          return Promise.resolve(
            Response.json({
              id: "gmail-draft-hosted",
              message: {
                id: "gmail-draft-message-hosted",
                threadId: "thread",
              },
            })
          );
        }
        if (url.endsWith("/users/me/drafts/send")) {
          return Promise.resolve(
            Response.json({
              id: "gmail-message-hosted",
              threadId: "gmail-thread-hosted",
            })
          );
        }
        if (url.includes("/users/me/messages/gmail-message-hosted")) {
          return Promise.resolve(
            Response.json({
              id: "gmail-message-hosted",
              labelIds: ["SENT"],
              threadId: "gmail-thread-hosted",
            })
          );
        }
        return Promise.resolve(
          new Response("Unexpected Gmail request", { status: 500 })
        );
      });

    try {
      const sent = await deliverEmailAttempt(
        env,
        userId,
        attempt,
        "test-access-token"
      );
      expect(sent).toMatchObject({
        attemptId,
        gmailMessageId: "gmail-message-hosted",
        gmailThreadId: "gmail-thread-hosted",
        status: "sent",
      });
      expect(gmailFetch).toHaveBeenCalledTimes(4);
      expect(gmailFetch.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    } finally {
      gmailFetch.mockRestore();
    }
  });

  it("makes a reserved but unverified send non-retryable", async () => {
    const { userId } = await createAuthenticatedUser(
      "email-uncertain@example.test"
    );
    const fixture = await seedEmailFixture(userId, "uncertain");
    const attemptId = await approve(userId, fixture);
    await claimEmailAttempt(env, userId, attemptId);
    await recordGmailDraft(
      env.DB,
      userId,
      attemptId,
      "gmail-draft-2",
      "gmail-draft-message-2"
    );
    await reserveGmailSend(env.DB, userId, attemptId, "gmail-draft-2");

    await recordUncertainEmailAttempt(
      env.DB,
      userId,
      attemptId,
      "gmail_send_or_verify",
      "verification response lost"
    );
    await expect(
      reserveGmailSend(env.DB, userId, attemptId, "gmail-draft-2")
    ).rejects.toMatchObject({ status: 409 });

    expect(
      await env.DB.prepare(
        "SELECT status,error_stage FROM application_attempts WHERE id=?"
      )
        .bind(attemptId)
        .first()
    ).toEqual({
      error_stage: "gmail_send_or_verify",
      status: "uncertain",
    });
  });

  it("allows an explicitly reapproved pre-send failure to be claimed again", async () => {
    const { userId } = await createAuthenticatedUser(
      "email-retry@example.test"
    );
    const fixture = await seedEmailFixture(userId, "retry");
    const attemptId = await approve(userId, fixture);
    await claimEmailAttempt(env, userId, attemptId);
    await recordFailedEmailAttempt(
      env.DB,
      userId,
      attemptId,
      "draft",
      "Gmail draft upload was rejected"
    );

    const reapprovedId = await approve(userId, fixture);
    const claim = await claimEmailAttempt(env, userId, reapprovedId);

    expect(reapprovedId).toBe(attemptId);
    expect(claim.attemptId).toBe(attemptId);
    expect(
      await env.DB.prepare(
        "SELECT status,error_stage,error_detail FROM application_attempts WHERE id=?"
      )
        .bind(attemptId)
        .first()
    ).toEqual({ error_detail: "", error_stage: "", status: "claimed" });
  });

  it("does not expose another user's attempt or MIME payload", async () => {
    const owner = await createAuthenticatedUser("email-owner@example.test");
    const other = await createAuthenticatedUser("email-other@example.test");
    const fixture = await seedEmailFixture(owner.userId, "private");
    const attemptId = await approve(owner.userId, fixture);

    const otherList = await listEmailAttempts(env.DB, other.userId, [
      "approved",
    ]);
    let claimError: unknown;
    try {
      await claimEmailAttempt(env, other.userId, attemptId);
    } catch (error) {
      claimError = error;
    }

    expect(otherList).toEqual([]);
    expect(claimError).toBeInstanceOf(EmailAttemptError);
    expect(claimError).toMatchObject({ status: 404 });
  });
});
