import type { D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";

export interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

export const testEnv = env as TestEnv;

export function messageFor(question: string, body: string) {
  return `Hello,\n\n${body}\n\n${question}\n\nBest,\nIntegration User\nE: message-agent@example.test`;
}

export function aneslMessageFor(body: string) {
  return `Hello Mr. Yang,\n\n${body}\n\nWould you be open to talking about which of these positions and locations you are currently recruiting for?\n\nBest,\nIntegration User\nE: anesl-message-agent@example.test`;
}

export async function seedCompleteCorePacket(cookie: string, prefix: string) {
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

export async function seedMessageFoundation(userId: string, timestamp: string) {
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

export async function seedSentApplication(
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

export async function seedSyntheticGmail(
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

export function latestDraft(jobId: string, userId: string) {
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

export function latestBundleDraft(bundleId: string) {
  return testEnv.DB.prepare(
    `SELECT version,message,model_provider,model_id,revision_source
       FROM application_drafts
      WHERE application_bundle_id=?
      ORDER BY version DESC LIMIT 1`
  )
    .bind(bundleId)
    .first();
}

export async function seedAneslPosition(reference: string, timestamp: string) {
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
    runnerName: "Message agent",
  });
  const payload = (await exchange.json()) as { runner: { token: string } };
  return payload.runner.token;
}

export async function claimTask(token: string) {
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

export function completeTask(
  token: string,
  task: { leaseToken: string; runId: string },
  output: Record<string, unknown>
) {
  return agentPost(`/api/agent-tasks/${task.runId}/complete`, token, {
    leaseToken: task.leaseToken,
    output,
  });
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
