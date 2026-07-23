import type { ThreadAttachment } from "../../../src/features/messages/types";
import type { AppEnv } from "../../env";
import { safeFilename } from "./mapping";
import {
  ATTEMPT_THREAD_PREFIX,
  type AttachmentObjectRow,
  type AttachmentRow,
  CAMPAIGN_ATTEMPT_THREAD_PREFIX,
  MessageThreadError,
} from "./model";

export async function resolveOwnedGmailThreadId(
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

export async function loadThreadAttachments(
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
