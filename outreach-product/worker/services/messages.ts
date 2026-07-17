import type { AppEnv } from "../env";

// Outbound-only for phase one. Inbound replies (synced by the local Gmail
// bridge) will land keyed by gmail_thread_id and stitch into the same thread
// with no UI change. Statuses represent attempts that produced a real outbound
// message: sent, in-flight (sending), or send-attempted-but-unverified.
const THREAD_STATUSES = ["sent", "sending", "uncertain"] as const;
const ATTEMPT_THREAD_PREFIX = "attempt:";

export interface ThreadAttachmentView {
  category: string;
  contentType: string;
  filename: string;
  position: number;
  sizeBytes: number;
  url: string;
}

export interface ThreadMessageView {
  attachments: ThreadAttachmentView[];
  body: string;
  direction: "inbound" | "outbound";
  error: null | { detail: string; stage: string };
  from: string;
  gmailMessageId: string;
  id: string;
  sentAt: string;
  status: string;
  subject: string;
  to: string;
}

export interface MessageThreadSummary {
  attachmentCount: number;
  attemptId: string;
  company: string;
  country: string;
  jobId: string;
  lastActivityAt: string;
  location: string;
  messageCount: number;
  preview: string;
  recipient: string;
  sentAt: string;
  status: string;
  subject: string;
  threadId: string;
  title: string;
  unreadCount: number;
}

export interface MessageThreadDetail {
  company: string;
  gmailThreadId: string;
  jobId: string;
  messages: ThreadMessageView[];
  recipient: string;
  subject: string;
  threadId: string;
  title: string;
}

export class MessageThreadError extends Error {
  readonly status: 404 | 409;

  constructor(message: string, status: 404 | 409 = 404) {
    super(message);
    this.status = status;
  }
}

interface ThreadSummaryRow {
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
  status: string;
  subject: string;
  title: string;
  unread_count: number;
  updated_at: string;
}

interface InboundMessageRow {
  body_text: string;
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
  fromAddress: string;
  gmailMessageId: string;
  gmailThreadId: string;
  sentAt: string;
  subject: string;
  toAddress: string;
}

interface ThreadMessageRow {
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
  const rows = await db
    .prepare(
      `SELECT a.id,a.gmail_thread_id,a.recipient,a.subject,a.status,
              a.sent_at,a.updated_at,a.created_at,
              uj.job_id,j.title,j.company,j.country,j.location,d.message,
              (SELECT COUNT(*) FROM application_draft_attachments att
                WHERE att.draft_id=a.draft_id) attachment_count,
              COALESCE(tm.inbound_count,0) inbound_count,
              COALESCE(tm.unread_count,0) unread_count,
              COALESCE(tm.last_inbound_at,'') last_inbound_at,
              COALESCE(tm.last_inbound_body,'') last_inbound_body
         FROM application_attempts a
         JOIN user_jobs uj ON uj.id=a.user_job_id
         JOIN jobs j ON j.id=uj.job_id
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
    .all<ThreadSummaryRow>();
  return rows.results.map(toThreadSummary);
}

export async function getMessageThread(
  db: D1Database,
  userId: string,
  threadId: string
): Promise<MessageThreadDetail> {
  const attemptKey = threadId.startsWith(ATTEMPT_THREAD_PREFIX)
    ? threadId.slice(ATTEMPT_THREAD_PREFIX.length)
    : "";
  const gmailThreadKey = attemptKey ? "" : threadId;
  const rows = await db
    .prepare(
      `SELECT a.id,a.draft_id,a.recipient,a.subject,a.status,
              a.sent_at,a.updated_at,a.created_at,
              a.gmail_message_id,a.gmail_thread_id,a.error_stage,a.error_detail,
              d.message,u.email from_email,uj.job_id,j.title,j.company
         FROM application_attempts a
         JOIN user_jobs uj ON uj.id=a.user_job_id
         JOIN users u ON u.id=uj.user_id
         JOIN jobs j ON j.id=uj.job_id
         JOIN application_drafts d ON d.id=a.draft_id
        WHERE uj.user_id=? AND a.channel='email'
          AND ((?<>'' AND a.id=?) OR (?<>'' AND a.gmail_thread_id=?))
        ORDER BY a.created_at ASC`
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
                  subject,body_text,sent_at
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
  return {
    company: first.company,
    gmailThreadId: first.gmail_thread_id,
    jobId: first.job_id,
    messages,
    recipient: first.recipient,
    subject: first.subject,
    threadId,
    title: first.title,
  };
}

// Fail-closed: an inbound message is only accepted for a Gmail thread that one
// of the user's own sent application attempts created.
export async function recordInboundMessage(
  db: D1Database,
  userId: string,
  input: InboundMessageInput
): Promise<{ created: boolean }> {
  const attempt = await db
    .prepare(
      `SELECT a.id FROM application_attempts a
         JOIN user_jobs uj ON uj.id=a.user_job_id
        WHERE uj.user_id=? AND a.channel='email' AND a.gmail_thread_id=?
        LIMIT 1`
    )
    .bind(userId, input.gmailThreadId)
    .first<{ id: string }>();
  if (!attempt) {
    throw new MessageThreadError(
      "No sent application matches that Gmail thread"
    );
  }
  const result = await db
    .prepare(
      `INSERT INTO application_thread_messages
        (id,user_id,gmail_thread_id,gmail_message_id,direction,
         from_address,to_address,subject,body_text,sent_at,created_at)
       VALUES (?,?,?,?,'inbound',?,?,?,?,?,?)
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
      new Date().toISOString()
    )
    .run();
  return { created: (result.meta.changes ?? 0) === 1 };
}

