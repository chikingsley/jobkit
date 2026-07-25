import type { AppEnv } from "../../../../worker/env";
import {
  GmailApiError,
  type GmailHistoryPage,
  type GmailMessage,
  getGmailMessage,
  listGmailHistory,
} from "../../06_deliver/gmail-api";
import { GmailIntegrationError } from "../../06_deliver/gmail-errors";
import {
  type CampaignReplyClassification,
  recordCampaignReply,
} from "../campaign-replies";
import { recordInboundMessage } from "../messages";
import {
  classificationEvidence,
  latestHistoryId,
  messageSentAt,
  messageText,
} from "./message";
import {
  EMAIL_ADDRESS_PATTERN,
  REPLY_PREFIX_PATTERN,
  type TrackedGmailRoute,
} from "./model";

export async function syncInboundMessages(
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
  const fetched = await Promise.all(
    [...new Set(messageIds)].map((messageId) =>
      fetchSyncableMessage(accessToken, messageId)
    )
  );
  const messages = fetched.filter((message) => message !== null);
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

async function fetchSyncableMessage(accessToken: string, messageId: string) {
  try {
    return await getGmailMessage(accessToken, messageId, "full");
  } catch (error) {
    if (error instanceof GmailApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
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

function collectAddedMessageIds(
  messageIds: Set<string>,
  history: GmailHistoryPage["history"]
) {
  for (const record of history ?? []) {
    for (const addition of record.messagesAdded ?? []) {
      if (addition.message.id) {
        messageIds.add(addition.message.id);
      }
    }
  }
}

export async function collectHistoryMessageIds(
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
    collectAddedMessageIds(messageIds, page.history);
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
