import type { AppEnv } from "../../../worker/env";
import { defaultCampaignPacketSnapshotStatements } from "../../../worker/repositories/draft-attachments";
import {
  acquireOutboundRecipientClaim,
  releaseOutboundRecipientClaim,
} from "../../../worker/repositories/outbound-recipient-claims";
import {
  CampaignEmailAttemptError,
  readCampaignEmailAttempt,
} from "./campaign-email-attempt-model";

interface CampaignDispatchDeliveryRow {
  campaign_status: string;
  channel: string;
  dedup_key: string;
  id: string;
  recipient: string;
  status: string;
  subject: string;
}

export async function prepareCampaignEmailAttempt(
  env: AppEnv,
  userId: string,
  dispatchId: string
) {
  const existing = await readCampaignEmailAttempt(env.DB, userId, dispatchId);
  if (existing) {
    return existing;
  }
  const dispatch = await env.DB.prepare(
    `SELECT d.id,d.status,d.channel,d.recipient,d.subject,d.dedup_key,
            c.status campaign_status
       FROM campaign_dispatches d
       JOIN campaigns c ON c.id=d.campaign_id
      WHERE d.id=? AND c.user_id=?`
  )
    .bind(dispatchId, userId)
    .first<CampaignDispatchDeliveryRow>();
  if (!dispatch) {
    throw new CampaignEmailAttemptError("Campaign dispatch was not found");
  }
  if (dispatch.campaign_status !== "running") {
    throw new CampaignEmailAttemptError("Campaign is not running");
  }
  if (dispatch.channel !== "email") {
    throw new CampaignEmailAttemptError(
      "Only email campaign dispatches can use Gmail delivery"
    );
  }
  if (dispatch.status !== "ready") {
    throw new CampaignEmailAttemptError(
      `Campaign dispatch cannot be delivered from ${dispatch.status}`
    );
  }
  if (!(dispatch.recipient.trim() && dispatch.subject.trim())) {
    throw new CampaignEmailAttemptError(
      "Campaign email recipient and subject are required"
    );
  }
  const attemptId = crypto.randomUUID();
  await acquireOutboundRecipientClaim(env.DB, {
    dedupKey: dispatch.dedup_key,
    sourceId: dispatchId,
    sourceKind: "campaign_dispatch",
    userId,
  });
  const timestamp = new Date().toISOString();
  try {
    const packetStatements = await defaultCampaignPacketSnapshotStatements(
      env,
      userId,
      dispatchId,
      timestamp
    );
    const results = await env.DB.batch([
      ...packetStatements,
      env.DB.prepare(
        `INSERT INTO campaign_email_attempts
          (id,dispatch_id,recipient,subject,status,approved_at,created_at,
           updated_at)
         VALUES (?,?,?,?,'approved',?,?,?)`
      ).bind(
        attemptId,
        dispatchId,
        dispatch.recipient,
        dispatch.subject,
        timestamp,
        timestamp,
        timestamp
      ),
      env.DB.prepare(
        `UPDATE campaign_dispatches SET status='claimed',updated_at=?
          WHERE id=? AND status='ready'`
      ).bind(timestamp, dispatchId),
      env.DB.prepare(
        `UPDATE campaign_targets SET status='claimed',updated_at=?
          WHERE id IN (
            SELECT target_id FROM campaign_dispatch_targets WHERE dispatch_id=?
          ) AND status='approved'`
      ).bind(timestamp, dispatchId),
    ]);
    if ((results.at(-2)?.meta.changes ?? 0) !== 1) {
      throw new CampaignEmailAttemptError(
        "Campaign dispatch changed before delivery could be claimed"
      );
    }
  } catch (error) {
    await releaseOutboundRecipientClaim(
      env.DB,
      "campaign_dispatch",
      dispatchId
    );
    throw error;
  }
  const created = await readCampaignEmailAttempt(env.DB, userId, dispatchId);
  if (!created) {
    throw new CampaignEmailAttemptError(
      "Campaign email attempt could not be read back"
    );
  }
  return created;
}
