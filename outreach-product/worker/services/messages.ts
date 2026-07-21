import type {
  MessageThreadDetail,
  MessageThreadSummary,
  ThreadAttachment,
  ThreadMessage,
} from "../../src/features/messages/types";
import type { AppEnv } from "../env";
import type { CampaignReplyClassification } from "./campaign-replies";
import { listThreadFollowUps } from "./followups";

// Hosted Gmail replies land keyed by gmail_thread_id and stitch into the same
// thread. Statuses represent attempts that produced a real outbound message:
// sent, in-flight (sending), or send-attempted-but-unverified.
const THREAD_STATUSES = ["sent", "sending", "uncertain"] as const;
const ATTEMPT_THREAD_PREFIX = "attempt:";
const CAMPAIGN_ATTEMPT_THREAD_PREFIX = "campaign-attempt:";
const LINE_BREAK_PATTERN = /\r?\n/u;

export class MessageThreadError extends Error {
  readonly status: 404 | 409;

  constructor(message: string, status: 404 | 409 = 404) {
    super(message);
    this.status = status;
  }
}

interface ThreadSummaryRow {
  application_bundle_id: string | null;
  attachment_count: number;
  company: string;
  country: string;
  created_at: string;
  gmail_thread_id: string;
  id: string;
  inbound_count: number;
  job_id: string;
  last_inbound_at: string;
  last_inbound_body: string;
  location: string;
  message: string;
  recipient: string;
  sent_at: null | string;
  source_kind: "application" | "campaign";
  status: string;
  subject: string;
  target_count: number;
  target_references_json: string;
  title: string;
  unread_count: number;
  updated_at: string;
}

interface InboundMessageRow {
  body_text: string;
  classification: CampaignReplyClassification;
  direction: "inbound" | "outbound";
  from_address: string;
  gmail_message_id: string;
  id: string;
  sent_at: string;
  subject: string;
  to_address: string;
}

export interface InboundMessageInput {
  bodyText: string;
  classification?: CampaignReplyClassification;
  fromAddress: string;
  gmailMessageId: string;
  gmailThreadId: string;
  sentAt: string;
  subject: string;
  testSendId?: string;
  toAddress: string;
}

export type MessageThreadOutcome = NonNullable<
  MessageThreadDetail["outcome"]
>["value"];

interface ThreadMessageRow {
  application_bundle_id: string | null;
  company: string;
  created_at: string;
  draft_id: string;
  error_detail: string;
  error_stage: string;
  from_email: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  id: string;
  job_id: string;
  message: string;
  recipient: string;
  sent_at: null | string;
  status: string;
  subject: string;
  title: string;
  updated_at: string;
}

interface BundleTargetRow {
  job_id: string;
  location: string;
  source_reference: string;
  title: string;
}

interface AttachmentRow {
  attempt_id: string;
  category: string;
  content_type: string;
  filename: string;
  position: number;
  size_bytes: number;
}

interface AttachmentObjectRow {
  content_type: string;
  etag: string;
  filename: string;
  object_key: string;
  r2_version: string;
}

