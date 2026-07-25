import { z } from "zod";
import { campaignDeliveryEnabled } from "../../../../worker/repositories/campaign-delivery-authorization";
import { buildAgentTaskRequestCreation } from "../../../../worker/services/agent-task-requests";
import {
  APPLICATION_MESSAGE_TASK_TYPE,
  type ApplicationMessageRequestInput,
} from "../../../agent-tasks/application-message";
import {
  CampaignStatusSchema,
  type CampaignTargetDecision,
} from "../../../features/campaigns/schema";
import type {
  CampaignReplyEvent,
  CampaignRun,
  CampaignTargetPage,
} from "../../../features/campaigns/types";
import { readCampaign } from "../campaigns";
import { campaignTransition, selectCalibrationGroups } from "./materialization";
import {
  CAMPAIGN_TARGET_PAGE_SIZE,
  CampaignError,
  D1_ROW_SCHEMA,
  type TargetSeedRow,
} from "./model";
import {
  campaignTargetSelect,
  mapCampaignTarget,
  requireCampaign,
} from "./summary";

export async function readCampaignRuns(
  db: D1Database,
  campaignId: string
): Promise<CampaignRun[]> {
  const rows = await db
    .prepare(
      `SELECT id,scheduled_for,daily_pace,posted_target_percent,status,
              planned_dispatch_count,sent_dispatch_count,error_detail,
              completed_at
         FROM campaign_runs WHERE campaign_id=?
        ORDER BY scheduled_for DESC LIMIT 30`
    )
    .bind(campaignId)
    .all();
  return rows.results.map((rawRow) => {
    const run = D1_ROW_SCHEMA.parse(rawRow);
    return {
      completedAt: run.completed_at ? String(run.completed_at) : null,
      dailyPace: Number(run.daily_pace),
      errorDetail: String(run.error_detail),
      id: String(run.id),
      plannedDispatchCount: Number(run.planned_dispatch_count),
      postedTargetPercent: Number(run.posted_target_percent),
      scheduledFor: String(run.scheduled_for),
      sentDispatchCount: Number(run.sent_dispatch_count),
      status: z
        .enum(["planning", "generating", "delivering", "completed", "failed"])
        .parse(run.status),
    };
  });
}

export async function readCampaignReplies(
  db: D1Database,
  campaignId: string
): Promise<CampaignReplyEvent[]> {
  const rows = await db
    .prepare(
      `SELECT id,dispatch_id,classification,counts_toward_pause,received_at
         FROM campaign_reply_events WHERE campaign_id=?
        ORDER BY received_at DESC LIMIT 50`
    )
    .bind(campaignId)
    .all();
  return rows.results.map((rawRow) => {
    const reply = D1_ROW_SCHEMA.parse(rawRow);
    return {
      classification: z
        .enum(["human", "automated", "vacation", "bounce"])
        .parse(reply.classification),
      countsTowardPause: Boolean(reply.counts_toward_pause),
      dispatchId: reply.dispatch_id ? String(reply.dispatch_id) : null,
      id: String(reply.id),
      receivedAt: String(reply.received_at),
    };
  });
}

export async function listCampaignTargets(
  db: D1Database,
  userId: string,
  campaignId: string,
  offset: number
): Promise<CampaignTargetPage> {
  await requireCampaign(db, userId, campaignId);
  const safeOffset = Math.max(0, Math.floor(offset));
  const [rows, total] = await Promise.all([
    db
      .prepare(
        `${campaignTargetSelect()}
          WHERE t.campaign_id=?
          ORDER BY CASE t.status
            WHEN 'calibration' THEN 0 WHEN 'ready' THEN 1
            WHEN 'eligible' THEN 2 WHEN 'held' THEN 3
            WHEN 'failed' THEN 4 WHEN 'sent' THEN 5
            WHEN 'replied' THEN 6 ELSE 7 END,
            t.source_kind,t.country_code,COALESCE(j.title,o.name),t.admitted_at
          LIMIT ? OFFSET ?`
      )
      .bind(campaignId, CAMPAIGN_TARGET_PAGE_SIZE + 1, safeOffset)
      .all(),
    db
      .prepare(
        "SELECT COUNT(*) count FROM campaign_targets WHERE campaign_id=?"
      )
      .bind(campaignId)
      .first<number>("count"),
  ]);
  const hasMore = rows.results.length > CAMPAIGN_TARGET_PAGE_SIZE;
  const items = rows.results
    .slice(0, CAMPAIGN_TARGET_PAGE_SIZE)
    .map(mapCampaignTarget);
  return {
    hasMore,
    items,
    nextOffset: hasMore ? safeOffset + items.length : null,
    total: Number(total ?? 0),
  };
}

