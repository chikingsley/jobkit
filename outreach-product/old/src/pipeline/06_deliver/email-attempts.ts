import type { AppEnv } from "../../../worker/env";
import {
  createApprovedBundleEmailAttempt,
  createApprovedEmailAttempt,
} from "./email-attempts/approval";
import { transitionAttempt } from "./email-attempts/delivery";
import {
  type AttemptRow,
  EmailAttemptError,
  type EmailAttemptStatus,
  type EmailAttemptView,
} from "./email-attempts/model";
import {
  failClaimedAttempt,
  readOwnedAttempt,
  sha256,
  toAttemptView,
} from "./email-attempts/records";
import { buildGmailMessagePayload } from "./gmail-message";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export {
  createApprovedBundleEmailAttempt,
  createApprovedEmailAttempt,
} from "./email-attempts/approval";
export {
  recordFailedEmailAttempt,
  recordGmailSent,
  recordUncertainEmailAttempt,
} from "./email-attempts/delivery";
export type {
  EmailAttemptStatus,
  EmailAttemptView,
} from "./email-attempts/model";
export { EmailAttemptError } from "./email-attempts/model";

export async function listEmailAttempts(
  db: D1Database,
  userId: string,
  statuses: EmailAttemptStatus[],
  sendRequested = false
): Promise<EmailAttemptView[]> {
  if (statuses.length === 0) {
    return [];
  }
  const placeholders = statuses.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT a.*,uj.job_id,j.title,j.company
         FROM application_attempts a
         JOIN user_listing_states uj ON uj.id=a.user_job_id
         JOIN job_listings j ON j.id=uj.job_id
        WHERE uj.user_id=? AND a.status IN (${placeholders})
          AND (?=0 OR a.send_requested_at IS NOT NULL)
        ORDER BY a.updated_at DESC,a.created_at DESC`
    )
    .bind(userId, ...statuses, sendRequested ? 1 : 0)
    .all<AttemptRow>();
  return rows.results.map(toAttemptView);
}

export async function prepareEmailSend(
  env: AppEnv,
  userId: string,
  jobId: string,
  draftId: string,
  routeId: string
): Promise<EmailAttemptView> {
  const attempt = await createApprovedEmailAttempt(
    env,
    userId,
    jobId,
    draftId,
    routeId
  );
  if (attempt.status === "sent") {
    return attempt;
  }
  if (!(attempt.status === "approved" || attempt.status === "drafted")) {
    throw new EmailAttemptError(
      `Email send cannot be requested from ${attempt.status}`,
      409
    );
  }
  const timestamp = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE application_attempts
        SET send_requested_at=?,updated_at=?
      WHERE id=? AND status IN ('approved','drafted')
        AND user_job_id IN (SELECT id FROM user_listing_states WHERE user_id=?)`
  )
    .bind(timestamp, timestamp, attempt.attemptId, userId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new EmailAttemptError("Email send request changed concurrently", 409);
  }
  const updated = await readOwnedAttempt(env.DB, userId, attempt.attemptId);
  if (!updated) {
    throw new Error("Requested email attempt could not be read back");
  }
  return toAttemptView(updated);
}

export async function prepareBundleEmailSend(
  env: AppEnv,
  userId: string,
  bundleId: string,
  draftId: string
): Promise<EmailAttemptView> {
  const attempt = await createApprovedBundleEmailAttempt(
    env,
    userId,
    bundleId,
    draftId
  );
  if (attempt.status === "sent") {
    return attempt;
  }
  if (!(attempt.status === "approved" || attempt.status === "drafted")) {
    throw new EmailAttemptError(
      `Bundle email send cannot be requested from ${attempt.status}`,
      409
    );
  }
  const timestamp = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE application_attempts SET send_requested_at=?,updated_at=?
      WHERE id=? AND application_bundle_id=?
        AND status IN ('approved','drafted')
        AND user_job_id IN (SELECT id FROM user_listing_states WHERE user_id=?)`
  )
    .bind(timestamp, timestamp, attempt.attemptId, bundleId, userId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new EmailAttemptError(
      "Bundle email send request changed concurrently",
      409
    );
  }
  const updated = await readOwnedAttempt(env.DB, userId, attempt.attemptId);
  if (!updated) {
    throw new Error("Requested bundle email attempt could not be read back");
  }
  return toAttemptView(updated);
}

export async function claimEmailAttempt(
  env: AppEnv,
  userId: string,
  attemptId: string,
  fromEmail?: string
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
        AND user_job_id IN (SELECT id FROM user_listing_states WHERE user_id=?)`
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
        from: fromEmail || attempt.from_email,
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
