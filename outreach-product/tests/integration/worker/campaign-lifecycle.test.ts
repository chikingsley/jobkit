import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProfile } from "../../../src/features/profile/schema";
import { advertisedPositionQuestion } from "../../../worker/ai/application-message-policy";
import { writeProfile } from "../../../worker/repositories/user-settings";
import { JobImportSchema } from "../../../worker/schemas";
import { importJobs } from "../../../worker/services/application-drafts";
import { deliverCampaignDispatchWithGmail } from "../../../worker/services/campaign-email-attempts";
import { refreshCampaignMatchesForJob } from "../../../worker/services/campaign-matching";
import { recordCampaignReply } from "../../../worker/services/campaign-replies";
import { planDueCampaignRuns } from "../../../worker/services/campaign-scheduler";
import { createAuthenticatedUser } from "./auth";
import { seedStrongEnglishMatch } from "./campaign-match-fixtures";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
const timestamp = "2026-07-18T00:00:00.000Z";
const CAMPAIGN_RECIPIENT_PATTERN = /^campaign-target-[12]@example\.test$/u;

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
      refreshCampaignMatchesForJob(testEnv, userId, job.id)
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

    await enableSyntheticDelivery(userId);
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

  it("routes the five highest-ranked ANESL positions through one campaign dispatch", async () => {
    const { cookie, userId } = await createAuthenticatedUser(
      "campaign-anesl@example.test"
    );
    const jobs = await seedAneslCampaignJobs(userId);
    const created = await sessionPost("/api/campaigns", cookie, {
      countryCodes: ["CN"],
      dailyPace: 1,
      firstFiveRequired: false,
      postedTargetPercent: 100,
      stopAfterHumanReplies: 3,
    });
    expect(created.status).toBe(201);
    const createdPayload = (await created.json()) as {
      campaign: { id: string };
    };
    const campaignId = createdPayload.campaign.id;
    await testEnv.DB.batch(
      jobs.map((job, index) =>
        testEnv.DB.prepare(
          `UPDATE campaign_targets SET match_score=?
            WHERE campaign_id=? AND job_id=?`
        ).bind(index + 1, campaignId, job.id)
      )
    );

    const prepared = await sessionPost(
      `/api/campaigns/${campaignId}/actions`,
      cookie,
      { action: "begin_calibration", reason: "" }
    );
    expect(prepared.status).toBe(200);
    await enableSyntheticDelivery(userId);
    const started = await sessionPost(
      `/api/campaigns/${campaignId}/actions`,
      cookie,
      { action: "start", reason: "" }
    );
    expect(started.status).toBe(200);

    await expect(planDueCampaignRuns(testEnv)).resolves.toEqual([
      { campaignId, planned: 1, status: "planned" },
    ]);
    const dispatch = await testEnv.DB.prepare(
      `SELECT id,route_strategy,status
         FROM campaign_dispatches WHERE campaign_id=?`
    )
      .bind(campaignId)
      .first<{ id: string; route_strategy: string; status: string }>();
    expect(dispatch).toMatchObject({
      route_strategy: "anesl_bundle",
      status: "queued",
    });
    if (!dispatch) {
      throw new Error("The ANESL campaign dispatch was not created");
    }
    const selected = await testEnv.DB.prepare(
      `SELECT t.job_id
         FROM campaign_dispatch_targets dt
         JOIN campaign_targets t ON t.id=dt.target_id
        WHERE dt.dispatch_id=? ORDER BY dt.ordinal`
    )
      .bind(dispatch.id)
      .all<{ job_id: string }>();
    expect(selected.results.map((row) => row.job_id)).toEqual(
      jobs
        .slice(-5)
        .reverse()
        .map((job) => job.id)
    );
    const skipped = await testEnv.DB.prepare(
      `SELECT status,hold_reason,COUNT(*) count
         FROM campaign_targets
        WHERE campaign_id=? AND status='skipped'
        GROUP BY status,hold_reason`
    )
      .bind(campaignId)
      .first<{ count: number; hold_reason: string; status: string }>();
    expect(skipped).toEqual({
      count: 2,
      hold_reason:
        "Excluded from this ANESL email after selecting its five highest-ranked positions",
      status: "skipped",
    });
  });
});

function readOnlyCampaignTarget(campaignId: string) {
  return testEnv.DB.prepare(
    `SELECT status,hold_reason,match_label,match_score,match_snapshot_json
       FROM campaign_targets WHERE campaign_id=?`
  )
    .bind(campaignId)
    .first();
}

async function seedCampaignJobs(userId: string) {
  const jobs = [1, 2].map((index) =>
    JobImportSchema.parse({
      applyEmail: `campaign-target-${index}@example.test`,
      applyUrl: `https://example.test/campaign-target-${index}`,
      company: `Campaign School ${index}`,
      country: "Poland",
      description: "A posted full-time English teaching role for adults.",
      id: `campaign-lifecycle-job-${index}`,
      title: "English teacher",
    })
  );
  await importJobs(testEnv, userId, jobs);
  await Promise.all(
    jobs.map((job) => seedStrongEnglishMatch(testEnv.DB, job.id, timestamp))
  );
}

