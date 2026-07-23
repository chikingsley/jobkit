import { applyD1Migrations } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProfile } from "../../../../src/features/profile/schema";
import { advertisedPositionQuestion } from "../../../../worker/ai/application-message-policy";
import { writeAutomationPolicy } from "../../../../worker/repositories/automation-policy";
import { upsertJob, upsertUserJob } from "../../../../worker/repositories/jobs";
import { writeProfile } from "../../../../worker/repositories/user-settings";
import { JobImportSchema } from "../../../../worker/schemas";
import { queueDueFollowUps } from "../../../../worker/services/followups";
import { createAuthenticatedUser } from ".././auth";
import {
  claimTask,
  completeTask,
  latestDraft,
  messageFor,
  pairAgent,
  seedCompleteCorePacket,
  seedMessageFoundation,
  seedSentApplication,
  seedSyntheticGmail,
  sessionGet,
  sessionPost,
  testEnv,
} from "./support/model";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

afterEach(() => vi.restoreAllMocks());

function followUpGmailMessageResponse(url: string) {
  if (url.includes("/users/me/messages/follow-up-gmail-message")) {
    return Response.json({
      id: "follow-up-gmail-message",
      payload: {
        headers: [{ name: "Message-ID", value: "<original@example.test>" }],
      },
      threadId: "follow-up-thread",
    });
  }
  if (url.includes("/users/me/messages/follow-up-sent-message")) {
    return Response.json({
      id: "follow-up-sent-message",
      labelIds: ["SENT"],
      threadId: "follow-up-thread",
    });
  }
  return null;
}

