import {
  outboundRecipientSentStatement,
  releaseOutboundRecipientClaim,
} from "../../repositories/outbound-recipient-claims";
import {
  EmailAttemptError,
  type EmailAttemptStatus,
  type EmailAttemptView,
} from "./model";
import { readOwnedAttempt, toAttemptView } from "./records";

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
  const sentStatements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE application_attempts
          SET status='sent',gmail_message_id=?,gmail_thread_id=?,sent_at=?,updated_at=?
        WHERE id=? AND status='sending' AND gmail_draft_id=?
          AND user_job_id IN (SELECT id FROM user_listing_states WHERE user_id=?)`
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
    outboundRecipientSentStatement(
      db,
      "application_attempt",
      attemptId,
      timestamp
    ),
  ];
  if (attempt.application_bundle_id) {
    sentStatements.push(
      db
        .prepare(
          `UPDATE user_listing_states SET status='applied',updated_at=?
        WHERE user_id=? AND id IN (
          SELECT user_job_id FROM application_bundle_targets WHERE bundle_id=?
        )
          AND EXISTS (
            SELECT 1 FROM application_attempts
            WHERE id=? AND status='sent' AND updated_at=?
          )`
        )
        .bind(
          timestamp,
          userId,
          attempt.application_bundle_id,
          attemptId,
          timestamp
        ),
      db
        .prepare(
          `UPDATE application_bundles SET status='sent',sent_at=?,updated_at=?
          WHERE id=? AND user_id=?
            AND EXISTS (
              SELECT 1 FROM application_attempts
               WHERE id=? AND status='sent' AND updated_at=?
            )`
        )
        .bind(
          timestamp,
          timestamp,
          attempt.application_bundle_id,
          userId,
          attemptId,
          timestamp
        )
    );
  } else {
    sentStatements.push(
      db
        .prepare(
          `UPDATE user_listing_states SET status='applied',updated_at=?
        WHERE id=? AND user_id=?
          AND EXISTS (
            SELECT 1 FROM application_attempts
            WHERE id=? AND status='sent' AND updated_at=?
          )`
        )
        .bind(timestamp, attempt.user_job_id, userId, attemptId, timestamp)
    );
  }
  sentStatements.push(
    db
      .prepare(
        `UPDATE application_drafts SET status='submitted',submitted_at=?
        WHERE id=?
          AND EXISTS (
            SELECT 1 FROM application_attempts
            WHERE id=? AND status='sent' AND updated_at=?
          )`
      )
      .bind(timestamp, attempt.draft_id, attemptId, timestamp)
  );
  if (attempt.application_bundle_id) {
    sentStatements.push(
      db
        .prepare(
          `INSERT INTO job_events
          (id,user_job_id,event_type,draft_id,detail,metadata_json,created_at)
         SELECT 'event:' || lower(hex(randomblob(16))),bt.user_job_id,
                'email_sent',?,?,json_object('applicationBundleId',?),?
           FROM application_bundle_targets bt
          WHERE bt.bundle_id=?
            AND EXISTS (
              SELECT 1 FROM application_attempts
               WHERE id=? AND status='sent' AND updated_at=?
            )`
        )
        .bind(
          attempt.draft_id,
          `Gmail message ${gmailMessageId} verified with SENT label`,
          attempt.application_bundle_id,
          timestamp,
          attempt.application_bundle_id,
          attemptId,
          timestamp
        )
    );
  } else {
    sentStatements.push(
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
        )
    );
  }
  const results = await db.batch(sentStatements);
  if (results.slice(0, 2).some((result) => (result.meta.changes ?? 0) !== 1)) {
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

export async function recordFailedEmailAttempt(
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
  const attempt = await transitionAttempt(
    db,
    userId,
    attemptId,
    "claimed",
    "failed",
    "error_stage=?,error_detail=?",
    [stage, error]
  );
  await releaseOutboundRecipientClaim(db, "application_attempt", attemptId);
  return attempt;
}

export async function transitionAttempt(
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
          AND user_job_id IN (SELECT id FROM user_listing_states WHERE user_id=?)`
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
