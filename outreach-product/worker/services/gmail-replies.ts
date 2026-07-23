import type { AppEnv } from "../env";
import {
  GmailApiError,
  listRecentInboxMessages,
  startGmailWatch,
} from "./gmail-api";
import { getGoogleAccessToken } from "./gmail-auth";
import { GmailIntegrationError, gmailErrorMessage } from "./gmail-errors";
import {
  compareHistoryIds,
  decodeBase64,
  latestHistoryId,
  pubSubEventStatement,
  recordPubSubEvent,
  requiredTopicName,
} from "./gmail-replies/message";
import { GmailPushDataSchema, type GmailWatchRow } from "./gmail-replies/model";
import {
  collectHistoryMessageIds,
  syncInboundMessages,
} from "./gmail-replies/sync";

export async function processGmailPush(
  env: AppEnv,
  input: {
    emailAddress: string;
    historyId: string;
    messageId: string;
  }
) {
  const duplicate = await env.DB.prepare(
    "SELECT 1 found FROM gmail_pubsub_events WHERE message_id=?"
  )
    .bind(input.messageId)
    .first<{ found: number }>();
  if (duplicate) {
    return { duplicate: true, messagesRecorded: 0, ok: true as const };
  }
  const watch = await env.DB.prepare(
    `SELECT user_id,email_address,history_id FROM gmail_mailbox_watches
      WHERE lower(email_address)=lower(?) LIMIT 1`
  )
    .bind(input.emailAddress)
    .first<GmailWatchRow>();
  if (!watch) {
    // The notification has already passed Google OIDC verification. Unknown
    // mailboxes have no state to synchronize, so acknowledge them instead of
    // making Pub/Sub retry an unprocessable event for the retention window.
    return {
      duplicate: false,
      ignored: true,
      messagesRecorded: 0,
      ok: true as const,
    };
  }
  if (compareHistoryIds(input.historyId, watch.history_id) <= 0) {
    await recordPubSubEvent(env.DB, input, 0);
    return { duplicate: false, messagesRecorded: 0, ok: true as const };
  }

  const accessToken = await getGoogleAccessToken(env, watch.user_id);
  let changes: { historyId: string; messageIds: string[] };
  let messagesRecorded: number;
  try {
    changes = await gmailChangesSince(
      env,
      accessToken,
      watch.history_id,
      input.historyId
    );
    messagesRecorded = await syncInboundMessages(
      env,
      watch.user_id,
      watch.email_address,
      accessToken,
      changes.messageIds
    );
  } catch (error) {
    await markWatchError(env.DB, watch.user_id, gmailErrorMessage(error));
    throw error;
  }
  const timestamp = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE gmail_mailbox_watches
        SET history_id=?,status='active',last_synced_at=?,last_error='',updated_at=?
        WHERE user_id=?`
    ).bind(changes.historyId, timestamp, timestamp, watch.user_id),
    pubSubEventStatement(env.DB, input, messagesRecorded, timestamp),
  ]);
  return { duplicate: false, messagesRecorded, ok: true as const };
}

export async function reconcileRecentReplies(
  env: AppEnv,
  userId: string,
  emailAddress: string,
  accessToken: string
) {
  const recent = await listRecentInboxMessages(accessToken);
  return syncInboundMessages(
    env,
    userId,
    emailAddress,
    accessToken,
    (recent.messages ?? []).map((message) => message.id)
  );
}

export function decodeGmailPushData(data: string) {
  try {
    const parsed = GmailPushDataSchema.parse(
      JSON.parse(decodeBase64(data), preserveNumericHistoryId)
    );
    return {
      emailAddress: parsed.emailAddress.toLowerCase(),
      historyId: parsed.historyId,
    };
  } catch (error) {
    throw new GmailIntegrationError(
      `Invalid Gmail Pub/Sub data: ${gmailErrorMessage(error)}`,
      { cause: error, status: 400 }
    );
  }
}

function preserveNumericHistoryId(
  key: string,
  value: unknown,
  context?: { source: string }
) {
  if (key === "historyId" && typeof value === "number") {
    // Gmail documents historyId as a JSON string, but live push delivery has
    // also emitted an integer. Preserve the source token so an int64 is never
    // rounded through JavaScript Number before it becomes our canonical string.
    if (!context) {
      throw new Error("JSON source context is unavailable");
    }
    return context.source;
  }
  return value;
}

export async function markWatchError(
  db: D1Database,
  userId: string,
  error: string
) {
  await db
    .prepare(
      `UPDATE gmail_mailbox_watches
        SET status='error',last_error=?,updated_at=? WHERE user_id=?`
    )
    .bind(error.slice(0, 1000), new Date().toISOString(), userId)
    .run();
}

async function gmailChangesSince(
  env: AppEnv,
  accessToken: string,
  startHistoryId: string,
  notifiedHistoryId: string
) {
  try {
    const history = await collectHistoryMessageIds(accessToken, startHistoryId);
    return {
      historyId: latestHistoryId(notifiedHistoryId, history.historyId),
      messageIds: history.messageIds,
    };
  } catch (error) {
    if (!(error instanceof GmailApiError && error.status === 404)) {
      throw error;
    }
    const recent = await listRecentInboxMessages(accessToken);
    const restarted = await startGmailWatch(
      accessToken,
      requiredTopicName(env)
    );
    return {
      historyId: restarted.historyId,
      messageIds: (recent.messages ?? []).map((message) => message.id),
    };
  }
}