export async function markThreadRead(
  db: D1Database,
  userId: string,
  threadId: string
): Promise<number> {
  let gmailThreadId = threadId;
  if (threadId.startsWith(ATTEMPT_THREAD_PREFIX)) {
    const row = await db
      .prepare(
        `SELECT a.gmail_thread_id FROM application_attempts a
           JOIN user_jobs uj ON uj.id=a.user_job_id
          WHERE uj.user_id=? AND a.id=?`
      )
      .bind(userId, threadId.slice(ATTEMPT_THREAD_PREFIX.length))
      .first<{ gmail_thread_id: string }>();
    gmailThreadId = row?.gmail_thread_id ?? "";
  }
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

export async function getThreadAttachment(
  env: AppEnv,
  userId: string,
  attemptId: string,
  position: number
): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT att.filename,att.content_type,att.object_key,att.r2_version,att.etag
       FROM application_draft_attachments att
       JOIN application_attempts a ON a.draft_id=att.draft_id
       JOIN user_jobs uj ON uj.id=a.user_job_id
      WHERE a.id=? AND att.position=? AND uj.user_id=?`
  )
    .bind(attemptId, position, userId)
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
): Promise<Map<string, ThreadAttachmentView[]>> {
  const byAttempt = new Map<string, ThreadAttachmentView[]>();
  if (attemptIds.length === 0) {
    return byAttempt;
  }
  const placeholders = attemptIds.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT a.id attempt_id,att.position,att.filename,att.content_type,
              att.size_bytes,att.category
         FROM application_attempts a
         JOIN user_jobs uj ON uj.id=a.user_job_id
         JOIN application_draft_attachments att ON att.draft_id=a.draft_id
        WHERE uj.user_id=? AND a.id IN (${placeholders})
        ORDER BY att.position`
    )
    .bind(userId, ...attemptIds)
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
  const gmailThreadId = row.gmail_thread_id;
  return {
    attachmentCount: row.attachment_count,
    attemptId: row.id,
    company: row.company,
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
    threadId: gmailThreadId
      ? gmailThreadId
      : `${ATTEMPT_THREAD_PREFIX}${row.id}`,
    title: row.title,
    unreadCount: row.unread_count,
  };
}

function toInboundThreadMessage(row: InboundMessageRow): ThreadMessageView {
  return {
    attachments: [],
    body: row.body_text,
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
  attachments: ThreadAttachmentView[]
): ThreadMessageView {
  return {
    attachments,
    body: row.message,
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
      .split(/\r?\n/)
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
