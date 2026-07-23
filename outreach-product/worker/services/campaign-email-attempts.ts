import type { AppEnv } from "../env";
import { campaignDeliveryEnabled } from "../repositories/campaign-delivery-authorization";
import {
  outboundRecipientSentStatement,
  releaseOutboundRecipientClaim,
} from "../repositories/outbound-recipient-claims";
import {
  CampaignEmailAttemptError as CampaignEmailAttemptModelError,
  type CampaignEmailAttemptRow,
  readCampaignEmailAttempt,
} from "./campaign-email-attempt-model";
import { prepareCampaignEmailAttempt as prepareCampaignEmailAttemptRecord } from "./campaign-email-attempt-preparation";
import {
  createGmailDraft,
  getGmailMessage,
  getGmailProfile,
  sendGmailDraft,
} from "./gmail-api";
import { getGoogleAccessToken } from "./gmail-auth";
import { asGmailIntegrationError, gmailErrorMessage } from "./gmail-errors";
import { readGmailConnectionStatus } from "./gmail-integration";
import { buildCampaignGmailMessagePayload } from "./gmail-message";

export type CampaignEmailAttemptError = InstanceType<
  typeof CampaignEmailAttemptModelError
>;
export const CampaignEmailAttemptError = CampaignEmailAttemptModelError;

export function prepareCampaignEmailAttempt(
  env: AppEnv,
  userId: string,
  dispatchId: string
) {
  return prepareCampaignEmailAttemptRecord(env, userId, dispatchId);
}

export async function deliverCampaignDispatchWithGmail(
  env: AppEnv,
  userId: string,
  dispatchId: string
) {
  if (!(await campaignDeliveryEnabled(env.DB, userId))) {
    throw new CampaignEmailAttemptError("Live campaign delivery is locked");
  }
  const connection = await readGmailConnectionStatus(env, userId);
  if (connection.watch?.status !== "active") {
    throw new CampaignEmailAttemptError(
      "Finish Gmail setup in Messages before running a campaign"
    );
  }
  const accessToken = await getGoogleAccessToken(env, userId);
  let attempt = await prepareCampaignEmailAttempt(env, userId, dispatchId);
  if (attempt.status === "sent") {
    return attempt;
  }
  if (attempt.status === "approved") {
    attempt = await createCampaignGmailDraft(env, userId, attempt, accessToken);
  }
  if (attempt.status !== "drafted") {
    throw new CampaignEmailAttemptError(
      `Campaign email cannot be sent from ${attempt.status}`
    );
  }
  attempt = await reserveCampaignGmailSend(env.DB, userId, attempt);
  return sendAndVerifyCampaignGmailDraft(env, userId, attempt, accessToken);
}

async function createCampaignGmailDraft(
  env: AppEnv,
  userId: string,
  attempt: CampaignEmailAttemptRow,
  accessToken: string
) {
  const claimedAt = new Date().toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE campaign_email_attempts
        SET status='claimed',claimed_at=?,updated_at=?
      WHERE id=? AND status='approved' AND dispatch_id IN (
        SELECT d.id FROM campaign_dispatches d
        JOIN campaigns c ON c.id=d.campaign_id WHERE c.user_id=?
      )`
  )
    .bind(claimedAt, claimedAt, attempt.id, userId)
    .run();
  if ((claimed.meta.changes ?? 0) !== 1) {
    throw new CampaignEmailAttemptError(
      "Campaign email attempt is already claimed"
    );
  }
  try {
    const profile = await getGmailProfile(accessToken);
    const payload = await buildCampaignGmailMessagePayload(
      env,
      userId,
      attempt.dispatch_id,
      {
        from: profile.emailAddress,
        subject: attempt.subject,
        to: attempt.recipient,
      }
    );
    const payloadSha256 = await sha256(payload.raw);
    await env.DB.prepare(
      `UPDATE campaign_email_attempts SET payload_sha256=?,updated_at=?
        WHERE id=? AND status='claimed'`
    )
      .bind(payloadSha256, new Date().toISOString(), attempt.id)
      .run();
    const draft = await createGmailDraft(accessToken, payload.raw);
    if (!(draft.id && draft.message?.id)) {
      throw new Error("Gmail created a campaign draft without identifiers");
    }
    const timestamp = new Date().toISOString();
    const result = await env.DB.prepare(
      `UPDATE campaign_email_attempts
          SET status='drafted',gmail_draft_id=?,gmail_draft_message_id=?,
              drafted_at=?,updated_at=?
        WHERE id=? AND status='claimed'`
    )
      .bind(draft.id, draft.message.id, timestamp, timestamp, attempt.id)
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      throw new Error("Campaign Gmail draft state changed concurrently");
    }
  } catch (error) {
    await failCampaignEmailBeforeSend(env.DB, attempt, error);
    throw asGmailIntegrationError(
      error,
      "Gmail could not create the campaign email draft"
    );
  }
  const drafted = await readCampaignEmailAttempt(
    env.DB,
    userId,
    attempt.dispatch_id
  );
  if (!drafted) {
    throw new CampaignEmailAttemptError("Campaign Gmail draft was not found");
  }
  return drafted;
}

async function reserveCampaignGmailSend(
  db: D1Database,
  userId: string,
  attempt: CampaignEmailAttemptRow
) {
  const timestamp = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE campaign_email_attempts
          SET status='sending',sending_at=?,updated_at=?
        WHERE id=? AND status='drafted' AND gmail_draft_id=?
          AND dispatch_id IN (
            SELECT d.id FROM campaign_dispatches d
            JOIN campaigns c ON c.id=d.campaign_id WHERE c.user_id=?
          )`
    )
    .bind(timestamp, timestamp, attempt.id, attempt.gmail_draft_id, userId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new CampaignEmailAttemptError(
      "Campaign Gmail send changed concurrently"
    );
  }
  return { ...attempt, status: "sending" as const };
}

