import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultProfile } from "../../../src/features/profile/schema";
import { advertisedPositionQuestion } from "../../../worker/ai/application-message-policy";
import { upsertJob, upsertUserJob } from "../../../worker/repositories/jobs";
import { writeProfile } from "../../../worker/repositories/user-settings";
import { JobImportSchema } from "../../../worker/schemas";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("Codex application message tasks", () => {
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
      taskType: "application.message",
      webSearch: "disabled",
    });
    const question = advertisedPositionQuestion(new Date(), "UTC");
    const firstMessage = messageFor(
      question,
      "I have taught adult English learners in classroom settings and would be glad to discuss this university position."
    );
    const completed = await completeTask(token, generation.runId, {
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
      taskType: "application.message",
    });
    const revisedMessage = messageFor(
      question,
      "I have taught adult English learners in classroom settings, including university review lectures, and would be glad to discuss this position."
    );
    await completeTask(token, revision.runId, {
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
    await completeTask(token, generation.runId, {
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
    await completeTask(token, revision.runId, {
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
});

function messageFor(question: string, body: string) {
  return `Hello,\n\n${body}\n\n${question}\n\nBest,\nIntegration User\nE: message-agent@example.test`;
}

function aneslMessageFor(body: string) {
  return `Hello Mr. Yang,\n\n${body}\n\nWould you be open to talking about which of these positions and locations you are currently recruiting for?\n\nBest,\nIntegration User\nE: anesl-message-agent@example.test`;
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

function latestDraft(jobId: string, userId: string) {
  return testEnv.DB.prepare(
    `SELECT d.version,d.message,d.model_provider,d.model_id,d.revision_source
       FROM application_drafts d
       JOIN user_jobs uj ON uj.id=d.user_job_id
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
      `INSERT INTO jobs
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
      runId: string;
      taskType: string;
      webSearch: string;
    };
  };
  return payload.task;
}

function completeTask(
  token: string,
  runId: string,
  output: Record<string, unknown>
) {
  return agentPost(`/api/agent-tasks/${runId}/complete`, token, { output });
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
