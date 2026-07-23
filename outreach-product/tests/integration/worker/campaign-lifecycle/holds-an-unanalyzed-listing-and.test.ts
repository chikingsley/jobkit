import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProfile } from "../../../../src/features/profile/schema";
import { advertisedPositionQuestion } from "../../../../worker/ai/application-message-policy";
import { writeProfile } from "../../../../worker/repositories/user-settings";
import { JobImportSchema } from "../../../../worker/schemas";
import { importJobs } from "../../../../worker/services/application-drafts";
import { deliverCampaignDispatchWithGmail } from "../../../../worker/services/campaign-email-attempts";
import { refreshCampaignMatchesForJob } from "../../../../worker/services/campaign-matching";
import { recordCampaignReply } from "../../../../worker/services/campaign-replies";
import { planDueCampaignRuns } from "../../../../worker/services/campaign-scheduler";
import { createAuthenticatedUser } from ".././auth";
import { seedStrongEnglishMatch } from ".././campaign-match-fixtures";
import {
  agentPost,
  CAMPAIGN_RECIPIENT_PATTERN,
  claimTask,
  pairAgent,
  plainTextBodyOf,
  readOnlyCampaignTarget,
  seedCampaignJobs,
  seedMessageFoundation,
  seedSyntheticGmail,
  seedSyntheticPacket,
  sessionGet,
  sessionPost,
  testEnv,
  timestamp,
} from "./support/model";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("campaign lifecycle", () => {
  it("holds an unanalyzed listing and admits it after authoritative facts arrive", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "campaign-rematch@example.test"
    );
    const job = JobImportSchema.parse({
      applyEmail: "campaign-rematch-target@example.test",
      applyUrl: "https://example.test/campaign-rematch-target",
      company: "Rematch School",
      country: "Hungary",
      description: "A posted full-time English teaching role for adults.",
      id: "campaign-rematch-job",
      title: "English teacher",
    });
    await importJobs(testEnv, userId, [job]);
    const created = await sessionPost("/api/campaigns", cookie, {
      countryCodes: ["HU"],
      dailyPace: 1,
      firstFiveRequired: true,
      postedTargetPercent: 100,
      stopAfterHumanReplies: 1,
    });
    const payload = (await created.json()) as {
      campaign: { id: string };
    };
    await expect(
      readOnlyCampaignTarget(payload.campaign.id)
    ).resolves.toMatchObject({
      hold_reason: "Campaign matching result: Needs verification",
      match_label: "Needs verification",
      status: "held",
    });

    await seedStrongEnglishMatch(testEnv.DB, job.id, timestamp);
    await expect(
      refreshCampaignMatchesForJob(testEnv, job.id)
    ).resolves.toEqual([{ campaignId: payload.campaign.id, matched: 1 }]);
    const target = await readOnlyCampaignTarget(payload.campaign.id);
    expect(target).toMatchObject({
      hold_reason: "",
      match_label: "Strong match",
      status: "eligible",
    });
    const jobsResponse = await sessionGet("/api/jobs", cookie);
    const jobsPayload = (await jobsResponse.json()) as {
      matches: Record<string, { label: string; score: number }>;
      matchingEngineVersion: number;
    };
    expect(jobsPayload.matchingEngineVersion).toBe(1);
    expect(jobsPayload.matches[job.id]).toMatchObject({
      label: target?.match_label,
      score: target?.match_score,
    });
    expect(JSON.parse(String(target?.match_snapshot_json))).toMatchObject({
      fxUpdatedAt: "configured",
      matchingEngineVersion: 1,
    });
  });

  it("keeps delivery locked, schedules one configured day, sends synthetic MIME, and pauses on a human reply", async () => {
    const email = "campaign-lifecycle@example.test";
    const { cookie, userId } = await createAuthenticatedUser(email);
    await writeProfile(testEnv.DB, userId, {
      ...defaultProfile,
      citizenship: "United States",
      currentLocation: "Phoenix, Arizona",
      email,
      fullName: "Integration User",
      preferredName: "Integration",
    });
    await seedMessageFoundation(userId);
    await seedSyntheticPacket(userId);
    await seedCampaignJobs(userId);

    const created = await sessionPost("/api/campaigns", cookie, {
      countryCodes: ["PL"],
      dailyPace: 1,
      firstFiveRequired: false,
      postedTargetPercent: 100,
      stopAfterHumanReplies: 1,
    });
    const createdPayload = (await created.json()) as {
      campaign: { id: string };
    };
    const campaignId = createdPayload.campaign.id;
    const prepared = await sessionPost(
      `/api/campaigns/${campaignId}/actions`,
      cookie,
      { action: "begin_calibration", reason: "" }
    );
    expect(prepared.status).toBe(200);
    await expect(prepared.json()).resolves.toMatchObject({
      campaign: { counts: { remaining: 2 }, status: "ready" },
    });

    const locked = await sessionPost(
      `/api/campaigns/${campaignId}/actions`,
      cookie,
      { action: "start", reason: "" }
    );
    expect(locked.status).toBe(409);
    await expect(locked.json()).resolves.toMatchObject({
      message: expect.stringContaining("delivery is locked"),
      ok: false,
    });

    const authorized = await sessionPost(
      "/api/operator/delivery-authorization",
      cookie,
      {
        enabled: true,
        reason: "Campaign lifecycle integration test",
        scope: "campaigns",
      }
    );
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toMatchObject({
      authorization: { authorizedBy: userId, enabled: true },
      ok: true,
    });
    const started = await sessionPost(
      `/api/campaigns/${campaignId}/actions`,
      cookie,
      { action: "start", reason: "" }
    );
    expect(started.status).toBe(200);
    await expect(started.json()).resolves.toMatchObject({
      campaign: { status: "running" },
    });

    const planned = await planDueCampaignRuns(testEnv);
    expect(planned).toEqual([{ campaignId, planned: 1, status: "planned" }]);
    const dispatch = await testEnv.DB.prepare(
      `SELECT d.id,d.status,d.run_id,t.id target_id
         FROM campaign_dispatches d
         JOIN campaign_dispatch_targets dt ON dt.dispatch_id=d.id
         JOIN campaign_targets t ON t.id=dt.target_id
        WHERE d.campaign_id=?`
    )
      .bind(campaignId)
      .first<{
        id: string;
        run_id: string;
        status: string;
        target_id: string;
      }>();
    if (!dispatch) {
      throw new Error("The scheduled campaign dispatch was not created");
    }
    expect(dispatch.status).toBe("queued");

    const runnerToken = await pairAgent(cookie);
    const task = await claimTask(runnerToken);
    expect(task.taskType).toBe("application.message");
    const question = advertisedPositionQuestion(new Date(), "UTC");
    const exactMessage = `Hello,\n\nI have taught adult English learners and would be glad to discuss this role.\n\n${question}\n\nBest,\nIntegration User\nE: ${email}`;
    const completed = await agentPost(
      `/api/agent-tasks/${task.runId}/complete`,
      runnerToken,
      {
        leaseToken: task.leaseToken,
        output: {
          message: exactMessage,
          summary: "Used the candidate's adult teaching experience.",
        },
      }
    );
    expect(completed.status).toBe(200);
    expect(
      await testEnv.DB.prepare(
        "SELECT status,recipient FROM campaign_dispatches WHERE id=?"
      )
        .bind(dispatch.id)
        .first()
    ).toMatchObject({
      recipient: expect.stringMatching(CAMPAIGN_RECIPIENT_PATTERN),
      status: "ready",
    });

    await seedSyntheticGmail(userId, email);
    let capturedRaw = "";
    const gmailFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = String(input);
        if (url.endsWith("/users/me/profile")) {
          return Promise.resolve(
            Response.json({ emailAddress: email, historyId: "100" })
          );
        }
        if (url.endsWith("/users/me/drafts")) {
          const body = JSON.parse(String(init?.body)) as {
            message: { raw: string };
          };
          capturedRaw = body.message.raw;
          return Promise.resolve(
            Response.json({
              id: "campaign-draft",
              message: { id: "campaign-draft-message", threadId: "thread" },
            })
          );
        }
        if (url.endsWith("/users/me/drafts/send")) {
          return Promise.resolve(
            Response.json({
              id: "campaign-message",
              threadId: "campaign-thread",
            })
          );
        }
        if (url.includes("/users/me/messages/campaign-message")) {
          return Promise.resolve(
            Response.json({
              id: "campaign-message",
              labelIds: ["SENT"],
              threadId: "campaign-thread",
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
    try {
      await expect(
        deliverCampaignDispatchWithGmail(testEnv, userId, dispatch.id)
      ).resolves.toMatchObject({
        gmail_message_id: "campaign-message",
        gmail_thread_id: "campaign-thread",
        status: "sent",
      });
    } finally {
      gmailFetch.mockRestore();
    }
    expect(plainTextBodyOf(capturedRaw)).toBe(exactMessage);
    expect(
      await testEnv.DB.prepare(
        `SELECT c.status,c.human_reply_count,d.status dispatch_status,
                t.status target_status,r.status run_status,
                claim.status claim_status
           FROM campaigns c
           JOIN campaign_dispatches d ON d.campaign_id=c.id
           JOIN campaign_dispatch_targets dt ON dt.dispatch_id=d.id
           JOIN campaign_targets t ON t.id=dt.target_id
           JOIN campaign_runs r ON r.id=d.run_id
           JOIN outbound_recipient_claims claim
             ON claim.source_kind='campaign_dispatch'
            AND claim.source_id=d.id
          WHERE c.id=?`
      )
        .bind(campaignId)
        .first()
    ).toEqual({
      claim_status: "sent",
      dispatch_status: "sent",
      human_reply_count: 0,
      run_status: "completed",
      status: "running",
      target_status: "sent",
    });

    await expect(
      recordCampaignReply(testEnv.DB, {
        campaignId,
        classification: "vacation",
        dispatchId: dispatch.id,
        evidence: { header: "Auto-Submitted: auto-replied" },
        gmailMessageId: "vacation-message",
        gmailThreadId: "campaign-thread",
        receivedAt: "2026-07-18T01:00:00.000Z",
      })
    ).resolves.toEqual({ counted: false, created: true });
    await expect(
      recordCampaignReply(testEnv.DB, {
        campaignId,
        classification: "human",
        dispatchId: dispatch.id,
        evidence: { from: "Hiring Team <hiring@example.test>" },
        gmailMessageId: "human-message",
        gmailThreadId: "campaign-thread",
        receivedAt: "2026-07-18T02:00:00.000Z",
      })
    ).resolves.toEqual({ counted: true, created: true });
    await expect(
      recordCampaignReply(testEnv.DB, {
        campaignId,
        classification: "human",
        dispatchId: dispatch.id,
        evidence: { from: "Hiring Team <hiring@example.test>" },
        gmailMessageId: "human-message",
        gmailThreadId: "campaign-thread",
        receivedAt: "2026-07-18T02:00:00.000Z",
      })
    ).resolves.toEqual({ counted: false, created: false });
    expect(
      await testEnv.DB.prepare(
        `SELECT status,human_reply_count,pause_reason
           FROM campaigns WHERE id=?`
      )
        .bind(campaignId)
        .first()
    ).toEqual({
      human_reply_count: 1,
      pause_reason: "Human reply threshold reached",
      status: "paused",
    });
  });
});