async function sendAndVerifyCampaignGmailDraft(
  env: AppEnv,
  userId: string,
  attempt: CampaignEmailAttemptRow,
  accessToken: string
) {
  let messageId = "";
  let threadId = "";
  try {
    const sent = await sendGmailDraft(accessToken, attempt.gmail_draft_id);
    ({ id: messageId, threadId } = sent);
    if (!(messageId && threadId)) {
      throw new Error("Gmail send did not return campaign message identifiers");
    }
    const verified = await getGmailMessage(accessToken, messageId, "metadata");
    if (
      verified.id !== messageId ||
      verified.threadId !== threadId ||
      !verified.labelIds?.includes("SENT")
    ) {
      throw new Error("Gmail could not verify the campaign SENT label");
    }
  } catch (error) {
    const timestamp = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE campaign_email_attempts
            SET status='uncertain',gmail_message_id=?,gmail_thread_id=?,
                error_stage='gmail_send_or_verify',error_detail=?,updated_at=?
          WHERE id=? AND status='sending'`
      ).bind(
        messageId,
        threadId,
        gmailErrorMessage(error),
        timestamp,
        attempt.id
      ),
      env.DB.prepare(
        `UPDATE campaign_dispatches
            SET status='uncertain',error_detail=?,updated_at=? WHERE id=?`
      ).bind(gmailErrorMessage(error), timestamp, attempt.dispatch_id),
      env.DB.prepare(
        `UPDATE campaign_runs
            SET status='failed',error_detail=?,completed_at=?,updated_at=?
          WHERE id=(
            SELECT run_id FROM campaign_dispatches WHERE id=?
          ) AND status IN ('generating','delivering')`
      ).bind(
        "Gmail delivery could not be verified",
        timestamp,
        timestamp,
        attempt.dispatch_id
      ),
      env.DB.prepare(
        `UPDATE campaigns
            SET status='paused',
                pause_reason='Gmail delivery is unconfirmed; inspect Messages before resuming',
                next_run_at=NULL,updated_at=?
          WHERE id=? AND status='running'`
      ).bind(timestamp, attempt.campaign_id),
    ]);
    throw asGmailIntegrationError(
      error,
      "Campaign Gmail send was invoked but could not be verified"
    );
  }
  const timestamp = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE campaign_email_attempts
          SET status='sent',gmail_message_id=?,gmail_thread_id=?,sent_at=?,
              error_stage='',error_detail='',updated_at=?
        WHERE id=? AND status='sending' AND gmail_draft_id=?`
    ).bind(
      messageId,
      threadId,
      timestamp,
      timestamp,
      attempt.id,
      attempt.gmail_draft_id
    ),
    env.DB.prepare(
      `UPDATE campaign_dispatches SET status='sent',error_detail='',updated_at=?
        WHERE id=? AND status='claimed'`
    ).bind(timestamp, attempt.dispatch_id),
    env.DB.prepare(
      `UPDATE campaign_messages SET status='sent'
        WHERE dispatch_id=? AND status='approved'`
    ).bind(attempt.dispatch_id),
    env.DB.prepare(
      `UPDATE campaign_targets SET status='sent',updated_at=?
        WHERE id IN (
          SELECT target_id FROM campaign_dispatch_targets WHERE dispatch_id=?
        ) AND status='claimed'`
    ).bind(timestamp, attempt.dispatch_id),
    outboundRecipientSentStatement(
      env.DB,
      "campaign_dispatch",
      attempt.dispatch_id,
      timestamp
    ),
    env.DB.prepare(
      `UPDATE campaign_runs
          SET sent_dispatch_count=sent_dispatch_count+1,updated_at=?
        WHERE id=(
          SELECT run_id FROM campaign_dispatches WHERE id=?
        )`
    ).bind(timestamp, attempt.dispatch_id),
  ]);
  if (results.slice(0, 2).some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new CampaignEmailAttemptError(
      "Verified campaign email could not be recorded"
    );
  }
  await completeCampaignRunAndCampaign(env.DB, attempt.dispatch_id, timestamp);
  const sent = await readCampaignEmailAttempt(
    env.DB,
    userId,
    attempt.dispatch_id
  );
  if (!sent) {
    throw new CampaignEmailAttemptError(
      "Sent campaign email could not be read back"
    );
  }
  return sent;
}

