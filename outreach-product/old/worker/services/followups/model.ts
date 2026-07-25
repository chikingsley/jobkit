import type { ApplicationMessageRequestInput } from "../../../src/agent-tasks/application-message";
import type { ApplicationMessageRoute } from "../../schemas";

export const MAX_FOLLOW_UP_WORDS = 120;

export const NON_WORD_PATTERN = /[^\p{L}\p{N}]+/gu;

export const REPLY_SUBJECT_PATTERN = /^re:/iu;

export type FollowUpTaskInput = Extract<
  ApplicationMessageRequestInput,
  { kind: "follow_up" }
>;

export interface FollowUpCandidateRow {
  gmail_thread_id: string;
  sent_at: string;
  source_attempt_id: string;
  source_kind: "application" | "campaign";
  user_id: string;
}

export interface LatestFollowUpRow {
  ordinal: number;
  sent_at: string | null;
  status: string;
}

export interface FollowUpSourceRow extends Record<string, unknown> {
  company: string;
  country: string;
  created_at: string;
  from_email: string;
  gmail_draft_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  id: string;
  location: string;
  message: string;
  recipient: string;
  route: ApplicationMessageRoute;
  source_attempt_id: string;
  source_kind: "application" | "campaign";
  status: string;
  subject: string;
  title: string;
  user_id: string;
}

export interface FoundationRow {
  voice_rules_json: string;
}

export interface FollowUpView {
  changeSummary: string;
  dueAt: string;
  gmailDraftId: string;
  id: string;
  message: string;
  ordinal: number;
  status: string;
}

export class FollowUpError extends Error {
  readonly status: 404 | 409 | 422;

  constructor(message: string, status: 404 | 409 | 422 = 409) {
    super(message);
    this.status = status;
  }
}
