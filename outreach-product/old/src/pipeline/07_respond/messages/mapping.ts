import type {
  MessageThreadSummary,
  ThreadAttachment,
  ThreadMessage,
} from "../../../features/messages/types";
import {
  ATTEMPT_THREAD_PREFIX,
  CAMPAIGN_ATTEMPT_THREAD_PREFIX,
  type InboundMessageRow,
  LINE_BREAK_PATTERN,
  type ThreadMessageRow,
  type ThreadSummaryRow,
} from "./model";

export function toThreadSummary(row: ThreadSummaryRow): MessageThreadSummary {
  const outboundActivityAt = row.sent_at ? row.sent_at : row.updated_at;
  const replyIsLatest =
    row.last_inbound_at !== "" && row.last_inbound_at >= outboundActivityAt;
  return {
    attachmentCount: row.attachment_count,
    attemptId: row.id,
    company: row.application_bundle_id ? "ANESL" : row.company,
    country: row.country,
    jobId: row.job_id,
    lastActivityAt: replyIsLatest ? row.last_inbound_at : outboundActivityAt,
    location: row.location,
    messageCount: 1 + row.inbound_count,
    preview: previewOf(replyIsLatest ? row.last_inbound_body : row.message),
    recipient: row.recipient,
    sentAt: outboundActivityAt,
    status: row.status,
    subject: row.subject,
    targetCount: row.target_count,
    targetReferences: JSON.parse(row.target_references_json) as string[],
    threadId: threadIdForSummary(row),
    title: row.application_bundle_id
      ? `${row.target_count} ANESL positions`
      : row.title,
    unreadCount: row.unread_count,
  };
}

function threadIdForSummary(row: ThreadSummaryRow) {
  if (row.gmail_thread_id) {
    return row.gmail_thread_id;
  }
  const prefix =
    row.source_kind === "campaign"
      ? CAMPAIGN_ATTEMPT_THREAD_PREFIX
      : ATTEMPT_THREAD_PREFIX;
  return `${prefix}${row.id}`;
}

export function toInboundThreadMessage(row: InboundMessageRow): ThreadMessage {
  return {
    attachments: [],
    body: row.body_text,
    classification: row.classification,
    direction: row.direction,
    error: null,
    from: row.from_address,
    gmailMessageId: row.gmail_message_id,
    id: row.id,
    sentAt: row.sent_at,
    status: "received",
    subject: row.subject,
    to: row.to_address,
  };
}

export function toThreadMessage(
  row: ThreadMessageRow,
  attachments: ThreadAttachment[]
): ThreadMessage {
  return {
    attachments,
    body: row.message,
    classification: null,
    direction: "outbound",
    error: row.error_stage
      ? { detail: row.error_detail, stage: row.error_stage }
      : null,
    from: row.from_email,
    gmailMessageId: row.gmail_message_id,
    id: row.id,
    sentAt: row.sent_at ? row.sent_at : row.updated_at,
    status: row.status,
    subject: row.subject,
    to: row.recipient,
  };
}

function previewOf(message: string): string {
  const firstLine =
    message
      .split(LINE_BREAK_PATTERN)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  return firstLine.length > 160 ? `${firstLine.slice(0, 159)}…` : firstLine;
}

export function safeFilename(value: string): string {
  return value
    .replace(/[^a-z0-9._ -]/gi, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}
