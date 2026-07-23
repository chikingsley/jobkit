import { resolveOwnedGmailThreadId } from "./attachments";
import {
  type InboundMessageInput,
  MessageThreadError,
  type MessageThreadOutcome,
} from "./model";

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

export async function readThreadOutcome(
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