async function failCampaignEmailBeforeSend(
  db: D1Database,
  attempt: CampaignEmailAttemptRow,
  error: unknown
) {
  const timestamp = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE campaign_email_attempts
            SET status='failed',error_stage='gmail_draft_create',
                error_detail=?,updated_at=?
          WHERE id=? AND status IN ('approved','claimed')`
      )
      .bind(gmailErrorMessage(error), timestamp, attempt.id),
    db
      .prepare(
        `UPDATE campaign_dispatches SET status='failed',error_detail=?,updated_at=?
          WHERE id=? AND status='claimed'`
      )
      .bind(gmailErrorMessage(error), timestamp, attempt.dispatch_id),
    db
      .prepare(
        `UPDATE campaign_targets SET status='failed',hold_reason=?,updated_at=?
          WHERE id IN (
            SELECT target_id FROM campaign_dispatch_targets WHERE dispatch_id=?
          ) AND status='claimed'`
      )
      .bind(gmailErrorMessage(error), timestamp, attempt.dispatch_id),
    db
      .prepare(
        `UPDATE campaign_runs
            SET status='failed',error_detail=?,completed_at=?,updated_at=?
          WHERE id=(
            SELECT run_id FROM campaign_dispatches WHERE id=?
          ) AND status IN ('generating','delivering')`
      )
      .bind(
        gmailErrorMessage(error),
        timestamp,
        timestamp,
        attempt.dispatch_id
      ),
    db
      .prepare(
        `UPDATE campaigns
            SET status='paused',pause_reason=?,next_run_at=NULL,updated_at=?
          WHERE id=? AND status='running'`
      )
      .bind(
        `Campaign delivery failed: ${gmailErrorMessage(error)}`.slice(0, 1000),
        timestamp,
        attempt.campaign_id
      ),
  ]);
  await releaseOutboundRecipientClaim(
    db,
    "campaign_dispatch",
    attempt.dispatch_id
  );
}

async function completeCampaignRunAndCampaign(
  db: D1Database,
  dispatchId: string,
  timestamp: string
) {
  await db.batch([
    db
      .prepare(
        `UPDATE campaign_runs
          SET status='completed',completed_at=?,updated_at=?
        WHERE id=(SELECT run_id FROM campaign_dispatches WHERE id=?)
          AND status IN ('generating','delivering')
          AND sent_dispatch_count>=planned_dispatch_count`
      )
      .bind(timestamp, timestamp, dispatchId),
    db
      .prepare(
        `UPDATE campaigns
          SET status='completed',completed_at=?,next_run_at=NULL,updated_at=?
        WHERE id=(SELECT campaign_id FROM campaign_dispatches WHERE id=?)
          AND status='running'
          AND NOT EXISTS (
            SELECT 1 FROM campaign_targets target
             WHERE target.campaign_id=campaigns.id
               AND target.status IN (
                 'eligible','calibration','ready','claimed','drafted','approved'
               )
          )`
      )
      .bind(timestamp, timestamp, dispatchId),
  ]);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
