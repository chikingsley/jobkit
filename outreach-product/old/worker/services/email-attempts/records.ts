import { releaseOutboundRecipientClaim } from "../../repositories/outbound-recipient-claims";
import type { AttemptRow, EmailAttemptView, OwnedAttemptRow } from "./model";

export async function failClaimedAttempt(
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
        AND user_job_id IN (SELECT id FROM user_listing_states WHERE user_id=?)`
    )
    .bind(stage, detail.slice(0, 1000), timestamp, attemptId, userId)
    .run();
  await releaseOutboundRecipientClaim(db, "application_attempt", attemptId);
}

export function readAttemptBySelection(
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
         JOIN user_listing_states uj ON uj.id=a.user_job_id
         JOIN job_listings j ON j.id=uj.job_id
        WHERE uj.user_id=? AND a.user_job_id=? AND a.draft_id=? AND a.route_id=?`
    )
    .bind(userId, userJobId, draftId, routeId)
    .first<AttemptRow>();
}

export function readAttemptByBundleSelection(
  db: D1Database,
  userId: string,
  bundleId: string,
  draftId: string
) {
  return db
    .prepare(
      `SELECT a.*,uj.job_id,j.title,j.company
         FROM application_attempts a
         JOIN user_listing_states uj ON uj.id=a.user_job_id
         JOIN job_listings j ON j.id=uj.job_id
        WHERE uj.user_id=? AND a.application_bundle_id=? AND a.draft_id=?`
    )
    .bind(userId, bundleId, draftId)
    .first<AttemptRow>();
}

export function readOwnedAttempt(
  db: D1Database,
  userId: string,
  attemptId: string
) {
  return db
    .prepare(
      `SELECT a.*,uj.job_id,j.title,j.company,u.email from_email
         FROM application_attempts a
         JOIN user_listing_states uj ON uj.id=a.user_job_id
         JOIN users u ON u.id=uj.user_id
         JOIN job_listings j ON j.id=uj.job_id
        WHERE a.id=? AND uj.user_id=?`
    )
    .bind(attemptId, userId)
    .first<OwnedAttemptRow>();
}

export function toAttemptView(row: AttemptRow): EmailAttemptView {
  return {
    attemptId: row.id,
    bundleId: row.application_bundle_id,
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
    sendRequestedAt: row.send_requested_at,
    status: row.status,
    subject: row.subject,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

export function applicationSubject(
  board: string,
  sourceReference: string,
  title: string,
  location: string,
  country: string
) {
  const reference = sourceReference.replace(/[\r\n]+/gu, " ").trim();
  if (board === "anesl" && reference) {
    return `Native English Teacher Application - ${reference}`.slice(0, 180);
  }
  const place = (location || country).replace(/[\r\n]+/gu, " ").trim();
  const fallback = title.replace(/[\r\n]+/gu, " ").trim();
  const suffix = place || fallback;
  return `Native English Teacher Available${suffix ? ` - ${suffix}` : ""}`.slice(
    0,
    180
  );
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