describe("Codex application message tasks", () => {
  it("schedules an explicit follow-up, drafts it through Codex, and creates a threaded Gmail draft", async () => {
    const email = "follow-up-agent@example.test";
    const { cookie, userId } = await createAuthenticatedUser(email);
    const timestamp = "2026-07-01T00:00:00.000Z";
    const jobId = "follow-up-agent-job";
    await writeProfile(testEnv.DB, userId, {
      ...defaultProfile,
      citizenship: "United States",
      currentLocation: "Phoenix, Arizona",
      email,
      fullName: "Integration User",
      preferredName: "Integration",
    });
    await seedMessageFoundation(userId, timestamp);
    await seedSentApplication(userId, jobId, timestamp);
    await writeAutomationPolicy(testEnv.DB, userId, {
      allowedBoards: [],
      boardForm: { dailyLimit: 10, mode: "review" },
      email: { dailyLimit: 20, mode: "review" },
      excludedMarketSegments: [],
      followUpDelaysDays: [1],
      minimumFit: "strong",
      paused: false,
      requireKnownCompensation: false,
      routeFreshnessDays: 30,
    });

    await expect(queueDueFollowUps(testEnv)).resolves.toEqual({
      considered: 1,
      queued: 1,
    });
    await expect(queueDueFollowUps(testEnv)).resolves.toEqual({
      considered: 1,
      queued: 0,
    });

    const token = await pairAgent(cookie);
    const generation = await claimTask(token);
    expect(generation).toMatchObject({
      model: "gpt-5.6-luna",
      taskType: "application.message",
    });
    const question = advertisedPositionQuestion(new Date(), "UTC");
    const message = `Hello,\n\nI wanted to follow up on my earlier message about the English instructor role.\n\n${question}\n\nBest,\nIntegration User\nE: ${email}`;
    const completed = await completeTask(token, generation, {
      message,
      summary: "Followed up briefly on the advertised role.",
    });
    expect(completed.status).toBe(200);

    const detailBeforeDraft = await sessionGet(
      "/api/messages/threads/follow-up-thread",
      cookie
    );
    await expect(detailBeforeDraft.json()).resolves.toMatchObject({
      thread: {
        followUps: [
          {
            message,
            ordinal: 1,
            status: "review",
          },
        ],
      },
    });

    await seedSyntheticGmail(userId, email, timestamp);
    const requestBodies: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((request, init) => {
      const url = String(request);
      if (url.endsWith("/users/me/profile")) {
        return Promise.resolve(
          Response.json({ emailAddress: email, historyId: "1" })
        );
      }
      const messageResponse = followUpGmailMessageResponse(url);
      if (messageResponse) {
        return Promise.resolve(messageResponse);
      }
      if (url.endsWith("/users/me/drafts/send")) {
        return Promise.resolve(
          Response.json({
            id: "follow-up-sent-message",
            threadId: "follow-up-thread",
          })
        );
      }
      if (url.endsWith("/users/me/drafts")) {
        requestBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return Promise.resolve(
          Response.json({
            id: "gmail-follow-up-draft",
            message: {
              id: "gmail-follow-up-message",
              threadId: "follow-up-thread",
            },
          })
        );
      }
      return Promise.resolve(
        new Response("Unexpected Gmail request", { status: 500 })
      );
    });
    const followUp = await testEnv.DB.prepare(
      "SELECT id FROM outreach_followups WHERE user_id=?"
    )
      .bind(userId)
      .first<{ id: string }>();
    if (!followUp) {
      throw new Error("Expected a scheduled follow-up");
    }
    const drafted = await sessionPost(
      `/api/messages/follow-ups/${encodeURIComponent(followUp.id)}/gmail-draft`,
      cookie,
      {}
    );
    expect(drafted.status).toBe(200);
    await expect(drafted.json()).resolves.toMatchObject({
      followUp: {
        gmailDraftId: "gmail-follow-up-draft",
        status: "drafted",
      },
    });
    expect(requestBodies).toEqual([
      {
        message: {
          raw: expect.any(String),
          threadId: "follow-up-thread",
        },
      },
    ]);

    const sent = await sessionPost(
      `/api/messages/follow-ups/${encodeURIComponent(followUp.id)}/send`,
      cookie,
      {}
    );
    expect(sent.status).toBe(200);
    await expect(sent.json()).resolves.toMatchObject({
      followUp: { status: "sent" },
    });
    const detailAfterSend = await sessionGet(
      "/api/messages/threads/follow-up-thread",
      cookie
    );
    await expect(detailAfterSend.json()).resolves.toMatchObject({
      thread: {
        followUps: [{ status: "sent" }],
        messages: [
          expect.objectContaining({ body: expect.any(String) }),
          expect.objectContaining({
            body: message,
            direction: "outbound",
            gmailMessageId: "follow-up-sent-message",
          }),
        ],
      },
    });
  });

  it("generates and revises immutable job drafts through the paired agent", async () => {
    const email = "message-agent@example.test";
    const { cookie, userId } = await createAuthenticatedUser(email);
    const jobId = "message-agent-job";
    const timestamp = "2026-07-18T00:00:00.000Z";
    await writeProfile(testEnv.DB, userId, {
      ...defaultProfile,
      citizenship: "United States",
      currentLocation: "Phoenix, Arizona",
      email,
      fullName: "Integration User",
      preferredName: "Integration",
    });
    await seedMessageFoundation(userId, timestamp);
    await seedCompleteCorePacket(cookie, "job-revision");
    await upsertJob(
      testEnv.DB,
      JobImportSchema.parse({
        applyUrl: "https://example.test/apply",
        company: "Example University",
        country: "Poland",
        description:
          "The university needs an English instructor for adult learners.",
        id: jobId,
        title: "English instructor",
      }),
      timestamp
    );
    await upsertUserJob(testEnv.DB, userId, jobId, 1, timestamp);

    const queued = await sessionPost(`/api/jobs/${jobId}/generate`, cookie, {});
    const queuedPayload = (await queued.json()) as {
      taskRequest: { id: string };
    };
    expect(queued.status).toBe(202);

    const token = await pairAgent(cookie);
    const generation = await claimTask(token);
    expect(generation).toMatchObject({
      model: "gpt-5.6-luna",
      promptVersion: "application-message-generate-v3",
      taskType: "application.message",
      webSearch: "disabled",
    });
    expect(generation.prompt).toContain(
      "Describe lesser-known local schools through the teaching setting, learner group, and location instead of naming them."
    );
    const question = advertisedPositionQuestion(new Date(), "UTC");
    const firstMessage = messageFor(
      question,
      "I have taught adult English learners in classroom settings and would be glad to discuss this university position."
    );
    const completed = await completeTask(token, generation, {
      message: firstMessage,
      summary: "Used the candidate's adult teaching experience.",
    });
    expect(completed.status).toBe(200);

    const taskStatus = await exports.default.fetch(
      `https://outreach.test/api/agent-task-requests/${queuedPayload.taskRequest.id}`,
      { headers: { cookie } }
    );
    await expect(taskStatus.json()).resolves.toMatchObject({
      taskRequest: { status: "completed" },
    });
    await expect(latestDraft(jobId, userId)).resolves.toMatchObject({
      message: firstMessage,
      model_id: "gpt-5.6-luna",
      model_provider: "codex",
      revision_source: "generated",
      version: 1,
    });

    const revisionQueued = await sessionPost(
      `/api/jobs/${jobId}/revise`,
      cookie,
      { instruction: "Mention the university classroom context more directly." }
    );
    expect(revisionQueued.status).toBe(202);
    const revision = await claimTask(token);
    expect(revision).toMatchObject({
      model: "gpt-5.6-terra",
      promptVersion: "application-message-revise-v3",
      taskType: "application.message",
    });
    const revisedMessage = messageFor(
      question,
      "I have taught adult English learners in classroom settings, including university review lectures, and would be glad to discuss this position."
    );
    await completeTask(token, revision, {
      message: revisedMessage,
      summary: "Added the relevant university classroom context.",
    });
    await expect(latestDraft(jobId, userId)).resolves.toMatchObject({
      message: revisedMessage,
      model_id: "gpt-5.6-terra",
      model_provider: "codex",
      revision_source: "ai_revision",
      version: 2,
    });
  });
});