export async function listMessageThreads(
  db: D1Database,
  userId: string
): Promise<MessageThreadSummary[]> {
  const placeholders = THREAD_STATUSES.map((_, i) => `?${i + 2}`).join(",");
  const [applications, campaigns] = await Promise.all([
    db
      .prepare(
        `SELECT a.id,a.application_bundle_id,a.gmail_thread_id,a.recipient,
              a.subject,a.status,'application' source_kind,
              a.sent_at,a.updated_at,a.created_at,
              uj.job_id,j.title,j.company,j.country,j.location,d.message,
              CASE WHEN a.application_bundle_id IS NULL THEN 1 ELSE (
                SELECT COUNT(*) FROM application_bundle_targets bt
                 WHERE bt.bundle_id=a.application_bundle_id
              ) END target_count,
              CASE WHEN a.application_bundle_id IS NULL THEN '[]' ELSE (
                SELECT json_group_array(bt.source_reference)
                  FROM application_bundle_targets bt
                 WHERE bt.bundle_id=a.application_bundle_id
                 ORDER BY bt.ordinal
              ) END target_references_json,
              (SELECT COUNT(*) FROM application_draft_attachments att
                WHERE att.draft_id=a.draft_id) attachment_count,
              COALESCE(tm.inbound_count,0) inbound_count,
              COALESCE(tm.unread_count,0) unread_count,
              COALESCE(tm.last_inbound_at,'') last_inbound_at,
              COALESCE(tm.last_inbound_body,'') last_inbound_body
         FROM application_attempts a
         JOIN user_listing_states uj ON uj.id=a.user_job_id
         JOIN job_listings j ON j.id=uj.job_id
         JOIN application_drafts d ON d.id=a.draft_id
         LEFT JOIN (
           SELECT t1.gmail_thread_id,
                  COUNT(*) inbound_count,
                  SUM(CASE WHEN t1.read_at IS NULL THEN 1 ELSE 0 END) unread_count,
                  MAX(t1.sent_at) last_inbound_at,
                  (SELECT t2.body_text FROM application_thread_messages t2
                    WHERE t2.user_id=t1.user_id
                      AND t2.gmail_thread_id=t1.gmail_thread_id
                    ORDER BY t2.sent_at DESC LIMIT 1) last_inbound_body
             FROM application_thread_messages t1
            WHERE t1.user_id=?1
            GROUP BY t1.gmail_thread_id
         ) tm ON a.gmail_thread_id<>'' AND tm.gmail_thread_id=a.gmail_thread_id
        WHERE uj.user_id=?1 AND a.channel='email'
          AND a.status IN (${placeholders})
        ORDER BY MAX(COALESCE(NULLIF(a.sent_at,''),a.updated_at),
                     COALESCE(tm.last_inbound_at,'')) DESC,
                 a.created_at DESC`
      )
      .bind(userId, ...THREAD_STATUSES)
      .all<ThreadSummaryRow>(),
    db
      .prepare(
        `SELECT a.id,NULL application_bundle_id,a.gmail_thread_id,a.recipient,
                a.subject,a.status,'campaign' source_kind,
                a.sent_at,a.updated_at,a.created_at,
                COALESCE(first_job.id,'') job_id,
                c.name title,
                COALESCE(first_job.company,first_organization.name,c.name) company,
                market.country_name country,
                COALESCE(first_job.location,first_organization.city,'') location,
                message.message,
                (SELECT COUNT(*) FROM campaign_dispatch_targets count_target
                  WHERE count_target.dispatch_id=d.id) target_count,
                COALESCE((
                  SELECT json_group_array(
                    COALESCE(target_job.source_reference,target_org.name)
                  )
                    FROM campaign_dispatch_targets refs
                    JOIN campaign_targets target ON target.id=refs.target_id
                    LEFT JOIN job_listings target_job ON target_job.id=target.job_id
                    LEFT JOIN organizations target_org
                      ON target_org.id=target.organization_id
                   WHERE refs.dispatch_id=d.id ORDER BY refs.ordinal
                ),'[]') target_references_json,
                (SELECT COUNT(*) FROM campaign_dispatch_attachments att
                  WHERE att.dispatch_id=d.id) attachment_count,
                COALESCE(tm.inbound_count,0) inbound_count,
                COALESCE(tm.unread_count,0) unread_count,
                COALESCE(tm.last_inbound_at,'') last_inbound_at,
                COALESCE(tm.last_inbound_body,'') last_inbound_body
           FROM campaign_email_attempts a
           JOIN campaign_dispatches d ON d.id=a.dispatch_id
           JOIN campaigns c ON c.id=d.campaign_id
           JOIN campaign_dispatch_targets first_dispatch_target
             ON first_dispatch_target.dispatch_id=d.id
            AND first_dispatch_target.ordinal=0
           JOIN campaign_targets first_target
             ON first_target.id=first_dispatch_target.target_id
           JOIN campaign_markets market
             ON market.campaign_id=c.id
            AND market.country_code=first_target.country_code
           LEFT JOIN job_listings first_job ON first_job.id=first_target.job_id
           LEFT JOIN organizations first_organization
             ON first_organization.id=first_target.organization_id
           JOIN campaign_messages message ON message.dispatch_id=d.id
            AND message.status='sent'
           LEFT JOIN (
             SELECT t1.gmail_thread_id,
                    COUNT(*) inbound_count,
                    SUM(CASE WHEN t1.read_at IS NULL THEN 1 ELSE 0 END)
                      unread_count,
                    MAX(t1.sent_at) last_inbound_at,
                    (SELECT t2.body_text FROM application_thread_messages t2
                      WHERE t2.user_id=t1.user_id
                        AND t2.gmail_thread_id=t1.gmail_thread_id
                      ORDER BY t2.sent_at DESC LIMIT 1) last_inbound_body
               FROM application_thread_messages t1
              WHERE t1.user_id=?1
              GROUP BY t1.gmail_thread_id
           ) tm ON a.gmail_thread_id<>''
               AND tm.gmail_thread_id=a.gmail_thread_id
          WHERE c.user_id=?1 AND a.status IN (${placeholders})
            AND message.version=(
              SELECT MAX(latest.version) FROM campaign_messages latest
               WHERE latest.dispatch_id=d.id AND latest.status='sent'
            )
          ORDER BY MAX(COALESCE(NULLIF(a.sent_at,''),a.updated_at),
                       COALESCE(tm.last_inbound_at,'')) DESC,
                   a.created_at DESC`
      )
      .bind(userId, ...THREAD_STATUSES)
      .all<ThreadSummaryRow>(),
  ]);
  return [...applications.results, ...campaigns.results]
    .map(toThreadSummary)
    .sort((left, right) =>
      right.lastActivityAt.localeCompare(left.lastActivityAt)
    );
}

