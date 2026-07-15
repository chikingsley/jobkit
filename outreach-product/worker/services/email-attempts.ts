import type { AppEnv } from "../env";
import { jobEventStatement } from "../repositories/job-events";
import { buildGmailMessagePayload } from "./gmail-message";

export type EmailAttemptStatus =
  | "approved"
  | "claimed"
  | "drafted"
  | "failed"
  | "sending"
  | "sent"
  | "uncertain";

interface AttemptSourceRow {
  country: string;
  draft_id: string;
  draft_status: string;
  from_email: string;
  job_status: string;
  location: string;
  recipient: string;
  route_id: string;
  route_kind: string;
  route_status: string;
  title: string;
  user_job_id: string;
}

interface AttemptRow {
  attachment_count?: number;
  company: string;
  created_at: string;
  draft_id: string;
  error_detail: string;
  error_stage: string;
  gmail_draft_id: string;
  gmail_draft_message_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  id: string;
  job_id: string;
  recipient: string;
  route_id: string;
  status: EmailAttemptStatus;
  subject: string;
  title: string;
  updated_at: string;
  user_job_id: string;
}

interface OwnedAttemptRow extends AttemptRow {
  from_email: string;
}

export interface EmailAttemptView {
  attemptId: string;
  company: string;
  createdAt: string;
  draftId: string;
  error: null | { detail: string; stage: string };
  gmailDraftId: string;
  gmailDraftMessageId: string;
  gmailMessageId: string;
  gmailThreadId: string;
  jobId: string;
  recipient: string;
  routeId: string;
  status: EmailAttemptStatus;
  subject: string;
  title: string;
  updatedAt: string;
}

export class EmailAttemptError extends Error {
  readonly status: 400 | 404 | 409 | 422;

  constructor(message: string, status: 400 | 404 | 409 | 422) {
    super(message);
    this.status = status;
  }
}

export async function createApprovedEmailAttempt(
  env: AppEnv,
  userId: string,
  jobId: string,
  draftId: string,
  routeId: string
): Promise<EmailAttemptView> {
  const source = await env.DB.prepare(
    `SELECT uj.id user_job_id,uj.status job_status,
            d.id draft_id,d.status draft_status,
            ar.id route_id,ar.kind route_kind,ar.destination recipient,
            ar.status route_status,j.title,j.location,j.country,u.email from_email
       FROM user_jobs uj
       JOIN users u ON u.id=uj.user_id
       JOIN jobs j ON j.id=uj.job_id
       JOIN application_drafts d ON d.user_job_id=uj.id
       JOIN application_routes ar ON ar.job_id=j.id
      WHERE uj.user_id=? AND j.id=? AND d.id=? AND ar.id=?
        AND d.id=(
          SELECT id FROM application_drafts
          WHERE user_job_id=uj.id ORDER BY version DESC LIMIT 1
        )`
  )
    .bind(userId, jobId, draftId, routeId)
    .first<AttemptSourceRow>();
  if (!source) {
    throw new EmailAttemptError(
      "The selected job, draft, or application route is no longer current",
      404
    );
  }
  if (source.route_kind !== "email" || source.route_status !== "active") {
    throw new EmailAttemptError("The selected email route is not active", 409);
  }
  if (
    !new Set(["new", "review", "approved", "failed"]).has(source.job_status)
  ) {
    throw new EmailAttemptError("The job is not ready for email approval", 409);
  }
  if (!new Set(["draft", "approved"]).has(source.draft_status)) {
    throw new EmailAttemptError("The selected draft is not approvable", 409);
  }

  const timestamp = new Date().toISOString();
  const attemptId = crypto.randomUUID();
  const subject = applicationSubject(
    source.title,
    source.location,
    source.country
  );
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE user_jobs
          SET status='approved',updated_at=?
        WHERE id=? AND user_id=? AND status IN ('new','review','approved','failed')`
    ).bind(timestamp, source.user_job_id, userId),
    env.DB.prepare(
      `UPDATE application_drafts
          SET status='approved',approved_at=COALESCE(approved_at,?)
        WHERE id=? AND status IN ('draft','approved')`
    ).bind(timestamp, draftId),
    env.DB.prepare(
      `INSERT INTO application_attempts
        (id,user_job_id,draft_id,route_id,channel,recipient,subject,status,
         approved_at,created_at,updated_at)
       VALUES (?,?,?,?,'email',?,?,'approved',?,?,?)
       ON CONFLICT(user_job_id,draft_id,route_id) DO UPDATE SET
         status='approved',payload_sha256='',claimed_at=NULL,
         error_stage='',error_detail='',approved_at=excluded.approved_at,
         updated_at=excluded.updated_at
       WHERE application_attempts.status='failed'`
    ).bind(
      attemptId,
      source.user_job_id,
      draftId,
      routeId,
      source.recipient,
      subject,
      timestamp,
      timestamp,
      timestamp
    ),
  ]);
  if ((results.at(2)?.meta.changes ?? 0) === 1) {
    await env.DB.batch([
      jobEventStatement(
        env.DB,
        source.user_job_id,
        "email_approved",
        `Approved email to ${source.recipient}`,
        draftId
      ),
    ]);
  }
  const row = await readAttemptBySelection(
    env.DB,
    userId,
    source.user_job_id,
    draftId,
    routeId
  );
  if (!row) {
    throw new Error("Approved email attempt could not be read back");
  }
  return toAttemptView(row);
}

export async function listEmailAttempts(
  db: D1Database,
  userId: string,
  statuses: EmailAttemptStatus[]
): Promise<EmailAttemptView[]> {
  if (statuses.length === 0) {
    return [];
  }
  const placeholders = statuses.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT a.*,uj.job_id,j.title,j.company
         FROM application_attempts a
         JOIN user_jobs uj ON uj.id=a.user_job_id
         JOIN jobs j ON j.id=uj.job_id
        WHERE uj.user_id=? AND a.status IN (${placeholders})
        ORDER BY a.updated_at DESC,a.created_at DESC`
    )
    .bind(userId, ...statuses)
    .all<AttemptRow>();
  return rows.results.map(toAttemptView);
}