export async function beginCampaignCalibration(
  db: D1Database,
  userId: string,
  campaignId: string
) {
  const campaign = await requireCampaign(db, userId, campaignId);
  if (campaign.status !== "draft") {
    throw new CampaignError("Only a draft campaign can begin calibration", 409);
  }
  const seeds = await db
    .prepare(
      `SELECT id,country_code,source_kind,dedup_key,route_strategy,channel,
              match_score
         FROM campaign_targets
        WHERE campaign_id=? AND status='eligible'
        ORDER BY COALESCE(match_score,-1) DESC,admitted_at,id`
    )
    .bind(campaignId)
    .all<TargetSeedRow>();
  if (seeds.results.length === 0) {
    throw new CampaignError(
      "The campaign has no eligible targets. Refresh its markets or inspect held targets.",
      409
    );
  }
  if (!campaign.first_five_required) {
    const timestamp = new Date().toISOString();
    await db
      .prepare(
        `UPDATE campaigns SET status='ready',updated_at=?
          WHERE id=? AND user_id=? AND status='draft'`
      )
      .bind(timestamp, campaignId, userId)
      .run();
    return readCampaign(db, userId, campaignId);
  }
  const groups = selectCalibrationGroups(seeds.results, 5);
  const timestamp = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const group of groups) {
    const dispatchId = crypto.randomUUID();
    const taskCreation = buildAgentTaskRequestCreation(db, {
      payload: {
        dispatchId,
        kind: "campaign_dispatch",
        mode: "generate",
      } satisfies Extract<
        ApplicationMessageRequestInput,
        { kind: "campaign_dispatch" }
      >,
      subjectId: dispatchId,
      subjectType: "campaign_dispatch",
      taskType: APPLICATION_MESSAGE_TASK_TYPE,
      userId,
    });
    statements.push(
      db
        .prepare(
          `INSERT INTO campaign_dispatches
            (id,campaign_id,dedup_key,route_strategy,channel,status,
             created_at,updated_at)
           VALUES (?,?,?,?,?,'calibration',?,?)`
        )
        .bind(
          dispatchId,
          campaignId,
          group.dedupKey,
          group.routeStrategy,
          group.channel,
          timestamp,
          timestamp
        ),
      taskCreation.statement,
      ...group.targets.map((target, ordinal) =>
        db
          .prepare(
            `INSERT INTO campaign_dispatch_targets
              (dispatch_id,target_id,ordinal) VALUES (?,?,?)`
          )
          .bind(dispatchId, target.id, ordinal)
      ),
      ...group.targets.map((target) =>
        db
          .prepare(
            `UPDATE campaign_targets
                SET status='calibration',updated_at=?
              WHERE id=? AND campaign_id=? AND status='eligible'`
          )
          .bind(timestamp, target.id, campaignId)
      )
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE campaigns SET status='calibrating',updated_at=?
          WHERE id=? AND user_id=? AND status='draft'`
      )
      .bind(timestamp, campaignId, userId)
  );
  await db.batch(statements);
  return readCampaign(db, userId, campaignId);
}

export async function updateCampaignStatus(
  db: D1Database,
  userId: string,
  campaignId: string,
  action: "cancel" | "pause" | "resume" | "start",
  reason: string
) {
  const campaign = await requireCampaign(db, userId, campaignId);
  if (
    (action === "start" || action === "resume") &&
    !(await campaignDeliveryEnabled(db, userId))
  ) {
    throw new CampaignError(
      "Live campaign delivery is locked. Test the complete flow in Test Lab before authorizing real sends.",
      409
    );
  }
  const currentStatus = CampaignStatusSchema.parse(campaign.status);
  const transition = campaignTransition(currentStatus, action);
  const timestamp = new Date().toISOString();
  const humanReplyPause =
    action === "pause" ? reason.trim() || "Paused by the user" : "";
  const result = await db
    .prepare(
      `UPDATE campaigns
          SET status=?,pause_reason=?,
              started_at=CASE WHEN ?='running' THEN COALESCE(started_at,?) ELSE started_at END,
              completed_at=CASE WHEN ? IN ('completed','canceled') THEN ? ELSE completed_at END,
              next_run_at=CASE WHEN ?='running' THEN ? ELSE NULL END,
              updated_at=?
        WHERE id=? AND user_id=? AND status=?`
    )
    .bind(
      transition,
      humanReplyPause,
      transition,
      timestamp,
      transition,
      timestamp,
      transition,
      timestamp,
      timestamp,
      campaignId,
      userId,
      currentStatus
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new CampaignError(
      "The campaign changed before it could be updated",
      409
    );
  }
  return readCampaign(db, userId, campaignId);
}

export async function decideCampaignTarget(
  db: D1Database,
  userId: string,
  campaignId: string,
  targetId: string,
  decision: CampaignTargetDecision
) {
  await requireCampaign(db, userId, campaignId);
  const target = await db
    .prepare("SELECT status FROM campaign_targets WHERE id=? AND campaign_id=?")
    .bind(targetId, campaignId)
    .first<{ status: string }>();
  if (!target) {
    throw new CampaignError("Campaign target was not found", 404);
  }
  if (["sent", "replied", "claimed"].includes(target.status)) {
    throw new CampaignError(
      `A ${target.status} target can no longer be changed from review`,
      409
    );
  }
  const timestamp = new Date().toISOString();
  const reason = decision.status === "held" ? decision.reason : "";
  await db.batch([
    db
      .prepare(
        `UPDATE campaign_targets SET status=?,hold_reason=?,updated_at=?
          WHERE id=? AND campaign_id=?`
      )
      .bind(decision.status, reason, timestamp, targetId, campaignId),
    db
      .prepare(
        `INSERT INTO campaign_target_events
          (id,campaign_id,target_id,user_id,previous_status,next_status,
           reason,created_at)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .bind(
        crypto.randomUUID(),
        campaignId,
        targetId,
        userId,
        target.status,
        decision.status,
        reason,
        timestamp
      ),
  ]);
  return readCampaign(db, userId, campaignId);
}
