export type CampaignEmailAttemptStatus =
  | "approved"
  | "claimed"
  | "drafted"
  | "failed"
  | "sending"
  | "sent"
  | "uncertain";

export interface CampaignEmailAttemptRow {
  campaign_id: string;
  dispatch_id: string;
  gmail_draft_id: string;
  gmail_draft_message_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  id: string;
  recipient: string;
  status: CampaignEmailAttemptStatus;
  subject: string;
}

export class CampaignEmailAttemptError extends Error {}

export function readCampaignEmailAttempt(
  db: D1Database,
  userId: string,
  dispatchId: string
) {
  return db
    .prepare(
      `SELECT a.id,a.dispatch_id,a.recipient,a.subject,a.status,
              a.gmail_draft_id,a.gmail_draft_message_id,a.gmail_message_id,
              a.gmail_thread_id,d.campaign_id
         FROM campaign_email_attempts a
         JOIN campaign_dispatches d ON d.id=a.dispatch_id
         JOIN campaigns c ON c.id=d.campaign_id
        WHERE a.dispatch_id=? AND c.user_id=?`
    )
    .bind(dispatchId, userId)
    .first<CampaignEmailAttemptRow>();
}
