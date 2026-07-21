import {
  APPLICATION_MESSAGE_TASK_TYPE,
  type ApplicationMessageRequestInput,
  ApplicationMessageTaskOutputSchema,
} from "../../src/agent-tasks/application-message";
import {
  advertisedPositionQuestion,
  validateApplicationMessage,
} from "../ai/application-message-policy";
import { messageProfile, signatureFor } from "../ai/application-messages";
import type { AppEnv } from "../env";
import { readMessageStyleGuidance } from "../repositories/message-style";
import { readUserTimeZone } from "../repositories/user-time-zone";
import type { ApplicationMessageRoute } from "../schemas";
import { buildAgentTaskRequestCreation } from "./agent-task-requests";
import { savedProfile } from "./application-drafts";
import {
  createGmailDraft,
  getGmailMessage,
  getGmailProfile,
  sendGmailDraft,
} from "./gmail-api";
import { getGoogleAccessToken } from "./gmail-auth";
import {
  asGmailIntegrationError,
  GmailIntegrationError,
  gmailErrorMessage,
} from "./gmail-errors";
import { buildRawMimeMessage, gmailRaw } from "./gmail-message";

const MAX_FOLLOW_UP_WORDS = 120;
const NON_WORD_PATTERN = /[^\p{L}\p{N}]+/gu;
const REPLY_SUBJECT_PATTERN = /^re:/iu;

export type FollowUpTaskInput = Extract<
  ApplicationMessageRequestInput,
  { kind: "follow_up" }
>;

interface FollowUpCandidateRow {
  gmail_thread_id: string;
  sent_at: string;
  source_attempt_id: string;
  source_kind: "application" | "campaign";
  user_id: string;
}

interface LatestFollowUpRow {
  ordinal: number;
  sent_at: string | null;
  status: string;
}

interface FollowUpSourceRow extends Record<string, unknown> {
  company: string;
  country: string;
  created_at: string;
  from_email: string;
  gmail_draft_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  id: string;
  location: string;
  message: string;
  recipient: string;
  route: ApplicationMessageRoute;
  source_attempt_id: string;
  source_kind: "application" | "campaign";
  status: string;
  subject: string;
  title: string;
  user_id: string;
}

interface FoundationRow {
  voice_rules_json: string;
}

export interface FollowUpView {
  changeSummary: string;
  dueAt: string;
  gmailDraftId: string;
  id: string;
  message: string;
  ordinal: number;
  status: string;
}

export class FollowUpError extends Error {
  readonly status: 404 | 409 | 422;

  constructor(message: string, status: 404 | 409 | 422 = 409) {
    super(message);
    this.status = status;
  }
}

export async function queueDueFollowUps(env: AppEnv) {
  const candidates = await followUpCandidates(env.DB);
  let queued = 0;
  for (const candidate of candidates) {
    // D1 serializes each durable scheduling decision. Processing candidates in
    // order also makes the resulting audit trail stable across cron retries.
    // biome-ignore lint/performance/noAwaitInLoops: Each candidate is a separate transactional scheduling decision.
    const created = await queueDueCandidate(env.DB, candidate, new Date());
    queued += Number(created);
  }
  return { considered: candidates.length, queued };
}

export async function listThreadFollowUps(
  db: D1Database,
  userId: string,
  gmailThreadId: string
): Promise<FollowUpView[]> {
  if (!gmailThreadId) {
    return [];
  }
  const rows = await db
    .prepare(
      `SELECT id,ordinal,due_at,status,message,change_summary,gmail_draft_id
         FROM outreach_followups
        WHERE user_id=? AND gmail_thread_id=?
        ORDER BY ordinal`
    )
    .bind(userId, gmailThreadId)
    .all<{
      change_summary: string;
      due_at: string;
      gmail_draft_id: string;
      id: string;
      message: string;
      ordinal: number;
      status: string;
    }>();
  return rows.results.map((row) => ({
    changeSummary: row.change_summary,
    dueAt: row.due_at,
    gmailDraftId: row.gmail_draft_id,
    id: row.id,
    message: row.message,
    ordinal: row.ordinal,
    status: row.status,
  }));
}

