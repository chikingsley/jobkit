import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProfile } from "../../../src/features/profile/schema";
import { advertisedPositionQuestion } from "../../../worker/ai/application-message-policy";
import { writeAutomationPolicy } from "../../../worker/repositories/automation-policy";
import { upsertJob, upsertUserJob } from "../../../worker/repositories/jobs";
import { writeProfile } from "../../../worker/repositories/user-settings";
import { JobImportSchema } from "../../../worker/schemas";
import { importJobs } from "../../../worker/services/application-drafts";
import { queueDueFollowUps } from "../../../worker/services/followups";
import { createAuthenticatedUser } from "./auth";
import { seedStrongEnglishMatch } from "./campaign-match-fixtures";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));
afterEach(() => vi.restoreAllMocks());

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
      if (url.includes("/users/me/messages/follow-up-gmail-message")) {
        return Promise.resolve(
          Response.json({
            id: "follow-up-gmail-message",
            payload: {
              headers: [
                { name: "Message-ID", value: "<original@example.test>" },
              ],
            },
            threadId: "follow-up-thread",
          })
        );
      }
      if (url.includes("/users/me/messages/follow-up-sent-message")) {
        return Promise.resolve(
          Response.json({
            id: "follow-up-sent-message",
            labelIds: ["SENT"],
            threadId: "follow-up-thread",
          })
        );
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
      model: "gpt-5.6-luna",
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
      model_id: "gpt-5.6-luna",
      model_provider: "codex",
      revision_source: "generated",
    });

    const revisionQueued = await sessionPost(
      `/api/anesl/application-sets/${queuedPayload.applicationSet.id}/revise`,
      cookie,
      { instruction: "Ask which location is the strongest current match." }
    );
    expect(revisionQueued.status).toBe(202);
    const revision = await claimTask(token);
    expect(revision).toMatchObject({ model: "gpt-5.6-terra" });
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
      model_id: "gpt-5.6-terra",
      model_provider: "codex",
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

function messageFor(question: string, body: string) {
  return `Hello,\n\n${body}\n\n${question}\n\nBest,\nIntegration User\nE: message-agent@example.test`;
}

function aneslMessageFor(body: string) {
  return `Hello Mr. Yang,\n\n${body}\n\nWould you be open to talking about which of these positions and locations you are currently recruiting for?\n\nBest,\nIntegration User\nE: anesl-message-agent@example.test`;
}

async function seedCompleteCorePacket(cookie: string, prefix: string) {
  for (const category of ["resume", "degree", "tefl"]) {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);
    // biome-ignore lint/performance/noAwaitInLoops: Each upload rebuilds the packet from the preceding committed document state.
    const response = await exports.default.fetch(
      "https://outreach.test/api/documents",
      {
        body: bytes,
        headers: {
          "content-length": String(bytes.byteLength),
          "content-type": "application/pdf",
          cookie,
          "x-jobkit-category": category,
          "x-jobkit-filename": `${prefix}-${category}.pdf`,
        },
        method: "PUT",
      }
    );
    if (!response.ok) {
      throw new Error(`Core packet fixture upload failed (${response.status})`);
    }
  }
}