export async function getMessageThread(
  db: D1Database,
  userId: string,
  threadId: string
): Promise<MessageThreadDetail> {
  const campaignAttemptKey = threadId.startsWith(CAMPAIGN_ATTEMPT_THREAD_PREFIX)
    ? threadId.slice(CAMPAIGN_ATTEMPT_THREAD_PREFIX.length)
    : "";
  const attemptKey = threadId.startsWith(ATTEMPT_THREAD_PREFIX)
    ? threadId.slice(ATTEMPT_THREAD_PREFIX.length)
    : "";
  const gmailThreadKey = attemptKey || campaignAttemptKey ? "" : threadId;
  const rows = campaignAttemptKey
    ? { results: [] as ThreadMessageRow[] }
    : await db
        .prepare(
          `SELECT a.id,a.application_bundle_id,a.draft_id,a.recipient,a.subject,
                  a.status,a.sent_at,a.updated_at,a.created_at,
                  a.gmail_message_id,a.gmail_thread_id,a.error_stage,
                  a.error_detail,d.message,u.email from_email,uj.job_id,
                  j.title,j.company
             FROM application_attempts a
             JOIN user_listing_states uj ON uj.id=a.user_job_id
             JOIN users u ON u.id=uj.user_id
             JOIN job_listings j ON j.id=uj.job_id
             JOIN application_drafts d ON d.id=a.draft_id
            WHERE uj.user_id=? AND a.channel='email'
              AND ((?<>'' AND a.id=?) OR (?<>'' AND a.gmail_thread_id=?))
            ORDER BY a.created_at ASC`
        )
        .bind(userId, attemptKey, attemptKey, gmailThreadKey, gmailThreadKey)
        .all<ThreadMessageRow>();
  const [first] = rows.results;
  if (!first) {
    return getCampaignMessageThread(
      db,
      userId,
      threadId,
      campaignAttemptKey,
      gmailThreadKey
    );
  }
  const attachments = await loadThreadAttachments(
    db,
    userId,
    rows.results.map((row) => row.id)
  );
  const inbound = first.gmail_thread_id
    ? await db
        .prepare(
          `SELECT id,gmail_message_id,direction,from_address,to_address,
                  subject,body_text,sent_at,classification
             FROM application_thread_messages
            WHERE user_id=? AND gmail_thread_id=?
            ORDER BY sent_at ASC`
        )
        .bind(userId, first.gmail_thread_id)
        .all<InboundMessageRow>()
    : { results: [] as InboundMessageRow[] };
  const messages = [
    ...rows.results.map((row) =>
      toThreadMessage(row, attachments.get(row.id) ?? [])
    ),
    ...inbound.results.map(toInboundThreadMessage),
  ].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const applicationTargets = first.application_bundle_id
    ? await loadBundleTargets(db, first.application_bundle_id)
    : [];
  return {
    applicationTargets,
    company: applicationTargets.length > 0 ? "ANESL" : first.company,
    followUps: await listThreadFollowUps(db, userId, first.gmail_thread_id),
    gmailThreadId: first.gmail_thread_id,
    jobId: first.job_id,
    messages,
    outcome: await readThreadOutcome(db, userId, first.gmail_thread_id),
    recipient: first.recipient,
    subject: first.subject,
    threadId,
    title:
      applicationTargets.length > 0
        ? `${applicationTargets.length} ANESL positions`
        : first.title,
  };
}