export async function prepareFollowUpTask(
  env: AppEnv,
  userId: string,
  input: FollowUpTaskInput
) {
  const source = await readFollowUpSource(env.DB, userId, input.followUpId);
  if (source.status !== "scheduled") {
    throw new FollowUpError("Follow-up is no longer awaiting a draft");
  }
  const [profile, timeZone, styleGuidance, foundation] = await Promise.all([
    savedProfile(env.DB, userId),
    readUserTimeZone(env.DB, userId),
    readMessageStyleGuidance(env.DB, userId),
    env.DB.prepare(
      `SELECT voice_rules_json FROM user_message_foundations
          WHERE user_id=? AND status='active' LIMIT 1`
    )
      .bind(userId)
      .first<FoundationRow>(),
  ]);
  const requiredOpening = openingFrom(source.message);
  const requiredEnding = `Best,\n${signatureFor(profile)}`;
  const requiredQuestion = followUpQuestion(
    source.route,
    source.created_at,
    timeZone
  );
  return {
    input: {
      approvedTemplate: `${requiredOpening}\n\nI wanted to follow up on my earlier message about [the role or teaching opportunities]. [One short sentence that adds only useful, truthful context.]\n\n${requiredQuestion}\n\n${requiredEnding}`,
      candidateProfile: messageProfile(profile),
      currentMessage: source.message,
      job: {
        company: source.company,
        country: source.country,
        location: source.location,
        title: source.title,
      },
      messageRoute: source.route,
      questionGuidance:
        "Use the exact requiredQuestion. Invite a conversation without asking whether the employer is hiring.",
      request:
        "Write a brief in-thread follow-up to the prior sent message. Do not repeat the full application or add a new subject line.",
      requiredEnding,
      requiredOpening,
      requiredPositionReferences: [],
      requiredQuestion,
      styleGuidance: [
        ...voiceRules(foundation),
        ...styleGuidance,
        "Keep this follow-up under 120 words, including the signature.",
      ],
    },
    source,
  };
}

export async function buildFollowUpTaskCompletion(
  env: AppEnv,
  userId: string,
  input: FollowUpTaskInput,
  rawOutput: unknown,
  modelId: string
) {
  const prepared = await prepareFollowUpTask(env, userId, input);
  const output = ApplicationMessageTaskOutputSchema.parse(rawOutput);
  const message = validateApplicationMessage(
    output.message,
    prepared.input.requiredOpening,
    prepared.input.requiredEnding,
    prepared.source.route,
    prepared.input.requiredQuestion
  );
  const words = message.split(NON_WORD_PATTERN).filter(Boolean).length;
  if (words > MAX_FOLLOW_UP_WORDS) {
    throw new FollowUpError(
      `Follow-up must be at most ${MAX_FOLLOW_UP_WORDS} words; found ${words}`,
      422
    );
  }
  const timestamp = new Date().toISOString();
  return {
    result: {
      changeSummary: output.summary.trim(),
      followUpId: input.followUpId,
      message,
      modelId,
      provider: "codex" as const,
    },
    statements: [
      env.DB.prepare(
        `UPDATE outreach_followups
              SET status='review',message=?,change_summary=?,model_id=?,
                  error_detail='',updated_at=?
            WHERE id=? AND user_id=? AND status='scheduled'`
      ).bind(
        message,
        output.summary.trim(),
        modelId,
        timestamp,
        input.followUpId,
        userId
      ),
    ],
  };
}

