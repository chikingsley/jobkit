export type EmailAttemptStatus =
  | "approved"
  | "claimed"
  | "drafted"
  | "failed"
  | "sending"
  | "sent"
  | "uncertain";

export interface AttemptSourceRow {
  board: string;
  contact_channel_id: string | null;
  contact_role: string;
  country: string;
  draft_id: string;
  draft_status: string;
  from_email: string;
  job_status: string;
  location: string;
  message: string;
  recipient: string;
  required_opening: string;
  route_id: string;
  route_kind: string;
  route_status: string;
  source_reference: string;
  title: string;
  user_job_id: string;
}

export interface AttemptRow {
  application_bundle_id: string | null;
  attachment_count?: number;
  company: string;
  created_at: string;
  draft_id: string;
  error_detail: string;
  error_stage: string;
  gmail_draft_id: string;
  gmail_draft_message_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  id: string;
  job_id: string;
  recipient: string;
  route_id: string;
  send_requested_at: string | null;
  status: EmailAttemptStatus;
  subject: string;
  title: string;
  updated_at: string;
  user_job_id: string;
}

export interface OwnedAttemptRow extends AttemptRow {
  from_email: string;
}

export interface EmailAttemptView {
  attemptId: string;
  bundleId: string | null;
  company: string;
  createdAt: string;
  draftId: string;
  error: null | { detail: string; stage: string };
  gmailDraftId: string;
  gmailDraftMessageId: string;
  gmailMessageId: string;
  gmailThreadId: string;
  jobId: string;
  recipient: string;
  routeId: string;
  sendRequestedAt: string | null;
  status: EmailAttemptStatus;
  subject: string;
  title: string;
  updatedAt: string;
}

export class EmailAttemptError extends Error {
  readonly status: 400 | 404 | 409 | 422;

  constructor(message: string, status: 400 | 404 | 409 | 422) {
    super(message);
    this.status = status;
  }
}
