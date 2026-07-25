import type { MessageThreadDetail } from "../../../src/features/messages/types";
import type { CampaignReplyClassification } from "../campaign-replies";

export const THREAD_STATUSES = ["sent", "sending", "uncertain"] as const;

export const ATTEMPT_THREAD_PREFIX = "attempt:";

export const CAMPAIGN_ATTEMPT_THREAD_PREFIX = "campaign-attempt:";

export const LINE_BREAK_PATTERN = /\r?\n/u;

export class MessageThreadError extends Error {
  readonly status: 404 | 409;

  constructor(message: string, status: 404 | 409 = 404) {
    super(message);
    this.status = status;
  }
}

export interface ThreadSummaryRow {
  application_bundle_id: string | null;
  attachment_count: number;
  company: string;
  country: string;
  created_at: string;
  gmail_thread_id: string;
  id: string;
  inbound_count: number;
  job_id: string;
  last_inbound_at: string;
  last_inbound_body: string;
  location: string;
  message: string;
  recipient: string;
  sent_at: null | string;
  source_kind: "application" | "campaign";
  status: string;
  subject: string;
  target_count: number;
  target_references_json: string;
  title: string;
  unread_count: number;
  updated_at: string;
}

export interface InboundMessageRow {
  body_text: string;
  classification: CampaignReplyClassification;
  direction: "inbound" | "outbound";
  from_address: string;
  gmail_message_id: string;
  id: string;
  sent_at: string;
  subject: string;
  to_address: string;
}

export interface InboundMessageInput {
  bodyText: string;
  classification?: CampaignReplyClassification;
  fromAddress: string;
  gmailMessageId: string;
  gmailThreadId: string;
  sentAt: string;
  subject: string;
  testSendId?: string;
  toAddress: string;
}

export type MessageThreadOutcome = NonNullable<
  MessageThreadDetail["outcome"]
>["value"];

export interface ThreadMessageRow {
  application_bundle_id: string | null;
  company: string;
  created_at: string;
  draft_id: string;
  error_detail: string;
  error_stage: string;
  from_email: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  id: string;
  job_id: string;
  message: string;
  recipient: string;
  sent_at: null | string;
  status: string;
  subject: string;
  title: string;
  updated_at: string;
}

export interface BundleTargetRow {
  job_id: string;
  location: string;
  source_reference: string;
  title: string;
}

export interface AttachmentRow {
  attempt_id: string;
  category: string;
  content_type: string;
  filename: string;
  position: number;
  size_bytes: number;
}

export interface AttachmentObjectRow {
  content_type: string;
  etag: string;
  filename: string;
  object_key: string;
  r2_version: string;
}