export async function createFollowUpGmailDraft(
  env: AppEnv,
  userId: string,
  followUpId: string
) {
  const source = await readFollowUpSource(env.DB, userId, followUpId);
  if (source.status === "drafted") {
    return readFollowUp(env.DB, userId, followUpId);
  }
  if (source.status !== "review" || !source.message.trim()) {
    throw new FollowUpError("Follow-up is not ready to become a Gmail draft");
  }
  const accessToken = await getGoogleAccessToken(env, userId);
  const [profile, previous] = await Promise.all([
    getGmailProfile(accessToken),
    getGmailMessage(accessToken, source.gmail_message_id, "metadata"),
  ]);
  const messageId = gmailHeader(previous, "Message-ID");
  if (!messageId) {
    throw new GmailIntegrationError(
      "Gmail did not return the prior message ID needed for an in-thread draft",
      { status: 502 }
    );
  }
  const raw = gmailRaw(
    buildRawMimeMessage(
      {
        from: profile.emailAddress,
        subject: replySubject(source.subject),
        to: source.recipient,
      },
      source.message,
      [],
      undefined,
      { "In-Reply-To": messageId, References: messageId }
    )
  );
  const draft = await createGmailDraft(
    accessToken,
    raw,
    source.gmail_thread_id
  );
  if (!(draft.id && draft.message?.id)) {
    throw new GmailIntegrationError(
      "Gmail created a follow-up draft without returning its identifiers"
    );
  }
  const timestamp = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE outreach_followups
          SET status='drafted',gmail_draft_id=?,gmail_draft_message_id=?,
              drafted_at=?,updated_at=?
        WHERE id=? AND user_id=? AND status='review'`
  )
    .bind(draft.id, draft.message.id, timestamp, timestamp, followUpId, userId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new FollowUpError("Follow-up draft state changed during creation");
  }
  return readFollowUp(env.DB, userId, followUpId);
}

export async function sendFollowUpGmailDraft(
  env: AppEnv,
  userId: string,
  followUpId: string
) {
  const source = await readFollowUpSource(env.DB, userId, followUpId);
  if (source.status === "sent") {
    return readFollowUp(env.DB, userId, followUpId);
  }
  if (source.status !== "drafted" || !source.gmail_draft_id) {
    throw new FollowUpError("Follow-up does not have a Gmail draft to send");
  }
  const accessToken = await getGoogleAccessToken(env, userId);
  const sendingAt = new Date().toISOString();
  const reserved = await env.DB.prepare(
    `UPDATE outreach_followups
        SET status='sending',updated_at=?
      WHERE id=? AND user_id=? AND status='drafted' AND gmail_draft_id=?`
  )
    .bind(sendingAt, followUpId, userId, source.gmail_draft_id)
    .run();
  if ((reserved.meta.changes ?? 0) !== 1) {
    throw new FollowUpError("Follow-up send state changed concurrently");
  }

  let messageId = "";
  let sentFrom = source.from_email;
  let threadId = "";
  try {
    const sent = await sendGmailDraft(accessToken, source.gmail_draft_id);
    ({ id: messageId, threadId } = sent);
    if (!(messageId && threadId)) {
      throw new Error("Gmail send did not return follow-up identifiers");
    }
    const verified = await getGmailMessage(accessToken, messageId, "metadata");
    if (
      verified.id !== messageId ||
      verified.threadId !== source.gmail_thread_id ||
      threadId !== source.gmail_thread_id ||
      !verified.labelIds?.includes("SENT")
    ) {
      throw new Error(
        "Gmail could not verify the follow-up in the sent thread"
      );
    }
    sentFrom = gmailHeader(verified, "From") || sentFrom;
  } catch (error) {
    const timestamp = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE outreach_followups
          SET status='uncertain',gmail_message_id=?,error_detail=?,updated_at=?
        WHERE id=? AND user_id=? AND status='sending'`
    )
      .bind(messageId, gmailErrorMessage(error), timestamp, followUpId, userId)
      .run();
    throw asGmailIntegrationError(
      error,
      "Gmail follow-up send was invoked but could not be verified"
    );
  }

  const timestamp = new Date().toISOString();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE outreach_followups
            SET status='sent',gmail_message_id=?,sent_at=?,error_detail='',updated_at=?
          WHERE id=? AND user_id=? AND status='sending'`
      ).bind(messageId, timestamp, timestamp, followUpId, userId),
      env.DB.prepare(
        `INSERT INTO application_thread_messages
          (id,user_id,gmail_thread_id,gmail_message_id,direction,from_address,
           to_address,subject,body_text,sent_at,created_at,classification)
         VALUES (?,?,?,?,'outbound',?,?,?,?,?,?,'human')
         ON CONFLICT(user_id,gmail_message_id) DO NOTHING`
      ).bind(
        crypto.randomUUID(),
        userId,
        source.gmail_thread_id,
        messageId,
        sentFrom,
        source.recipient,
        replySubject(source.subject),
        source.message,
        timestamp,
        timestamp
      ),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1) {
      throw new Error("Follow-up sent state changed concurrently");
    }
  } catch (error) {
    await env.DB.prepare(
      `UPDATE outreach_followups
          SET status='uncertain',gmail_message_id=?,error_detail=?,updated_at=?
        WHERE id=? AND user_id=? AND status='sending'`
    )
      .bind(messageId, gmailErrorMessage(error), timestamp, followUpId, userId)
      .run();
    throw asGmailIntegrationError(
      error,
      "Gmail sent the follow-up but JobKit could not record it"
    );
  }
  return readFollowUp(env.DB, userId, followUpId);
}

export async function markFollowUpTaskFailed(
  db: D1Database,
  userId: string,
  followUpId: string,
  error: string
) {
  await db
    .prepare(
      `UPDATE outreach_followups
          SET status='failed',error_detail=?,updated_at=?
        WHERE id=? AND user_id=? AND status='scheduled'`
    )
    .bind(error.slice(0, 4000), new Date().toISOString(), followUpId, userId)
    .run();
}

async function followUpCandidates(db: D1Database) {
  const rows = await db
    .prepare(
      `SELECT source_kind,source_attempt_id,user_id,gmail_thread_id,sent_at
         FROM (
          SELECT 'application' source_kind,a.id source_attempt_id,uj.user_id,
                 a.gmail_thread_id,a.sent_at
            FROM application_attempts a
            JOIN user_listing_states uj ON uj.id=a.user_job_id
            JOIN user_automation_policies policy ON policy.user_id=uj.user_id
           WHERE a.status='sent' AND a.gmail_thread_id<>''
             AND policy.follow_up_delays_json<>'[]' AND policy.paused=0
          UNION ALL
          SELECT 'campaign' source_kind,a.id source_attempt_id,c.user_id,
                 a.gmail_thread_id,a.sent_at
            FROM campaign_email_attempts a
            JOIN campaign_dispatches dispatch ON dispatch.id=a.dispatch_id
            JOIN campaigns c ON c.id=dispatch.campaign_id
            JOIN user_automation_policies policy ON policy.user_id=c.user_id
           WHERE a.status='sent' AND a.gmail_thread_id<>''
             AND policy.follow_up_delays_json<>'[]' AND policy.paused=0
         ) sent
        WHERE NOT EXISTS (
          SELECT 1 FROM application_thread_messages reply
           WHERE reply.user_id=sent.user_id
             AND reply.gmail_thread_id=sent.gmail_thread_id
             AND reply.direction='inbound'
             AND reply.classification IN ('human','bounce')
        )
        ORDER BY sent_at,source_attempt_id`
    )
    .all<FollowUpCandidateRow>();
  return rows.results;
}

async function queueDueCandidate(
  db: D1Database,
  candidate: FollowUpCandidateRow,
  now: Date
) {
  const [policy, latest] = await Promise.all([
    db
      .prepare(
        "SELECT follow_up_delays_json FROM user_automation_policies WHERE user_id=?"
      )
      .bind(candidate.user_id)
      .first<{ follow_up_delays_json: string }>(),
    db
      .prepare(
        `SELECT ordinal,status,sent_at FROM outreach_followups
          WHERE user_id=? AND gmail_thread_id=?
          ORDER BY ordinal DESC LIMIT 1`
      )
      .bind(candidate.user_id, candidate.gmail_thread_id)
      .first<LatestFollowUpRow>(),
  ]);
  const delays = policy
    ? (JSON.parse(policy.follow_up_delays_json) as unknown)
    : [];
  if (!Array.isArray(delays)) {
    return false;
  }
  if (latest && latest.status !== "sent") {
    return false;
  }
  const ordinal = (latest?.ordinal ?? 0) + 1;
  const delay = Number(delays[ordinal - 1]);
  const baseAt = latest?.sent_at ?? candidate.sent_at;
  if (!(Number.isInteger(delay) && delay > 0 && baseAt)) {
    return false;
  }
  const dueAt = new Date(baseAt);
  if (Number.isNaN(dueAt.getTime())) {
    return false;
  }
  dueAt.setUTCDate(dueAt.getUTCDate() + delay);
  if (dueAt > now) {
    return false;
  }
  return insertFollowUpRequest(db, candidate, ordinal, delay, dueAt);
}

async function insertFollowUpRequest(
  db: D1Database,
  candidate: FollowUpCandidateRow,
  ordinal: number,
  delay: number,
  dueAt: Date
) {
  const followUpId = `follow-up:${candidate.source_kind}:${candidate.source_attempt_id}:${ordinal.toString()}`;
  const task = buildAgentTaskRequestCreation(db, {
    payload: { followUpId, kind: "follow_up", mode: "follow_up" },
    subjectId: followUpId,
    subjectType: "outreach_followup",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId: candidate.user_id,
  });
  const timestamp = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO outreach_followups
          (id,user_id,source_kind,source_attempt_id,gmail_thread_id,ordinal,
           delay_days,due_at,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,'scheduled',?,?)
         ON CONFLICT(user_id,gmail_thread_id,ordinal) DO NOTHING`
      )
      .bind(
        followUpId,
        candidate.user_id,
        candidate.source_kind,
        candidate.source_attempt_id,
        candidate.gmail_thread_id,
        ordinal,
        delay,
        dueAt.toISOString(),
        timestamp,
        timestamp
      ),
    db
      .prepare(
        `INSERT INTO agent_task_requests
          (id,user_id,task_type,subject_type,subject_id,input_json,status,
           created_at,updated_at)
         SELECT ?,?,?,?,?,?,'queued',?,?
          WHERE EXISTS (
            SELECT 1 FROM outreach_followups
             WHERE id=? AND user_id=? AND agent_task_request_id IS NULL
          )`
      )
      .bind(
        task.request.id,
        candidate.user_id,
        APPLICATION_MESSAGE_TASK_TYPE,
        "outreach_followup",
        followUpId,
        JSON.stringify({ followUpId, kind: "follow_up", mode: "follow_up" }),
        timestamp,
        timestamp,
        followUpId,
        candidate.user_id
      ),
    db
      .prepare(
        `UPDATE outreach_followups SET agent_task_request_id=?,updated_at=?
          WHERE id=? AND user_id=? AND agent_task_request_id IS NULL`
      )
      .bind(task.request.id, timestamp, followUpId, candidate.user_id),
  ]);
  return (results[0]?.meta.changes ?? 0) === 1;
}

