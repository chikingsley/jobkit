import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
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

function request(path: string, cookie: string, body?: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      cookie,
    },
    method: "POST",
  });
}

async function approve(cookie: string, fixture: EmailFixture): Promise<string> {
  const response = await request(
    `/api/jobs/${encodeURIComponent(fixture.jobId)}/email-attempts`,
    cookie,
    { draftId: fixture.draftId, routeId: fixture.routeId }
  );
  if (!response.ok) {
    throw new Error(`Email attempt approval failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    attempt: { attemptId: string; status: string };
  };
  if (payload.attempt.status !== "approved") {
    throw new Error("Email attempt approval returned the wrong state");
  }
  return payload.attempt.attemptId;
}

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("email application attempts", () => {
  it("keeps approval, Gmail drafting, and verified sending as explicit states", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "email-attempt@example.test"
    );
    const fixture = await seedEmailFixture(userId, "happy");
    const attemptId = await approve(cookie, fixture);

    const listed = await exports.default.fetch(
      "https://outreach.test/api/email-attempts?status=approved",
      { headers: { cookie } }
    );
    expect(await listed.json()).toMatchObject({
      attempts: [{ attemptId, recipient: "happy@example.test" }],
    });

    const claim = await request(
      `/api/email-attempts/${attemptId}/claim`,
      cookie
    );
    const claimPayload = (await claim.json()) as {
      attachmentCount: number;
      attemptId: string;
      raw: string;
    };
    expect(claim.status).toBe(200);
    expect(claimPayload).toMatchObject({ attachmentCount: 0, attemptId });
    expect(claimPayload.raw.length).toBeGreaterThan(100);

    expect(
      (
        await request(`/api/email-attempts/${attemptId}/drafted`, cookie, {
          gmailDraftId: "gmail-draft-1",
          gmailMessageId: "gmail-draft-message-1",
        })
      ).status
    ).toBe(200);
    expect(
      (
        await request(`/api/email-attempts/${attemptId}/sending`, cookie, {
          gmailDraftId: "gmail-draft-1",
        })
      ).status
    ).toBe(200);
    expect(
      (
        await request(`/api/email-attempts/${attemptId}/sent`, cookie, {
          gmailDraftId: "gmail-draft-1",
          gmailMessageId: "gmail-message-1",
          gmailThreadId: "gmail-thread-1",
        })
      ).status
    ).toBe(200);

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

  it("makes a reserved but unverified send non-retryable", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "email-uncertain@example.test"
    );
    const fixture = await seedEmailFixture(userId, "uncertain");
    const attemptId = await approve(cookie, fixture);
    await request(`/api/email-attempts/${attemptId}/claim`, cookie);
    await request(`/api/email-attempts/${attemptId}/drafted`, cookie, {
      gmailDraftId: "gmail-draft-2",
      gmailMessageId: "gmail-draft-message-2",
    });
    await request(`/api/email-attempts/${attemptId}/sending`, cookie, {
      gmailDraftId: "gmail-draft-2",
    });

    const uncertain = await request(
      `/api/email-attempts/${attemptId}/uncertain`,
      cookie,
      { error: "verification response lost", stage: "gmail_send_or_verify" }
    );
    const duplicateSend = await request(
      `/api/email-attempts/${attemptId}/sending`,
      cookie,
      { gmailDraftId: "gmail-draft-2" }
    );

    expect(uncertain.status).toBe(200);
    expect(duplicateSend.status).toBe(409);
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
    const { cookie, userId } = await createAuthenticatedUser(
      "email-retry@example.test"
    );
    const fixture = await seedEmailFixture(userId, "retry");
    const attemptId = await approve(cookie, fixture);
    await request(`/api/email-attempts/${attemptId}/claim`, cookie);
    expect(
      (
        await request(`/api/email-attempts/${attemptId}/failed`, cookie, {
          error: "Gmail draft upload was rejected",
          stage: "draft",
        })
      ).status
    ).toBe(200);

    const reapprovedId = await approve(cookie, fixture);
    const claim = await request(
      `/api/email-attempts/${reapprovedId}/claim`,
      cookie
    );

    expect(reapprovedId).toBe(attemptId);
    expect(claim.status).toBe(200);
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
    const attemptId = await approve(owner.cookie, fixture);

    const otherList = await exports.default.fetch(
      "https://outreach.test/api/email-attempts?status=approved",
      { headers: { cookie: other.cookie } }
    );
    const otherClaim = await request(
      `/api/email-attempts/${attemptId}/claim`,
      other.cookie
    );

    expect(await otherList.json()).toMatchObject({ attempts: [] });
    expect(otherClaim.status).toBe(404);
  });
});