export async function claimEmailAttempt(
  env: AppEnv,
  userId: string,
  attemptId: string
) {
  const attempt = await readOwnedAttempt(env.DB, userId, attemptId);
  if (!attempt) {
    throw new EmailAttemptError("Email attempt not found", 404);
  }
  if (attempt.status !== "approved") {
    throw new EmailAttemptError(
      `Email attempt cannot be claimed from ${attempt.status}`,
      409
    );
  }
  const claimedAt = new Date().toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE application_attempts
        SET status='claimed',claimed_at=?,updated_at=?
      WHERE id=? AND status='approved'
        AND user_job_id IN (SELECT id FROM user_jobs WHERE user_id=?)`
  )
    .bind(claimedAt, claimedAt, attemptId, userId)
    .run();
  if ((claimed.meta.changes ?? 0) !== 1) {
    throw new EmailAttemptError("Email attempt is already claimed", 409);
  }

  try {
    const payload = await buildGmailMessagePayload(
      env,
      userId,
      attempt.draft_id,
      {
        from: attempt.from_email,
        subject: attempt.subject,
        to: attempt.recipient,
      }
    );
    const payloadSha256 = await sha256(payload.raw);
    await env.DB.prepare(
      `UPDATE application_attempts
          SET payload_sha256=?,updated_at=?
        WHERE id=? AND status='claimed'`
    )
      .bind(payloadSha256, new Date().toISOString(), attemptId)
      .run();
    return {
      attachmentCount: payload.attachmentCount,
      attemptId,
      filenames: payload.filenames,
      payloadSha256,
      raw: payload.raw,
      recipient: attempt.recipient,
      subject: attempt.subject,
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "MIME generation failed";
    await failClaimedAttempt(
      env.DB,
      userId,
      attemptId,
      "mime_generation",
      detail
    );
    throw error;
  }
}

export function recordGmailDraft(
  db: D1Database,
  userId: string,
  attemptId: string,
  gmailDraftId: string,
  gmailMessageId: string
): Promise<EmailAttemptView> {
  return transitionAttempt(
    db,
    userId,
    attemptId,
    "claimed",
    "drafted",
    "gmail_draft_id=?,gmail_draft_message_id=?,drafted_at=?",
    [gmailDraftId, gmailMessageId, new Date().toISOString()]
  );
}

export function reserveGmailSend(
  db: D1Database,
  userId: string,
  attemptId: string,
  gmailDraftId: string
): Promise<EmailAttemptView> {
  return transitionAttempt(
    db,
    userId,
    attemptId,
    "drafted",
    "sending",
    "sending_at=?",
    [new Date().toISOString()],
    "gmail_draft_id=?",
    [gmailDraftId]
  );
}

export async function recordGmailSent(
  db: D1Database,
  userId: string,
  attemptId: string,
  gmailDraftId: string,
  gmailMessageId: string,
  gmailThreadId: string
): Promise<EmailAttemptView> {
  const attempt = await readOwnedAttempt(db, userId, attemptId);
  if (!attempt) {
    throw new EmailAttemptError("Email attempt not found", 404);
  }
  if (attempt.status === "sent") {
    if (
      attempt.gmail_draft_id === gmailDraftId &&
      attempt.gmail_message_id === gmailMessageId &&
      attempt.gmail_thread_id === gmailThreadId
    ) {
      return toAttemptView(attempt);
    }
    throw new EmailAttemptError("Gmail sent identifiers do not match", 409);
  }
  if (attempt.status !== "sending" || attempt.gmail_draft_id !== gmailDraftId) {
    throw new EmailAttemptError(
      `Email attempt cannot be recorded sent from ${attempt.status}`,
      409
    );
  }
  const timestamp = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE application_attempts
          SET status='sent',gmail_message_id=?,gmail_thread_id=?,sent_at=?,updated_at=?
        WHERE id=? AND status='sending' AND gmail_draft_id=?
          AND user_job_id IN (SELECT id FROM user_jobs WHERE user_id=?)`
      )
      .bind(
        gmailMessageId,
        gmailThreadId,
        timestamp,
        timestamp,
        attemptId,
        gmailDraftId,
        userId
      ),
    db
      .prepare(
        `UPDATE user_jobs SET status='applied',updated_at=?
        WHERE id=? AND user_id=?
          AND EXISTS (
            SELECT 1 FROM application_attempts
            WHERE id=? AND status='sent' AND updated_at=?
          )`
      )
      .bind(timestamp, attempt.user_job_id, userId, attemptId, timestamp),
    db
      .prepare(
        `UPDATE application_drafts SET status='submitted',submitted_at=?
        WHERE id=?
          AND EXISTS (
            SELECT 1 FROM application_attempts
            WHERE id=? AND status='sent' AND updated_at=?
          )`
      )
      .bind(timestamp, attempt.draft_id, attemptId, timestamp),
    db
      .prepare(
        `INSERT INTO job_events
        (id,user_job_id,event_type,draft_id,detail,metadata_json,created_at)
       SELECT ?,?,'email_sent',?,?,?,?
       WHERE EXISTS (
         SELECT 1 FROM application_attempts
         WHERE id=? AND status='sent' AND updated_at=?
       )`
      )
      .bind(
        crypto.randomUUID(),
        attempt.user_job_id,
        attempt.draft_id,
        `Gmail message ${gmailMessageId} verified with SENT label`,
        "{}",
        timestamp,
        attemptId,
        timestamp
      ),
  ]);
  if ((results.at(0)?.meta.changes ?? 0) !== 1) {
    throw new EmailAttemptError("Email send state changed concurrently", 409);
  }
  const updated = await readOwnedAttempt(db, userId, attemptId);
  if (!updated) {
    throw new Error("Sent email attempt could not be read back");
  }
  return toAttemptView(updated);
}