async function readFollowUpSource(
  db: D1Database,
  userId: string,
  followUpId: string
) {
  const row = await db
    .prepare(
      `SELECT * FROM (
        SELECT f.id,f.user_id,f.source_kind,f.source_attempt_id,f.status,
               f.created_at,f.message,f.gmail_draft_id,a.gmail_thread_id,a.gmail_message_id,
               a.recipient,a.subject,d.message original_message,u.email from_email,
               j.title,j.company,j.country,j.location,j.message_route route
          FROM outreach_followups f
          JOIN application_attempts a ON a.id=f.source_attempt_id
          JOIN user_listing_states uj ON uj.id=a.user_job_id AND uj.user_id=f.user_id
          JOIN users u ON u.id=uj.user_id
          JOIN application_drafts d ON d.id=a.draft_id
          JOIN job_listings j ON j.id=uj.job_id
         WHERE f.source_kind='application'
        UNION ALL
        SELECT f.id,f.user_id,f.source_kind,f.source_attempt_id,f.status,
               f.created_at,f.message,f.gmail_draft_id,a.gmail_thread_id,a.gmail_message_id,
               a.recipient,a.subject,message.message original_message,u.email from_email,
               c.name title,
               COALESCE(j.company,o.name,c.name) company,
               market.country_name country,
               COALESCE(j.location,o.city,'') location,
               CASE
                 WHEN dispatch.route_strategy='anesl_bundle' THEN 'multi_position'
                 WHEN target.subject_kind='organization' THEN 'school_outreach'
                 ELSE COALESCE(j.message_route,'advertised_position')
               END route
          FROM outreach_followups f
          JOIN campaign_email_attempts a ON a.id=f.source_attempt_id
          JOIN campaign_dispatches dispatch ON dispatch.id=a.dispatch_id
          JOIN campaigns c ON c.id=dispatch.campaign_id AND c.user_id=f.user_id
          JOIN users u ON u.id=c.user_id
          JOIN campaign_messages message ON message.dispatch_id=dispatch.id
            AND message.status='sent'
          JOIN campaign_dispatch_targets dispatch_target
            ON dispatch_target.dispatch_id=dispatch.id
           AND dispatch_target.ordinal=0
          JOIN campaign_targets target ON target.id=dispatch_target.target_id
          JOIN campaign_markets market ON market.campaign_id=c.id
           AND market.country_code=target.country_code
          LEFT JOIN job_listings j ON j.id=target.job_id
          LEFT JOIN organizations o ON o.id=target.organization_id
         WHERE f.source_kind='campaign'
           AND message.version=(
             SELECT MAX(latest.version) FROM campaign_messages latest
              WHERE latest.dispatch_id=dispatch.id AND latest.status='sent'
           )
      ) source
      WHERE id=? AND user_id=? LIMIT 1`
    )
    .bind(followUpId, userId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new FollowUpError("Follow-up not found", 404);
  }
  return {
    company: String(row.company),
    country: String(row.country),
    created_at: String(row.created_at),
    from_email: String(row.from_email),
    gmail_draft_id: String(row.gmail_draft_id),
    gmail_message_id: String(row.gmail_message_id),
    gmail_thread_id: String(row.gmail_thread_id),
    id: String(row.id),
    location: String(row.location),
    message: String(row.message || row.original_message),
    recipient: String(row.recipient),
    route: String(row.route) as ApplicationMessageRoute,
    source_attempt_id: String(row.source_attempt_id),
    source_kind: String(row.source_kind) as "application" | "campaign",
    status: String(row.status),
    subject: String(row.subject),
    title: String(row.title),
    user_id: String(row.user_id),
  } satisfies FollowUpSourceRow;
}