async function seedAneslCampaignJobs(userId: string) {
  const jobs = Array.from({ length: 7 }, (_, index) =>
    JobImportSchema.parse({
      applyEmail: "hr@anesl.com",
      applyUrl: `https://example.test/anesl/${index + 1}`,
      board: "anesl",
      company: "ANESL",
      country: "China",
      description: "A posted full-time English teaching role for adults.",
      id: `campaign-anesl-job-${index + 1}`,
      sourceReference: `ANESL-${index + 1}`,
      title: `English teacher ${index + 1}`,
    })
  );
  await importJobs(testEnv, userId, jobs);
  await Promise.all(
    jobs.map((job) => seedStrongEnglishMatch(testEnv.DB, job.id, timestamp))
  );
  return jobs;
}

function seedMessageFoundation(userId: string) {
  const template = "Hello,\n\n[profile-backed application message]";
  return testEnv.DB.prepare(
    `INSERT INTO user_message_foundations
      (id,user_id,version,name,status,voice_rules_json,templates_json,
       created_at,activated_at)
     VALUES (?,?,1,'Campaign fixture','active',?,?,?,?)`
  )
    .bind(
      `foundation:${userId}`,
      userId,
      JSON.stringify(["Use plain American English."]),
      JSON.stringify({
        advertised_long_general: template,
        advertised_long_young: template,
        advertised_short: template,
        multi_position: template,
        school_outreach_long: template,
        school_outreach_short: template,
      }),
      timestamp,
      timestamp
    )
    .run();
}

async function seedSyntheticPacket(userId: string) {
  const documents = ["resume", "degree", "tefl"].map((category) => ({
    category,
    contents: new TextEncoder().encode(`%PDF synthetic ${category}`),
    filename: `synthetic-${category}.pdf`,
    id: `document:${userId}:${category}`,
    objectKey: `users/${userId}/documents/synthetic-${category}.pdf`,
  }));
  await Promise.all(
    documents.map((document) =>
      testEnv.DOCUMENTS.put(document.objectKey, document.contents, {
        httpMetadata: { contentType: "application/pdf" },
      })
    )
  );
  await testEnv.DB.batch(
    documents.map((document) =>
      testEnv.DB.prepare(
        `INSERT INTO user_documents
          (id,user_id,category,filename,object_key,content_type,size_bytes,
           is_default,created_at)
         VALUES (?,?,?,?,?,'application/pdf',?,1,?)`
      ).bind(
        document.id,
        userId,
        document.category,
        document.filename,
        document.objectKey,
        document.contents.byteLength,
        timestamp
      )
    )
  );
}

function enableSyntheticDelivery(userId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO campaign_delivery_authorizations
      (user_id,enabled,authorized_scope,authorized_at,authorized_by,updated_at)
     VALUES (?,1,'campaigns',?,'integration-test',?)`
  )
    .bind(userId, timestamp, timestamp)
    .run();
}

function seedSyntheticGmail(userId: string, email: string) {
  return testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO user_accounts
        (id,account_id,provider_id,user_id,access_token,
         access_token_expires_at,scope,created_at,updated_at)
       VALUES (?,?, 'google', ?, 'synthetic-access-token', ?, ?, ?, ?)`
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

async function pairAgent(cookie: string) {
  const pairing = await sessionPost("/api/agent-runner-pairings", cookie, {
    capabilities: ["drafting"],
  });
  const pairingPayload = (await pairing.json()) as {
    pairing: { code: string };
  };
  const exchange = await publicPost("/api/agent-runner-pairings/exchange", {
    code: pairingPayload.pairing.code,
    codexVersion: "codex-cli test",
    runnerName: "Campaign runner",
  });
  const payload = (await exchange.json()) as { runner: { token: string } };
  return payload.runner.token;
}

async function claimTask(token: string) {
  const response = await agentPost("/api/agent-tasks/claim", token, {
    runnerVersion: "codex-cli test",
  });
  const payload = (await response.json()) as {
    task: { runId: string; taskType: string };
  };
  return payload.task;
}

function sessionPost(
  path: string,
  cookie: string,
  body: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie },
    method: "POST",
  });
}

function sessionGet(path: string, cookie: string) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    headers: { cookie },
  });
}

function publicPost(path: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function agentPost(path: string, token: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

function plainTextBodyOf(raw: string) {
  const padded = raw.replaceAll("-", "+").replaceAll("_", "/");
  const mime = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const marker = "Content-Transfer-Encoding: base64\r\n\r\n";
  const encoded = mime
    .slice(mime.indexOf(marker) + marker.length)
    .split("\r\n--jobkit-", 1)[0]
    ?.replaceAll("\r\n", "");
  if (!encoded) {
    throw new Error("Expected a base64 plain-text MIME part");
  }
  const bytes = Uint8Array.from(atob(encoded), (character) =>
    character.charCodeAt(0)
  );
  return new TextDecoder().decode(bytes);
}
