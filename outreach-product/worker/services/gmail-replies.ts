import { parse } from "node-html-parser";
import { z } from "zod";
import type { AppEnv } from "../env";
import {
  type CampaignReplyClassification,
  recordCampaignReply,
} from "./campaign-replies";
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

interface TrackedGmailRoute {
  campaign_id: string;
  dispatch_id: string;
  gmail_thread_id: string;
  id: string;
  kind: "attempt" | "campaign" | "test";
  recipient: string;
  subject: string;
}

const EMAIL_ADDRESS_PATTERN = /<([^<>]+)>/u;
const REPLY_PREFIX_PATTERN = /^(?:(?:re|fw|fwd):\s*)+/iu;

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
    `SELECT a.id,'attempt' kind,a.gmail_thread_id,'' recipient,'' subject,
            '' campaign_id,'' dispatch_id
       FROM application_attempts a
       JOIN user_listing_states uj ON uj.id=a.user_job_id
      WHERE uj.user_id=? AND a.gmail_thread_id<>''
        AND a.status IN ('sent','sending','uncertain')
      UNION ALL
     SELECT test_send.id,'test' kind,test_send.gmail_thread_id,
            test_send.recipient,test_send.subject,'' campaign_id,'' dispatch_id
       FROM application_bundle_test_sends test_send
       JOIN application_bundles bundle ON bundle.id=test_send.bundle_id
      WHERE bundle.user_id=? AND test_send.gmail_thread_id<>''
        AND test_send.status='sent'
     UNION ALL
     SELECT campaign_attempt.id,'campaign' kind,
            campaign_attempt.gmail_thread_id,campaign_attempt.recipient,
            campaign_attempt.subject,dispatch.campaign_id,
            dispatch.id dispatch_id
       FROM campaign_email_attempts campaign_attempt
       JOIN campaign_dispatches dispatch
         ON dispatch.id=campaign_attempt.dispatch_id
       JOIN campaigns campaign ON campaign.id=dispatch.campaign_id
      WHERE campaign.user_id=? AND campaign_attempt.gmail_thread_id<>''
        AND campaign_attempt.status IN ('sent','uncertain')`
  )
    .bind(userId, userId, userId)
    .all<TrackedGmailRoute>();
  if (tracked.results.length === 0) {
    return 0;
  }
  const attemptThreads = new Set(
    tracked.results
      .filter((route) => route.kind === "attempt")
      .map((route) => route.gmail_thread_id)
  );
  const testSendsByThread = new Map(
    tracked.results
      .filter((route) => route.kind === "test")
      .map((route) => [route.gmail_thread_id, route.id])
  );
  const testSendsByReply = new Map(
    tracked.results
      .filter((route) => route.kind === "test")
      .map((route) => [testReplyKey(route.subject, route.recipient), route.id])
  );
  const campaignsByThread = new Map(
    tracked.results
      .filter((route) => route.kind === "campaign")
      .map((route) => [route.gmail_thread_id, route])
  );
  const messages = await Promise.all(
    [...new Set(messageIds)].map((messageId) =>
      getGmailMessage(accessToken, messageId, "full")
    )
  );
  const inbound = messages.flatMap((message) => {
    const headers = messageHeaders(message);
    const testSendId = matchingTestSendId(
      message,
      headers,
      testSendsByThread,
      testSendsByReply
    );
    const campaign = campaignsByThread.get(message.threadId);
    if (!(attemptThreads.has(message.threadId) || testSendId || campaign)) {
      return [];
    }
    if (!isInboxReply(message)) {
      return [];
    }
    const classification = classifyInboundMessage(headers, emailAddress);
    if (!campaign && classification !== "human") {
      return [];
    }
    return [
      {
        bodyText: messageText(message),
        campaign,
        classification,
        evidence: classificationEvidence(headers),
        fromAddress: headers.get("from") ?? "",
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        sentAt: messageSentAt(message),
        subject: headers.get("subject") ?? "",
        testSendId,
        toAddress: headers.get("to") ?? "",
      },
    ];
  });
  const results = await Promise.all(
    inbound.map(async (message) => {
      const recorded = await recordInboundMessage(env.DB, userId, message);
      if (message.campaign) {
        await recordCampaignReply(env.DB, {
          campaignId: message.campaign.campaign_id,
          classification: message.classification,
          dispatchId: message.campaign.dispatch_id,
          evidence: message.evidence,
          gmailMessageId: message.gmailMessageId,
          gmailThreadId: message.gmailThreadId,
          receivedAt: message.sentAt,
        });
      }
      return recorded;
    })
  );
  return results.filter((result) => result.created).length;
}

function isInboxReply(message: GmailMessage) {
  return (
    Boolean(message.labelIds?.includes("INBOX")) &&
    !message.labelIds?.includes("SENT")
  );
}

function matchingTestSendId(
  message: GmailMessage,
  headers: Map<string, string>,
  byThread: Map<string, string>,
  byReply: Map<string, string>
) {
  return (
    byThread.get(message.threadId) ??
    byReply.get(
      testReplyKey(headers.get("subject") ?? "", headers.get("from") ?? "")
    )
  );
}

function testReplyKey(subject: string, address: string) {
  const normalizedSubject = subject
    .trim()
    .replace(REPLY_PREFIX_PATTERN, "")
    .toLowerCase();
  const bracketedAddress = address.match(EMAIL_ADDRESS_PATTERN)?.[1];
  return `${normalizedSubject}\u0000${(bracketedAddress ?? address).trim().toLowerCase()}`;
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

function classifyInboundMessage(
  headers: Map<string, string>,
  senderEmail: string
): CampaignReplyClassification {
  const from = (headers.get("from") ?? "").toLowerCase();
  const autoSubmitted = (headers.get("auto-submitted") ?? "").toLowerCase();
  const precedence = (headers.get("precedence") ?? "").toLowerCase();
  if (
    from.includes("mailer-daemon") ||
    from.includes("postmaster") ||
    headers.has("x-failed-recipients")
  ) {
    return "bounce";
  }
  if (
    autoSubmitted.includes("auto-replied") ||
    headers.has("x-autoreply") ||
    headers.has("x-autorespond")
  ) {
    return "vacation";
  }
  if (
    from.includes(senderEmail.toLowerCase()) ||
    (autoSubmitted !== "" && autoSubmitted !== "no") ||
    ["bulk", "junk", "list"].includes(precedence) ||
    headers.has("list-id")
  ) {
    return "automated";
  }
  return "human";
}

function classificationEvidence(headers: Map<string, string>) {
  return Object.fromEntries(
    [
      "from",
      "auto-submitted",
      "precedence",
      "list-id",
      "x-autoreply",
      "x-autorespond",
      "x-failed-recipients",
    ]
      .map((name) => [name, headers.get(name) ?? ""] as const)
      .filter(([, value]) => value !== "")
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