async function getCampaignMessageThread(
  db: D1Database,
  userId: string,
  threadId: string,
  attemptKey: string,
  gmailThreadKey: string
): Promise<MessageThreadDetail> {
  const rows = await db
    .prepare(
      `SELECT a.id,NULL application_bundle_id,'' draft_id,a.recipient,a.subject,
              a.status,a.sent_at,a.updated_at,a.created_at,
              a.gmail_message_id,a.gmail_thread_id,a.error_stage,a.error_detail,
              message.message,u.email from_email,
              COALESCE(first_job.id,'') job_id,c.name title,
              COALESCE(first_job.company,first_organization.name,c.name) company
         FROM campaign_email_attempts a
         JOIN campaign_dispatches d ON d.id=a.dispatch_id
         JOIN campaigns c ON c.id=d.campaign_id
         JOIN users u ON u.id=c.user_id
         JOIN campaign_messages message ON message.dispatch_id=d.id
         JOIN campaign_dispatch_targets first_dispatch_target
           ON first_dispatch_target.dispatch_id=d.id
          AND first_dispatch_target.ordinal=0
         JOIN campaign_targets first_target
           ON first_target.id=first_dispatch_target.target_id
         LEFT JOIN job_listings first_job ON first_job.id=first_target.job_id
         LEFT JOIN organizations first_organization
           ON first_organization.id=first_target.organization_id
        WHERE c.user_id=?
          AND ((?<>'' AND a.id=?) OR (?<>'' AND a.gmail_thread_id=?))
          AND message.status='sent'
          AND message.version=(
            SELECT MAX(latest.version) FROM campaign_messages latest
             WHERE latest.dispatch_id=d.id AND latest.status='sent'
          )
        ORDER BY a.created_at`
    )
    .bind(userId, attemptKey, attemptKey, gmailThreadKey, gmailThreadKey)
    .all<ThreadMessageRow>();
  const [first] = rows.results;
  if (!first) {
    throw new MessageThreadError("Message thread not found");
  }
  const attachments = await loadThreadAttachments(
    db,
    userId,
    rows.results.map((row) => row.id)
  );
  const inbound = first.gmail_thread_id
    ? await db
        .prepare(
          `SELECT id,gmail_message_id,direction,from_address,to_address,
                  subject,body_text,sent_at,classification
             FROM application_thread_messages
            WHERE user_id=? AND gmail_thread_id=?
            ORDER BY sent_at ASC`
        )
        .bind(userId, first.gmail_thread_id)
        .all<InboundMessageRow>()
    : { results: [] as InboundMessageRow[] };
  const messages = [
    ...rows.results.map((row) =>
      toThreadMessage(row, attachments.get(row.id) ?? [])
    ),
    ...inbound.results.map(toInboundThreadMessage),
  ].sort((left, right) => left.sentAt.localeCompare(right.sentAt));
  return {
    applicationTargets: await loadCampaignTargets(db, first.id),
    company: first.company,
    followUps: await listThreadFollowUps(db, userId, first.gmail_thread_id),
    gmailThreadId: first.gmail_thread_id,
    jobId: first.job_id,
    messages,
    outcome: await readThreadOutcome(db, userId, first.gmail_thread_id),
    recipient: first.recipient,
    subject: first.subject,
    threadId,
    title: first.title,
  };
}

