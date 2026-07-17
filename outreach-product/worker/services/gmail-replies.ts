import { parse } from "node-html-parser";
import { z } from "zod";
import type { AppEnv } from "../env";
import {
  GmailApiError,
  type GmailMessage,
  type GmailMessagePart,
  getGmailMessage,
  listGmailHistory,
  listRecentInboxMessages,
  startGmailWatch,
} from "./gmail-api";
import { getGoogleAccessToken } from "./gmail-auth";
import { GmailIntegrationError, gmailErrorMessage } from "./gmail-errors";
import { recordInboundMessage } from "./messages";

interface GmailWatchRow {
  email_address: string;
  history_id: string;
  user_id: string;
}

const GmailPushDataSchema = z.object({
  emailAddress: z.string().trim().min(1),
  historyId: z.string().regex(/^\d+$/u),
});

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

async function syncInboundMessages(
  env: AppEnv,
  userId: string,
  emailAddress: string,
  accessToken: string,
  messageIds: string[]
) {
  const tracked = await env.DB.prepare(
    `SELECT DISTINCT a.gmail_thread_id
       FROM application_attempts a
       JOIN user_jobs uj ON uj.id=a.user_job_id
      WHERE uj.user_id=? AND a.gmail_thread_id<>''
        AND a.status IN ('sent','sending','uncertain')`
  )
    .bind(userId)
    .all<{ gmail_thread_id: string }>();
  const trackedThreads = new Set(
    tracked.results.map((row) => row.gmail_thread_id)
  );
  if (trackedThreads.size === 0) {
    return 0;
  }
  const messages = await Promise.all(
    [...new Set(messageIds)].map((messageId) =>
      getGmailMessage(accessToken, messageId, "full")
    )
  );
  const inbound = messages.flatMap((message) => {
    if (!isTrackedInboxReply(message, trackedThreads)) {
      return [];
    }
    const headers = messageHeaders(message);
    if (automatedMessage(headers, emailAddress)) {
      return [];
    }
    return [
      {
        bodyText: messageText(message),
        fromAddress: headers.get("from") ?? "",
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        sentAt: messageSentAt(message),
        subject: headers.get("subject") ?? "",
        toAddress: headers.get("to") ?? "",
      },
    ];
  });
  const results = await Promise.all(
    inbound.map((message) => recordInboundMessage(env.DB, userId, message))
  );
  return results.filter((result) => result.created).length;
}

function isTrackedInboxReply(
  message: GmailMessage,
  trackedThreads: Set<string>
) {
  return (
    trackedThreads.has(message.threadId) &&
    Boolean(message.labelIds?.includes("INBOX")) &&
    !message.labelIds?.includes("SENT")
  );
}

async function collectHistoryMessageIds(
  accessToken: string,
  startHistoryId: string
) {
  const messageIds = new Set<string>();
  let historyId = startHistoryId;
  let pageToken: string | undefined;
  let pageCount = 0;
  do {
    // biome-ignore lint/performance/noAwaitInLoops: Gmail supplies the next page token only after the current history page is read.
    const page = await listGmailHistory(accessToken, startHistoryId, pageToken);
    for (const history of page.history ?? []) {
      for (const addition of history.messagesAdded ?? []) {
        if (addition.message.id) {
          messageIds.add(addition.message.id);
        }
      }
    }
    historyId = latestHistoryId(historyId, page.historyId ?? historyId);
    pageToken = page.nextPageToken;
    pageCount += 1;
    if (pageCount >= 100 && pageToken) {
      throw new GmailIntegrationError("Gmail history sync exceeded 100 pages");
    }
  } while (pageToken);
  return { historyId, messageIds: [...messageIds] };
}

function messageHeaders(message: GmailMessage) {
  return new Map(
    (message.payload?.headers ?? []).map((header) => [
      header.name.toLowerCase(),
      header.value,
    ])
  );
}

function automatedMessage(headers: Map<string, string>, senderEmail: string) {
  const from = (headers.get("from") ?? "").toLowerCase();
  const autoSubmitted = (headers.get("auto-submitted") ?? "").toLowerCase();
  const precedence = (headers.get("precedence") ?? "").toLowerCase();
  return (
    from.includes(senderEmail.toLowerCase()) ||
    from.includes("mailer-daemon") ||
    from.includes("postmaster") ||
    (autoSubmitted !== "" && autoSubmitted !== "no") ||
    ["bulk", "junk", "list"].includes(precedence) ||
    headers.has("list-id") ||
    headers.has("x-autoreply") ||
    headers.has("x-autorespond")
  );
}

function messageText(message: GmailMessage) {
  const plain = decodedPart(message.payload, "text/plain");
  if (plain.trim()) {
    return plain.trim().slice(0, 100_000);
  }
  const html = decodedPart(message.payload, "text/html");
  if (html.trim()) {
    return parse(html).textContent.trim().slice(0, 100_000);
  }
  return (message.snippet?.trim() || "(no text body)").slice(0, 100_000);
}

function decodedPart(
  part: GmailMessagePart | undefined,
  mimeType: string
): string {
  if (!part) {
    return "";
  }
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBase64(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const value = decodedPart(child, mimeType);
    if (value) {
      return value;
    }
  }
  return "";
}

function messageSentAt(message: GmailMessage) {
  const milliseconds = Number(message.internalDate ?? "");
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? new Date(milliseconds).toISOString()
    : new Date().toISOString();
}

function decodeBase64(value: string) {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function recordPubSubEvent(
  db: D1Database,
  input: { emailAddress: string; historyId: string; messageId: string },
  messagesRecorded: number
) {
  const timestamp = new Date().toISOString();
  return db.batch([
    pubSubEventStatement(db, input, messagesRecorded, timestamp),
  ]);
}

function pubSubEventStatement(
  db: D1Database,
  input: { emailAddress: string; historyId: string; messageId: string },
  messagesRecorded: number,
  timestamp: string
) {
  return db
    .prepare(
      `INSERT INTO gmail_pubsub_events
        (message_id,email_address,history_id,received_at,processed_at,messages_recorded)
       VALUES (?,?,?,?,?,?) ON CONFLICT(message_id) DO NOTHING`
    )
    .bind(
      input.messageId,
      input.emailAddress,
      input.historyId,
      timestamp,
      timestamp,
      messagesRecorded
    );
}

function latestHistoryId(left: string, right: string) {
  return compareHistoryIds(left, right) >= 0 ? left : right;
}

function compareHistoryIds(left: string, right: string) {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  if (leftId === rightId) {
    return 0;
  }
  return leftId > rightId ? 1 : -1;
}

function requiredTopicName(env: AppEnv) {
  if (!env.GOOGLE_PUBSUB_TOPIC) {
    throw new GmailIntegrationError("Gmail Pub/Sub topic is not configured", {
      status: 503,
    });
  }
  return env.GOOGLE_PUBSUB_TOPIC;
}
