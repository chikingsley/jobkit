import { type DueCampaignRow, ONE_DAY_MS } from "./model";

export async function finishEmptyRun(
  db: D1Database,
  campaign: DueCampaignRow,
  runId: string,
  now: Date
) {
  const remaining = await db
    .prepare(
      `SELECT COUNT(*) count FROM campaign_targets
        WHERE campaign_id=?
          AND status IN (
            'eligible','calibration','ready','claimed','drafted','approved'
          )`
    )
    .bind(campaign.id)
    .first<number>("count");
  const completed = Number(remaining ?? 0) === 0;
  await db.batch([
    db
      .prepare(
        `UPDATE campaign_runs
          SET status='completed',completed_at=?,updated_at=? WHERE id=?`
      )
      .bind(now.toISOString(), now.toISOString(), runId),
    db
      .prepare(
        `UPDATE campaigns
          SET status=?,completed_at=?,next_run_at=?,updated_at=?
        WHERE id=? AND status='running'`
      )
      .bind(
        completed ? "completed" : "running",
        completed ? now.toISOString() : null,
        completed ? null : nextDailyRun(campaign.next_run_at, now),
        now.toISOString(),
        campaign.id
      ),
  ]);
}

export async function skipClaimedElsewhereDispatch(
  db: D1Database,
  dispatchId: string,
  timestamp: string
) {
  await db.batch([
    db
      .prepare(
        `UPDATE campaign_dispatches
          SET status='canceled',error_detail='Recipient already contacted',
              updated_at=?
        WHERE id=? AND status='ready'`
      )
      .bind(timestamp, dispatchId),
    db
      .prepare(
        `UPDATE campaign_targets
          SET status='skipped',hold_reason='Recipient already contacted',
              updated_at=?
        WHERE id IN (
          SELECT target_id FROM campaign_dispatch_targets WHERE dispatch_id=?
        ) AND status='approved'`
      )
      .bind(timestamp, dispatchId),
  ]);
}

export function nextDailyRun(scheduledFor: string, now: Date) {
  const scheduled = new Date(scheduledFor);
  const anchor = Number.isNaN(scheduled.getTime())
    ? now.getTime()
    : Math.max(scheduled.getTime(), now.getTime());
  return new Date(anchor + ONE_DAY_MS).toISOString();
}

export function pauseAtReplyThreshold(
  db: D1Database,
  campaign: DueCampaignRow,
  timestamp: string
) {
  return pauseCampaign(
    db,
    campaign.id,
    `Paused after ${campaign.human_reply_count} human replies`,
    timestamp
  );
}

export function pauseCampaign(
  db: D1Database,
  campaignId: string,
  reason: string,
  timestamp: string
) {
  return db
    .prepare(
      `UPDATE campaigns
          SET status='paused',pause_reason=?,next_run_at=NULL,updated_at=?
        WHERE id=? AND status='running'`
    )
    .bind(reason, timestamp, campaignId)
    .run();
}
