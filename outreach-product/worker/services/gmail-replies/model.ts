import { z } from "zod";

export interface GmailWatchRow {
  email_address: string;
  history_id: string;
  user_id: string;
}

export interface TrackedGmailRoute {
  campaign_id: string;
  dispatch_id: string;
  gmail_thread_id: string;
  id: string;
  kind: "attempt" | "campaign" | "test";
  recipient: string;
  subject: string;
}

export const EMAIL_ADDRESS_PATTERN = /<([^<>]+)>/u;

export const REPLY_PREFIX_PATTERN = /^(?:(?:re|fw|fwd):\s*)+/iu;

export const GmailPushDataSchema = z.object({
  emailAddress: z.string().trim().min(1),
  historyId: z.string().regex(/^\d+$/u),
});
