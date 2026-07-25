import { resolveAssignment } from "../../../../src/model/registry";

const MESSAGE_MODEL = resolveAssignment("application.message");

import { applyD1Migrations } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProfile } from "../../../../src/features/profile/schema";
import { advertisedPositionQuestion } from "../../../../worker/ai/application-message-policy";
import { writeProfile } from "../../../../worker/repositories/user-settings";
import { JobImportSchema } from "../../../../worker/schemas";
import { importJobs } from "../../../../worker/services/application-drafts";
import { createAuthenticatedUser } from ".././auth";
import { seedStrongEnglishMatch } from ".././campaign-match-fixtures";
import {
  aneslMessageFor,
  claimTask,
  completeTask,
  latestBundleDraft,
  pairAgent,
  seedAneslPosition,
  seedCompleteCorePacket,
  seedMessageFoundation,
  sessionGet,
  sessionPost,
  testEnv,
} from "./support/model";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

afterEach(() => vi.restoreAllMocks());

describe("Codex application message tasks", () => {
  it("generates and revises one ANESL bundle through the same durable task path", async () => {
    const email = "anesl-message-agent@example.test";
    const { cookie, userId } = await createAuthenticatedUser(email);
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
    await seedCompleteCorePacket(cookie, "anesl-revision");
    const firstJobId = await seedAneslPosition("BJ1001", timestamp);
    const secondJobId = await seedAneslPosition("SH2002", timestamp);

    const queued = await sessionPost("/api/anesl/application-sets", cookie, {
      jobIds: [firstJobId, secondJobId],
    });
    expect(queued.status).toBe(202);
    const queuedPayload = (await queued.json()) as {
      applicationSet: { draft: null; id: string };
      taskRequest: { id: string };
    };
    expect(queuedPayload.applicationSet.draft).toBeNull();

    const token = await pairAgent(cookie);
    const generation = await claimTask(token);
    expect(generation).toMatchObject({
      model: MESSAGE_MODEL.model,
      taskType: "application.message",
    });
    const firstMessage = aneslMessageFor(
      "I am interested in positions BJ1001 and SH2002 and would be glad to discuss the relevant teaching needs."
    );
    await completeTask(token, generation, {
      message: firstMessage,
      summary: "Referenced both selected ANESL positions.",
    });
    await expect(
      latestBundleDraft(queuedPayload.applicationSet.id)
    ).resolves.toMatchObject({
      message: firstMessage,
      model_id: MESSAGE_MODEL.model,
      model_provider: MESSAGE_MODEL.provider,
      revision_source: "generated",
    });

    const revisionQueued = await sessionPost(
      `/api/anesl/application-sets/${queuedPayload.applicationSet.id}/revise`,
      cookie,
      { instruction: "Ask which location is the strongest current match." }
    );
    expect(revisionQueued.status).toBe(202);
    const revision = await claimTask(token);
    expect(revision).toMatchObject({ model: MESSAGE_MODEL.model });
    const revisedMessage = aneslMessageFor(
      "I am interested in positions BJ1001 and SH2002 and would be glad to discuss which location is the strongest current match."
    );
    await completeTask(token, revision, {
      message: revisedMessage,
      summary: "Added the requested location emphasis.",
    });
    await expect(
      latestBundleDraft(queuedPayload.applicationSet.id)
    ).resolves.toMatchObject({
      message: revisedMessage,
      model_id: MESSAGE_MODEL.model,
      model_provider: MESSAGE_MODEL.provider,
      revision_source: "ai_revision",
      version: 2,
    });
  });

  it("calibrates a campaign dispatch and persists reusable feedback", async () => {
    const email = "campaign-message-agent@example.test";
    const { cookie, userId } = await createAuthenticatedUser(email);
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
    await importJobs(testEnv, userId, [
      JobImportSchema.parse({
        applyEmail: "campaign-hiring@example.test",
        applyUrl: "https://example.test/campaign-role",
        company: "Campaign School",
        country: "Poland",
        description: "A posted English teaching position for adult learners.",
        id: "campaign-message-job",
        title: "English teacher",
      }),
    ]);
    await seedStrongEnglishMatch(testEnv.DB, "campaign-message-job", timestamp);

    const created = await sessionPost("/api/campaigns", cookie, {
      countryCodes: ["PL"],
      dailyPace: 6,
      firstFiveRequired: true,
      postedTargetPercent: 80,
      stopAfterHumanReplies: 3,
    });
    const createdPayload = (await created.json()) as {
      campaign: { id: string };
    };
    const calibration = await sessionPost(
      `/api/campaigns/${createdPayload.campaign.id}/actions`,
      cookie,
      { action: "begin_calibration", reason: "" }
    );
    const calibrationPayload = (await calibration.json()) as {
      campaign: { dispatches: Array<{ id: string }> };
    };
    const [dispatch] = calibrationPayload.campaign.dispatches;
    if (!dispatch) {
      throw new Error("Campaign calibration dispatch was not created");
    }

    const token = await pairAgent(cookie);
    const generation = await claimTask(token);
    const question = advertisedPositionQuestion(new Date(), "UTC");
    const generatedMessage = `Hello,\n\nI have taught adult English learners and would be glad to discuss this position.\n\n${question}\n\nBest,\nIntegration User\nE: ${email}`;
    await completeTask(token, generation, {
      message: generatedMessage,
      summary: "Used the candidate's adult teaching experience.",
    });
    const afterGeneration = await sessionGet(
      `/api/campaigns/${createdPayload.campaign.id}`,
      cookie
    );
    await expect(afterGeneration.json()).resolves.toMatchObject({
      campaign: {
        dispatches: [
          {
            id: dispatch.id,
            message: { message: generatedMessage, version: 1 },
            status: "review",
          },
        ],
      },
    });

    const revision = await sessionPost(
      `/api/campaigns/${createdPayload.campaign.id}/dispatches/${dispatch.id}/revisions`,
      cookie,
      {
        dispatchId: dispatch.id,
        instruction: "Keep the description of adult teaching this direct.",
      }
    );
    expect(revision.status).toBe(202);
    const queuedRevision = await sessionGet(
      `/api/campaigns/${createdPayload.campaign.id}`,
      cookie
    );
    await expect(queuedRevision.json()).resolves.toMatchObject({
      campaign: {
        dispatches: [{ id: dispatch.id, status: "drafting" }],
      },
    });
    const revisionTask = await claimTask(token);
    const revisedMessage = `Hello,\n\nI have taught adult English learners in several classroom settings and would be glad to discuss this position.\n\n${question}\n\nBest,\nIntegration User\nE: ${email}`;
    await completeTask(token, revisionTask, {
      guidance: {
        instruction:
          "Describe adult teaching experience in direct, ordinary language.",
        scope: "campaign",
      },
      message: revisedMessage,
      summary: "Kept the adult teaching description direct.",
    });
    const approved = await sessionPost(
      `/api/campaigns/${createdPayload.campaign.id}/dispatches/${dispatch.id}/approve`,
      cookie,
      {}
    );
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({
      campaign: {
        dispatches: [
          {
            message: {
              message: revisedMessage,
              status: "approved",
              version: 2,
            },
            status: "ready",
          },
        ],
        guidance: [
          {
            instruction:
              "Describe adult teaching experience in direct, ordinary language.",
            scope: "campaign",
            status: "accepted",
          },
        ],
        status: "ready",
      },
    });
  });
});
