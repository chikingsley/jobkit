import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { recordInboundMessage } from "../../../worker/services/messages";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
const timestamp = "2026-07-15T00:00:00.000Z";
const gmailThreadId = "thr-inbound-1";

async function seedSentAttempt(userId: string, suffix: string) {
  const jobId = `eslcafe-modern:${suffix}`;
  const userJobId = `user-job-${suffix}`;
  const draftId = `draft-${suffix}`;
  const attemptId = `attempt-${suffix}`;
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
       VALUES (?,?,?,'applied',?,?)`
    ).bind(userJobId, userId, jobId, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO application_drafts
        (id,user_job_id,version,message,status,created_at)
       VALUES (?,?,1,?,'submitted',?)`
    ).bind(
      draftId,
      userJobId,
      "Hello,\n\nIs this role still open?\n\nBest,\nTest Candidate",
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
      "school@example.test",
      `https://example.test/jobs/${suffix}`,
      timestamp,
      timestamp,
      timestamp
    ),
    env.DB.prepare(
      `INSERT INTO application_attempts
        (id,user_job_id,draft_id,route_id,channel,status,recipient,subject,
         gmail_message_id,gmail_thread_id,approved_at,sent_at,created_at,
         updated_at)
       VALUES (?,?,?,?,'email','sent',?,?,?,?,?,?,?,?)`
    ).bind(
      attemptId,
      userJobId,
      draftId,
      routeId,
      "school@example.test",
      "English teacher application",
      "gm-out-1",
      gmailThreadId,
      timestamp,
      timestamp,
      timestamp,
      timestamp
    ),
  ]);
  return { attemptId, draftId, jobId };
}

function request(
  path: string,
  cookie: string,
  init?: { body?: Record<string, unknown>; method?: string }
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: init?.body ? JSON.stringify(init.body) : undefined,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      cookie,
    },
    method: init?.method ?? "GET",
  });
}

const inboundPayload = {
  bodyText: "Thanks for applying! Are you available for an interview?",
  fromAddress: "Recruiter <school@example.test>",
  gmailMessageId: "gm-in-1",
  gmailThreadId,
  sentAt: "2026-07-16T09:00:00.000Z",
  subject: "Re: English teacher application",
  toAddress: "candidate@example.test",
};

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("inbound message sync", () => {
  it("stitches recorded replies into the sent thread with unread tracking", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "messages@example.test"
    );
    await seedSentAttempt(userId, "reply");

    const recorded = await recordInboundMessage(env.DB, userId, inboundPayload);
    expect(recorded).toEqual({ created: true });

    const duplicate = await recordInboundMessage(
      env.DB,
      userId,
      inboundPayload
    );
    expect(duplicate).toEqual({ created: false });

    const list = await request("/api/messages", cookie);
    const { threads } = (await list.json()) as {
      threads: {
        messageCount: number;
        preview: string;
        threadId: string;
        unreadCount: number;
      }[];
    };
    expect(threads).toHaveLength(1);
    const [summary] = threads;
    if (!summary) {
      throw new Error("Expected a message thread summary");
    }
    expect(summary).toMatchObject({
      messageCount: 2,
      threadId: gmailThreadId,
      unreadCount: 1,
    });
    expect(summary.preview).toContain("Thanks for applying");

    const detail = await request(
      `/api/messages/threads/${gmailThreadId}`,
      cookie
    );
    const { thread } = (await detail.json()) as {
      thread: { messages: { direction: string; from: string }[] };
    };
    expect(thread.messages).toHaveLength(2);
    const [outbound, inbound] = thread.messages;
    if (!(outbound && inbound)) {
      throw new Error("Expected outbound and inbound thread messages");
    }
    expect(outbound.direction).toBe("outbound");
    expect(inbound).toMatchObject({
      direction: "inbound",
      from: "Recruiter <school@example.test>",
    });

    const read = await request(
      `/api/messages/threads/${gmailThreadId}/read`,
      cookie,
      { method: "POST" }
    );
    expect(await read.json()).toMatchObject({ marked: 1, ok: true });
    const relisted = await request("/api/messages", cookie);
    const relistedThreads = (await relisted.json()) as {
      threads: { unreadCount: number }[];
    };
    const [relistedSummary] = relistedThreads.threads;
    if (!relistedSummary) {
      throw new Error("Expected the relisted message thread summary");
    }
    expect(relistedSummary.unreadCount).toBe(0);
  });

  it("rejects inbound messages for unknown threads", async () => {
    const { userId } = await createAuthenticatedUser(
      "messages-unknown@example.test"
    );
    await seedSentAttempt(userId, "unknown");
    await expect(
      recordInboundMessage(env.DB, userId, {
        ...inboundPayload,
        gmailThreadId: "thr-not-ours",
      })
    ).rejects.toMatchObject({ status: 404 });
  });
});