async function loadCampaignTargets(db: D1Database, attemptId: string) {
  const rows = await db
    .prepare(
      `SELECT COALESCE(j.id,o.id) job_id,
              COALESCE(j.source_reference,o.name) source_reference,
              COALESCE(j.title,o.name) title,
              COALESCE(j.location,o.city,'') location
         FROM campaign_email_attempts attempt
         JOIN campaign_dispatch_targets dispatch_target
           ON dispatch_target.dispatch_id=attempt.dispatch_id
         JOIN campaign_targets target ON target.id=dispatch_target.target_id
         LEFT JOIN job_listings j ON j.id=target.job_id
         LEFT JOIN organizations o ON o.id=target.organization_id
        WHERE attempt.id=? ORDER BY dispatch_target.ordinal`
    )
    .bind(attemptId)
    .all<BundleTargetRow>();
  return rows.results.map((row) => ({
    jobId: row.job_id,
    location: row.location,
    sourceReference: row.source_reference,
    title: row.title,
  }));
}

async function loadBundleTargets(db: D1Database, bundleId: string) {
  const rows = await db
    .prepare(
      `SELECT uj.job_id,bt.source_reference,bt.title,bt.location
         FROM application_bundle_targets bt
         JOIN user_listing_states uj ON uj.id=bt.user_job_id
        WHERE bt.bundle_id=? ORDER BY bt.ordinal`
    )
    .bind(bundleId)
    .all<BundleTargetRow>();
  return rows.results.map((row) => ({
    jobId: row.job_id,
    location: row.location,
    sourceReference: row.source_reference,
    title: row.title,
  }));
}

