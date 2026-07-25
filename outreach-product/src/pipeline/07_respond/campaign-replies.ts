export type CampaignReplyClassification =
  | "automated"
  | "bounce"
  | "human"
  | "vacation";

export async function recordCampaignReply(
  db: D1Database,
  input: {
    campaignId: string;
    classification: CampaignReplyClassification;
    dispatchId: string;
    evidence: Record<string, string>;
    gmailMessageId: string;
    gmailThreadId: string;
    receivedAt: string;
  }
) {
  const timestamp = new Date().toISOString();
  const countsTowardPause = input.classification === "human";
  const inserted = await db
    .prepare(
      `INSERT INTO campaign_reply_events
        (id,campaign_id,dispatch_id,gmail_thread_id,gmail_message_id,
         classification,counts_toward_pause,evidence_json,received_at,
         created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(campaign_id,gmail_message_id) DO NOTHING`
    )
    .bind(
      crypto.randomUUID(),
      input.campaignId,
      input.dispatchId,
      input.gmailThreadId,
      input.gmailMessageId,
      input.classification,
      Number(countsTowardPause),
      JSON.stringify(input.evidence),
      input.receivedAt,
      timestamp
    )
    .run();
  if ((inserted.meta.changes ?? 0) !== 1) {
    return { counted: false, created: false };
  }
  if (!countsTowardPause) {
    return { counted: false, created: true };
  }
  await db.batch([
    db
      .prepare(
        `UPDATE campaign_dispatches SET status='replied',updated_at=?
        WHERE id=? AND campaign_id=? AND status='sent'`
      )
      .bind(timestamp, input.dispatchId, input.campaignId),
    db
      .prepare(
        `UPDATE campaign_targets SET status='replied',updated_at=?
        WHERE id IN (
          SELECT target_id FROM campaign_dispatch_targets WHERE dispatch_id=?
        ) AND status='sent'`
      )
      .bind(timestamp, input.dispatchId),
    db
      .prepare(
        `UPDATE campaigns
          SET human_reply_count=human_reply_count+1,updated_at=?
        WHERE id=?`
      )
      .bind(timestamp, input.campaignId),
    db
      .prepare(
        `UPDATE campaigns
          SET status='paused',
              pause_reason='Human reply threshold reached',
              next_run_at=NULL,updated_at=?
        WHERE id=? AND status='running'
          AND human_reply_count>=stop_after_human_replies`
      )
      .bind(timestamp, input.campaignId),
  ]);
  return { counted: true, created: true };
}
