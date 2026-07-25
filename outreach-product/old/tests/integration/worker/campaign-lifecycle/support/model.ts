import type { D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { JobImportSchema } from "../../../../../worker/schemas";
import { importJobs } from "../../../../../worker/services/application-drafts";
import { seedStrongEnglishMatch } from "../.././campaign-match-fixtures";

export interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

export const testEnv = env as TestEnv;

export const timestamp = "2026-07-18T00:00:00.000Z";

export const CAMPAIGN_RECIPIENT_PATTERN =
  /^campaign-target-[12]@example\.test$/u;

export function readOnlyCampaignTarget(campaignId: string) {
  return testEnv.DB.prepare(
    `SELECT status,hold_reason,match_label,match_score,match_snapshot_json
       FROM campaign_targets WHERE campaign_id=?`
  )
    .bind(campaignId)
    .first();
}

export async function seedCampaignJobs(userId: string) {
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

export async function seedAneslCampaignJobs(userId: string) {
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

export function seedMessageFoundation(userId: string) {
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

export async function seedSyntheticPacket(userId: string) {
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

export function enableSyntheticDelivery(userId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO campaign_delivery_authorizations
      (user_id,enabled,authorized_scope,authorized_at,authorized_by,updated_at)
     VALUES (?,1,'campaigns',?,'integration-test',?)`
  )
    .bind(userId, timestamp, timestamp)
    .run();
}

export function seedSyntheticGmail(userId: string, email: string) {
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

export async function pairAgent(cookie: string) {
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

export async function claimTask(token: string) {
  const response = await agentPost("/api/agent-tasks/claim", token, {
    runnerVersion: "codex-cli test",
  });
  const payload = (await response.json()) as {
    task: { leaseToken: string; runId: string; taskType: string };
  };
  return payload.task;
}

export function sessionPost(
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

export function sessionGet(path: string, cookie: string) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    headers: { cookie },
  });
}

export function publicPost(path: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export function agentPost(
  path: string,
  token: string,
  body: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

export function plainTextBodyOf(raw: string) {
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