// Fail closed: accept replies only when they match one of the user's real
// application threads or a recorded bundle test send. Test replies may have a
// mailbox-specific thread ID, so their durable authorization is the test-send
// record selected by Gmail reconciliation.
export async function recordInboundMessage(
  db: D1Database,
  userId: string,
  input: InboundMessageInput
): Promise<{ created: boolean }> {
  const trackedRoute = await db
    .prepare(
      `SELECT tracked.id FROM (
         SELECT a.id FROM application_attempts a
         JOIN user_listing_states uj ON uj.id=a.user_job_id
          WHERE uj.user_id=? AND a.channel='email' AND a.gmail_thread_id=?
         UNION ALL
         SELECT test_send.id FROM application_bundle_test_sends test_send
         JOIN application_bundles bundle ON bundle.id=test_send.bundle_id
          WHERE bundle.user_id=? AND test_send.id=? AND test_send.status='sent'
         UNION ALL
         SELECT campaign_attempt.id
           FROM campaign_email_attempts campaign_attempt
           JOIN campaign_dispatches dispatch
             ON dispatch.id=campaign_attempt.dispatch_id
           JOIN campaigns campaign ON campaign.id=dispatch.campaign_id
          WHERE campaign.user_id=?
            AND campaign_attempt.gmail_thread_id=?
            AND campaign_attempt.status IN ('sent','uncertain')
       ) tracked LIMIT 1`
    )
    .bind(
      userId,
      input.gmailThreadId,
      userId,
      input.testSendId ?? "",
      userId,
      input.gmailThreadId
    )
    .first<{ id: string }>();
  if (!trackedRoute) {
    throw new MessageThreadError(
      "No sent application matches that Gmail thread"
    );
  }
  const recordedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO application_thread_messages
        (id,user_id,gmail_thread_id,gmail_message_id,direction,
         from_address,to_address,subject,body_text,sent_at,created_at,
         classification)
       VALUES (?,?,?,?,'inbound',?,?,?,?,?,?,?)
       ON CONFLICT(user_id,gmail_message_id) DO NOTHING`
    )
    .bind(
      crypto.randomUUID(),
      userId,
      input.gmailThreadId,
      input.gmailMessageId,
      input.fromAddress,
      input.toAddress,
      input.subject,
      input.bodyText,
      input.sentAt,
      recordedAt,
      input.classification ?? "human"
    )
    .run();
  const replyClassification = input.classification ?? "human";
  if (replyClassification === "human" || replyClassification === "bounce") {
    await db
      .prepare(
        `UPDATE outreach_followups
            SET status='canceled',
                error_detail=?,
                updated_at=?
          WHERE user_id=? AND gmail_thread_id=?
            AND status IN ('scheduled','drafting','review','drafted')`
      )
      .bind(
        replyClassification === "bounce"
          ? "Canceled after Gmail recorded a bounce"
          : "Canceled after a human reply was recorded",
        recordedAt,
        userId,
        input.gmailThreadId
      )
      .run();
  }
  if (input.testSendId) {
    await db
      .prepare(
        `UPDATE application_bundle_test_sends
            SET reply_received_at=COALESCE(reply_received_at,?),updated_at=?
          WHERE id=?`
      )
      .bind(input.sentAt, new Date().toISOString(), input.testSendId)
      .run();
  }
  return { created: (result.meta.changes ?? 0) === 1 };
}

export async function markThreadRead(
  db: D1Database,
  userId: string,
  threadId: string
): Promise<number> {
  const gmailThreadId = await resolveOwnedGmailThreadId(db, userId, threadId);
  if (!gmailThreadId) {
    return 0;
  }
  const result = await db
    .prepare(
      `UPDATE application_thread_messages SET read_at=?
        WHERE user_id=? AND gmail_thread_id=? AND read_at IS NULL`
    )
    .bind(new Date().toISOString(), userId, gmailThreadId)
    .run();
  return result.meta.changes ?? 0;
}

export async function writeThreadOutcome(
  db: D1Database,
  userId: string,
  threadId: string,
  outcome: MessageThreadOutcome | null,
  note: string
) {
  const gmailThreadId = await resolveOwnedGmailThreadId(db, userId, threadId);
  if (!gmailThreadId) {
    throw new MessageThreadError(
      "A verified Gmail thread is required before recording an outcome",
      409
    );
  }
  if (!outcome) {
    await db
      .prepare(
        "DELETE FROM message_thread_outcomes WHERE user_id=? AND gmail_thread_id=?"
      )
      .bind(userId, gmailThreadId)
      .run();
    return null;
  }
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO message_thread_outcomes
        (id,user_id,gmail_thread_id,outcome,note,recorded_at,updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(user_id,gmail_thread_id) DO UPDATE SET
         outcome=excluded.outcome,note=excluded.note,
         recorded_at=excluded.recorded_at,updated_at=excluded.updated_at`
    )
    .bind(
      crypto.randomUUID(),
      userId,
      gmailThreadId,
      outcome,
      note.trim(),
      timestamp,
      timestamp
    )
    .run();
  return readThreadOutcome(db, userId, gmailThreadId);
}

async function readThreadOutcome(
  db: D1Database,
  userId: string,
  gmailThreadId: string
) {
  if (!gmailThreadId) {
    return null;
  }
  const row = await db
    .prepare(
      `SELECT outcome,note,recorded_at FROM message_thread_outcomes
        WHERE user_id=? AND gmail_thread_id=?`
    )
    .bind(userId, gmailThreadId)
    .first<{
      note: string;
      outcome: MessageThreadOutcome;
      recorded_at: string;
    }>();
  return row
    ? { note: row.note, recordedAt: row.recorded_at, value: row.outcome }
    : null;
}