export function recordUncertainEmailAttempt(
  db: D1Database,
  userId: string,
  attemptId: string,
  stage: string,
  error: string,
  gmailMessageId = "",
  gmailThreadId = ""
): Promise<EmailAttemptView> {
  return transitionAttempt(
    db,
    userId,
    attemptId,
    "sending",
    "uncertain",
    "error_stage=?,error_detail=?,gmail_message_id=?,gmail_thread_id=?",
    [stage, error, gmailMessageId, gmailThreadId]
  );
}

export function recordFailedEmailAttempt(
  db: D1Database,
  userId: string,
  attemptId: string,
  stage: string,
  error: string
): Promise<EmailAttemptView> {
  if (stage.startsWith("send")) {
    throw new EmailAttemptError(
      "Send-stage failures must be recorded as uncertain",
      422
    );
  }
  return transitionAttempt(
    db,
    userId,
    attemptId,
    "claimed",
    "failed",
    "error_stage=?,error_detail=?",
    [stage, error]
  );
}

async function transitionAttempt(
  db: D1Database,
  userId: string,
  attemptId: string,
  from: EmailAttemptStatus,
  to: EmailAttemptStatus,
  assignments: string,
  values: unknown[],
  extraCondition = "1=1",
  conditionValues: unknown[] = []
): Promise<EmailAttemptView> {
  const timestamp = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE application_attempts
          SET status=?,${assignments},updated_at=?
        WHERE id=? AND status=? AND ${extraCondition}
          AND user_job_id IN (SELECT id FROM user_jobs WHERE user_id=?)`
    )
    .bind(to, ...values, timestamp, attemptId, from, ...conditionValues, userId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    const current = await readOwnedAttempt(db, userId, attemptId);
    if (!current) {
      throw new EmailAttemptError("Email attempt not found", 404);
    }
    throw new EmailAttemptError(
      `Email attempt cannot move from ${current.status} to ${to}`,
      409
    );
  }
  const updated = await readOwnedAttempt(db, userId, attemptId);
  if (!updated) {
    throw new Error("Email attempt could not be read back");
  }
  return toAttemptView(updated);
}

async function failClaimedAttempt(
  db: D1Database,
  userId: string,
  attemptId: string,
  stage: string,
  detail: string
) {
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `UPDATE application_attempts
        SET status='failed',error_stage=?,error_detail=?,updated_at=?
      WHERE id=? AND status='claimed'
        AND user_job_id IN (SELECT id FROM user_jobs WHERE user_id=?)`
    )
    .bind(stage, detail.slice(0, 1000), timestamp, attemptId, userId)
    .run();
}

function readAttemptBySelection(
  db: D1Database,
  userId: string,
  userJobId: string,
  draftId: string,
  routeId: string
) {
  return db
    .prepare(
      `SELECT a.*,uj.job_id,j.title,j.company
         FROM application_attempts a
         JOIN user_jobs uj ON uj.id=a.user_job_id
         JOIN jobs j ON j.id=uj.job_id
        WHERE uj.user_id=? AND a.user_job_id=? AND a.draft_id=? AND a.route_id=?`
    )
    .bind(userId, userJobId, draftId, routeId)
    .first<AttemptRow>();
}

function readOwnedAttempt(db: D1Database, userId: string, attemptId: string) {
  return db
    .prepare(
      `SELECT a.*,uj.job_id,j.title,j.company,u.email from_email
         FROM application_attempts a
         JOIN user_jobs uj ON uj.id=a.user_job_id
         JOIN users u ON u.id=uj.user_id
         JOIN jobs j ON j.id=uj.job_id
        WHERE a.id=? AND uj.user_id=?`
    )
    .bind(attemptId, userId)
    .first<OwnedAttemptRow>();
}

function toAttemptView(row: AttemptRow): EmailAttemptView {
  return {
    attemptId: row.id,
    company: row.company,
    createdAt: row.created_at,
    draftId: row.draft_id,
    error: row.error_stage
      ? { detail: row.error_detail, stage: row.error_stage }
      : null,
    gmailDraftId: row.gmail_draft_id,
    gmailDraftMessageId: row.gmail_draft_message_id,
    gmailMessageId: row.gmail_message_id,
    gmailThreadId: row.gmail_thread_id,
    jobId: row.job_id,
    recipient: row.recipient,
    routeId: row.route_id,
    status: row.status,
    subject: row.subject,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

function applicationSubject(title: string, location: string, country: string) {
  const place = (location || country).replace(/[\r\n]+/gu, " ").trim();
  const fallback = title.replace(/[\r\n]+/gu, " ").trim();
  const suffix = place || fallback;
  return `Native English Teacher Available${suffix ? ` - ${suffix}` : ""}`.slice(
    0,
    180
  );
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