async function readFollowUp(
  db: D1Database,
  userId: string,
  followUpId: string
) {
  const row = await db
    .prepare(
      `SELECT id,ordinal,due_at,status,message,change_summary,gmail_draft_id
         FROM outreach_followups WHERE id=? AND user_id=?`
    )
    .bind(followUpId, userId)
    .first<{
      change_summary: string;
      due_at: string;
      gmail_draft_id: string;
      id: string;
      message: string;
      ordinal: number;
      status: string;
    }>();
  if (!row) {
    throw new FollowUpError("Follow-up not found", 404);
  }
  return {
    changeSummary: row.change_summary,
    dueAt: row.due_at,
    gmailDraftId: row.gmail_draft_id,
    id: row.id,
    message: row.message,
    ordinal: row.ordinal,
    status: row.status,
  } satisfies FollowUpView;
}

function openingFrom(message: string) {
  const [firstLine] = message.replaceAll("\r\n", "\n").trim().split("\n");
  return firstLine?.startsWith("Hello") ? firstLine : "Hello,";
}

function followUpQuestion(
  route: ApplicationMessageRoute,
  createdAt: string,
  timeZone: string
) {
  if (route === "multi_position") {
    return "Which locations and student groups are you currently recruiting for?";
  }
  if (route === "school_outreach") {
    return "Would you be open to speaking about whether there could be a position that fits my background?";
  }
  return advertisedPositionQuestion(new Date(createdAt), timeZone);
}

function voiceRules(row: FoundationRow | null) {
  if (!row) {
    return [];
  }
  const parsed = JSON.parse(row.voice_rules_json) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((rule): rule is string => typeof rule === "string")
    : [];
}

function gmailHeader(
  message: Awaited<ReturnType<typeof getGmailMessage>>,
  name: string
) {
  return message.payload?.headers?.find(
    (header) => header.name.toLowerCase() === name.toLowerCase()
  )?.value;
}

function replySubject(subject: string) {
  return REPLY_SUBJECT_PATTERN.test(subject.trim())
    ? subject.trim()
    : `Re: ${subject.trim()}`;
}