async function resolveOwnedGmailThreadId(
  db: D1Database,
  userId: string,
  threadId: string
) {
  const applicationAttemptId = threadId.startsWith(ATTEMPT_THREAD_PREFIX)
    ? threadId.slice(ATTEMPT_THREAD_PREFIX.length)
    : "";
  const campaignAttemptId = threadId.startsWith(CAMPAIGN_ATTEMPT_THREAD_PREFIX)
    ? threadId.slice(CAMPAIGN_ATTEMPT_THREAD_PREFIX.length)
    : "";
  const gmailThreadId =
    applicationAttemptId || campaignAttemptId ? "" : threadId;
  const row = await db
    .prepare(
      `SELECT gmail_thread_id FROM (
        SELECT a.gmail_thread_id FROM application_attempts a
        JOIN user_listing_states uj ON uj.id=a.user_job_id
         WHERE uj.user_id=?
           AND ((?<>'' AND a.id=?) OR (?<>'' AND a.gmail_thread_id=?))
        UNION ALL
        SELECT attempt.gmail_thread_id FROM campaign_email_attempts attempt
        JOIN campaign_dispatches dispatch ON dispatch.id=attempt.dispatch_id
        JOIN campaigns campaign ON campaign.id=dispatch.campaign_id
         WHERE campaign.user_id=?
           AND ((?<>'' AND attempt.id=?) OR (?<>'' AND attempt.gmail_thread_id=?))
      ) owned WHERE gmail_thread_id<>'' LIMIT 1`
    )
    .bind(
      userId,
      applicationAttemptId,
      applicationAttemptId,
      gmailThreadId,
      gmailThreadId,
      userId,
      campaignAttemptId,
      campaignAttemptId,
      gmailThreadId,
      gmailThreadId
    )
    .first<{ gmail_thread_id: string }>();
  return row?.gmail_thread_id ?? "";
}

export async function getThreadAttachment(
  env: AppEnv,
  userId: string,
  attemptId: string,
  position: number
): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT attachment.filename,attachment.content_type,attachment.object_key,
            attachment.r2_version,attachment.etag
       FROM (
      SELECT att.filename,att.content_type,att.object_key,att.r2_version,att.etag
       FROM application_draft_attachments att
       JOIN application_attempts a ON a.draft_id=att.draft_id
       JOIN user_listing_states uj ON uj.id=a.user_job_id
      WHERE a.id=? AND att.position=? AND uj.user_id=?
      UNION ALL
      SELECT att.filename,att.content_type,att.object_key,att.r2_version,att.etag
        FROM campaign_dispatch_attachments att
        JOIN campaign_email_attempts attempt
          ON attempt.dispatch_id=att.dispatch_id
        JOIN campaign_dispatches dispatch ON dispatch.id=attempt.dispatch_id
        JOIN campaigns campaign ON campaign.id=dispatch.campaign_id
       WHERE attempt.id=? AND att.position=? AND campaign.user_id=?
       ) attachment LIMIT 1`
  )
    .bind(attemptId, position, userId, attemptId, position, userId)
    .first<AttachmentObjectRow>();
  if (!row) {
    throw new MessageThreadError("Attachment not found");
  }
  const object = await env.DOCUMENTS.get(row.object_key);
  if (!object?.body) {
    throw new MessageThreadError("Attachment data not found");
  }
  // Serve the as-sent snapshot only; refuse if the object changed since send.
  if (row.r2_version && object.version !== row.r2_version) {
    throw new MessageThreadError("Attachment changed since it was sent", 409);
  }
  return new Response(object.body, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `inline; filename="${safeFilename(row.filename)}"`,
      "content-type": row.content_type,
      etag: object.httpEtag,
    },
  });
}

async function loadThreadAttachments(
  db: D1Database,
  userId: string,
  attemptIds: string[]
): Promise<Map<string, ThreadAttachment[]>> {
  const byAttempt = new Map<string, ThreadAttachment[]>();
  if (attemptIds.length === 0) {
    return byAttempt;
  }
  const placeholders = attemptIds.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT * FROM (
       SELECT a.id attempt_id,att.position,att.filename,att.content_type,
              att.size_bytes,att.category
         FROM application_attempts a
         JOIN user_listing_states uj ON uj.id=a.user_job_id
         JOIN application_draft_attachments att ON att.draft_id=a.draft_id
        WHERE uj.user_id=? AND a.id IN (${placeholders})
       UNION ALL
       SELECT attempt.id attempt_id,att.position,att.filename,att.content_type,
              att.size_bytes,att.category
         FROM campaign_email_attempts attempt
         JOIN campaign_dispatches dispatch ON dispatch.id=attempt.dispatch_id
         JOIN campaigns campaign ON campaign.id=dispatch.campaign_id
         JOIN campaign_dispatch_attachments att
           ON att.dispatch_id=attempt.dispatch_id
        WHERE campaign.user_id=? AND attempt.id IN (${placeholders})
       ) ORDER BY attempt_id,position`
    )
    .bind(userId, ...attemptIds, userId, ...attemptIds)
    .all<AttachmentRow>();
  for (const row of rows.results) {
    const list = byAttempt.get(row.attempt_id) ?? [];
    list.push({
      category: row.category,
      contentType: row.content_type,
      filename: row.filename,
      position: row.position,
      sizeBytes: row.size_bytes,
      url: `/api/messages/attachments/${row.attempt_id}/${row.position}`,
    });
    byAttempt.set(row.attempt_id, list);
  }
  return byAttempt;
}

