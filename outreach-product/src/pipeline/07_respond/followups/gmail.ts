import type { AppEnv } from "../../../../worker/env";
import {
  createGmailDraft,
  getGmailMessage,
  getGmailProfile,
  sendGmailDraft,
} from "../../06_deliver/gmail-api";
import { getGoogleAccessToken } from "../../06_deliver/gmail-auth";
import {
  asGmailIntegrationError,
  GmailIntegrationError,
  gmailErrorMessage,
} from "../../06_deliver/gmail-errors";
import { buildRawMimeMessage, gmailRaw } from "../../06_deliver/gmail-message";
import { FollowUpError } from "./model";
import { readFollowUp, readFollowUpSource } from "./storage";
import { gmailHeader, replySubject } from "./text";

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