async function seedMessageFoundation(userId: string, timestamp: string) {
  const template = "Hello,\n\n[profile-backed application message]";
  await testEnv.DB.prepare(
    `INSERT INTO user_message_foundations
      (id,user_id,version,name,status,voice_rules_json,templates_json,
       created_at,activated_at)
     VALUES (?,?,1,'Test foundation','active',?,?,?,?)`
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

async function seedSentApplication(
  userId: string,
  jobId: string,
  timestamp: string
) {
  const userJobId = `user-job:${jobId}`;
  const draftId = `draft:${jobId}`;
  const routeId = `route:${jobId}`;
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_listings
        (id,board,title,company,country,location,description,source_url,
         apply_url,message_route,first_seen_at,updated_at)
       VALUES (?,'test','English instructor','Example University','Poland',
               'Warsaw','Adult English instructor role',?,? ,
               'advertised_position',?,?)`
    ).bind(
      jobId,
      `https://example.test/${jobId}`,
      `https://example.test/${jobId}`,
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
        (id,user_job_id,version,message,required_opening,status,created_at)
       VALUES (?,?,1,?,'Hello,','submitted',?)`
    ).bind(
      draftId,
      userJobId,
      "Hello,\n\nI have taught adult English learners and would be glad to discuss this role.\n\nWould you be free to speak about the role this week?\n\nBest,\nIntegration User\nE: follow-up-agent@example.test",
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO application_routes
        (id,job_id,kind,destination,source_evidence,last_verified_at,status,
         created_at,updated_at)
       VALUES (?,?,'email','school@example.test',?,?, 'active',?,?)`
    ).bind(
      routeId,
      jobId,
      `https://example.test/${jobId}`,
      timestamp,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO application_attempts
        (id,user_job_id,draft_id,route_id,channel,recipient,subject,status,
         gmail_message_id,gmail_thread_id,approved_at,sent_at,created_at,
         updated_at)
       VALUES (?,?,?,?,'email','school@example.test',?,'sent',
               'follow-up-gmail-message','follow-up-thread',?,?,?,?)`
    ).bind(
      `attempt:${jobId}`,
      userJobId,
      draftId,
      routeId,
      "English instructor application",
      timestamp,
      timestamp,
      timestamp,
      timestamp
    ),
  ]);
}

async function seedSyntheticGmail(
  userId: string,
  email: string,
  timestamp: string
) {
  await testEnv.DB.prepare(
    `INSERT INTO user_accounts
      (id,account_id,provider_id,user_id,access_token,
       access_token_expires_at,scope,created_at,updated_at)
     VALUES (?,?, 'google', ?, 'synthetic-access-token', ?, ?, ?, ?)`
  )
    .bind(
      `google:${userId}`,
      email,
      userId,
      "2099-01-01T00:00:00.000Z",
      "https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.readonly",
      timestamp,
      timestamp
    )
    .run();
}

function latestDraft(jobId: string, userId: string) {
  return testEnv.DB.prepare(
    `SELECT d.version,d.message,d.model_provider,d.model_id,d.revision_source
       FROM application_drafts d
       JOIN user_listing_states uj ON uj.id=d.user_job_id
      WHERE uj.user_id=? AND uj.job_id=?
      ORDER BY d.version DESC LIMIT 1`
  )
    .bind(userId, jobId)
    .first();
}

function latestBundleDraft(bundleId: string) {
  return testEnv.DB.prepare(
    `SELECT version,message,model_provider,model_id,revision_source
       FROM application_drafts
      WHERE application_bundle_id=?
      ORDER BY version DESC LIMIT 1`
  )
    .bind(bundleId)
    .first();
}

async function seedAneslPosition(reference: string, timestamp: string) {
  const contactId = "contact:anesl-message-agent";
  const channelId = "contact-channel:anesl-message-agent";
  const jobId = `anesl:${reference}`;
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO contacts
        (id,display_name,organization_name,role,status,created_at,updated_at)
       VALUES (?,'Mr. Corey Yang','ANESL','board_intermediary','active',?,?)`
    ).bind(contactId, timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO contact_channels
        (id,contact_id,kind,value,normalized_value,status,created_at,updated_at)
       VALUES (?,?,'email','hr@anesl.com','hr@anesl.com','active',?,?)`
    ).bind(channelId, contactId, timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO job_listings
        (id,board,title,company,country,location,description,source_url,
         apply_url,contact_name,source_reference,market_segments_json,
         message_route,opportunity_scope,first_seen_at,updated_at)
       VALUES (?,'anesl',?,'ANESL','China','China',?, ?, ?,
               'Mr. Corey Yang',?,'["school"]','multi_position',
               'multi_position',?,?)`
    ).bind(
      jobId,
      `English teacher ${reference}`,
      `ANESL position ${reference}`,
      `https://example.test/${reference}`,
      `https://example.test/${reference}`,
      reference,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO application_routes
        (id,job_id,kind,destination,contact_channel_id,source_evidence,
         last_verified_at,status,created_at,updated_at)
       VALUES (?,?,'email','hr@anesl.com',?,? ,?,'active',?,?)`
    ).bind(
      `route:${reference}`,
      jobId,
      channelId,
      `ANESL listing ${reference}`,
      timestamp,
      timestamp,
      timestamp
    ),
  ]);
  return jobId;
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
    runnerName: "Message agent",
  });
  const payload = (await exchange.json()) as { runner: { token: string } };
  return payload.runner.token;
}

async function claimTask(token: string) {
  const response = await agentPost("/api/agent-tasks/claim", token, {
    runnerVersion: "codex-cli test",
  });
  const payload = (await response.json()) as {
    task: {
      model: string;
      leaseToken: string;
      prompt: string;
      promptVersion: string;
      runId: string;
      taskType: string;
      webSearch: string;
    };
  };
  return payload.task;
}

function completeTask(
  token: string,
  task: { leaseToken: string; runId: string },
  output: Record<string, unknown>
) {
  return agentPost(`/api/agent-tasks/${task.runId}/complete`, token, {
    leaseToken: task.leaseToken,
    output,
  });
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