function toThreadSummary(row: ThreadSummaryRow): MessageThreadSummary {
  const outboundActivityAt = row.sent_at ? row.sent_at : row.updated_at;
  const replyIsLatest =
    row.last_inbound_at !== "" && row.last_inbound_at >= outboundActivityAt;
  return {
    attachmentCount: row.attachment_count,
    attemptId: row.id,
    company: row.application_bundle_id ? "ANESL" : row.company,
    country: row.country,
    jobId: row.job_id,
    lastActivityAt: replyIsLatest ? row.last_inbound_at : outboundActivityAt,
    location: row.location,
    messageCount: 1 + row.inbound_count,
    preview: previewOf(replyIsLatest ? row.last_inbound_body : row.message),
    recipient: row.recipient,
    sentAt: outboundActivityAt,
    status: row.status,
    subject: row.subject,
    targetCount: row.target_count,
    targetReferences: JSON.parse(row.target_references_json) as string[],
    threadId: threadIdForSummary(row),
    title: row.application_bundle_id
      ? `${row.target_count} ANESL positions`
      : row.title,
    unreadCount: row.unread_count,
  };
}

function threadIdForSummary(row: ThreadSummaryRow) {
  if (row.gmail_thread_id) {
    return row.gmail_thread_id;
  }
  const prefix =
    row.source_kind === "campaign"
      ? CAMPAIGN_ATTEMPT_THREAD_PREFIX
      : ATTEMPT_THREAD_PREFIX;
  return `${prefix}${row.id}`;
}

function toInboundThreadMessage(row: InboundMessageRow): ThreadMessage {
  return {
    attachments: [],
    body: row.body_text,
    classification: row.classification,
    direction: row.direction,
    error: null,
    from: row.from_address,
    gmailMessageId: row.gmail_message_id,
    id: row.id,
    sentAt: row.sent_at,
    status: "received",
    subject: row.subject,
    to: row.to_address,
  };
}

function toThreadMessage(
  row: ThreadMessageRow,
  attachments: ThreadAttachment[]
): ThreadMessage {
  return {
    attachments,
    body: row.message,
    classification: null,
    direction: "outbound",
    error: row.error_stage
      ? { detail: row.error_detail, stage: row.error_stage }
      : null,
    from: row.from_email,
    gmailMessageId: row.gmail_message_id,
    id: row.id,
    sentAt: row.sent_at ? row.sent_at : row.updated_at,
    status: row.status,
    subject: row.subject,
    to: row.recipient,
  };
}

function previewOf(message: string): string {
  const firstLine =
    message
      .split(LINE_BREAK_PATTERN)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  return firstLine.length > 160 ? `${firstLine.slice(0, 159)}…` : firstLine;
}

function safeFilename(value: string): string {
  return value
    .replace(/[^a-z0-9._ -]/gi, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}
