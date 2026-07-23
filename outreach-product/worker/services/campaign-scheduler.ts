import {
  APPLICATION_MESSAGE_TASK_TYPE,
  type ApplicationMessageRequestInput,
} from "../../src/agent-tasks/application-message";
import type { AppEnv } from "../env";
import { releaseOutboundRecipientClaim } from "../repositories/outbound-recipient-claims";
import { buildAgentTaskRequestCreation } from "./agent-task-requests";
import {
  finishEmptyRun,
  nextDailyRun,
  pauseAtReplyThreshold,
  pauseCampaign,
} from "./campaign-scheduler/completion";
import {
  claimDispatchGroup,
  deliverReadyCampaignDispatches,
  eligibleDispatchGroups,
  readyDispatchGroups,
  selectDispatchPlan,
  skipDuplicateTargetsStatement,
} from "./campaign-scheduler/dispatch";
import type { DispatchGroup, DueCampaignRow } from "./campaign-scheduler/model";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export { deliverReadyCampaignDispatches } from "./campaign-scheduler/dispatch";

export async function runCampaignScheduler(env: AppEnv) {
  const planned = await planDueCampaignRuns(env);
  const delivered = await deliverReadyCampaignDispatches(env);
  return { delivered, planned };
}

export async function planDueCampaignRuns(env: AppEnv) {
  const now = new Date();
  const rows = await env.DB.prepare(
    `SELECT c.id,c.user_id,c.daily_pace,c.stop_after_human_replies,
            c.human_reply_count,c.posted_target_percent,
            c.first_five_required,c.first_five_completed_at,c.next_run_at
       FROM campaigns c
       JOIN campaign_delivery_authorizations auth ON auth.user_id=c.user_id
      WHERE c.status='running' AND c.next_run_at IS NOT NULL
        AND c.next_run_at<=?
        AND auth.enabled=1 AND auth.authorized_scope='campaigns'
      ORDER BY c.next_run_at,c.created_at`
  )
    .bind(now.toISOString())
    .all<DueCampaignRow>();
  return Promise.all(
    rows.results.map((campaign) => planCampaignRun(env, campaign, now))
  );
}

async function planCampaignRun(
  env: AppEnv,
  campaign: DueCampaignRow,
  now: Date
) {
  if (
    Number(campaign.human_reply_count) >=
    Number(campaign.stop_after_human_replies)
  ) {
    await pauseAtReplyThreshold(env.DB, campaign, now.toISOString());
    return { campaignId: campaign.id, status: "paused" as const };
  }
  if (campaign.first_five_required && !campaign.first_five_completed_at) {
    await pauseCampaign(
      env.DB,
      campaign.id,
      "Approve the first five campaign messages before delivery can start",
      now.toISOString()
    );
    return { campaignId: campaign.id, status: "paused" as const };
  }
  const runId = crypto.randomUUID();
  const scheduledFor = campaign.next_run_at;
  const created = await env.DB.prepare(
    `INSERT INTO campaign_runs
      (id,campaign_id,scheduled_for,daily_pace,posted_target_percent,status,
       created_at,updated_at)
     VALUES (?,?,?,?,?,'planning',?,?)
     ON CONFLICT(campaign_id,scheduled_for) DO NOTHING`
  )
    .bind(
      runId,
      campaign.id,
      scheduledFor,
      campaign.daily_pace,
      campaign.posted_target_percent,
      now.toISOString(),
      now.toISOString()
    )
    .run();
  if ((created.meta.changes ?? 0) !== 1) {
    return { campaignId: campaign.id, status: "duplicate" as const };
  }
  try {
    const [ready, candidates] = await Promise.all([
      readyDispatchGroups(env.DB, campaign.id),
      eligibleDispatchGroups(env.DB, campaign.id),
    ]);
    const selected = selectDispatchPlan(
      ready,
      candidates,
      Number(campaign.daily_pace),
      Number(campaign.posted_target_percent)
    );
    const claimed = (
      await Promise.all(
        selected.map((group) =>
          claimDispatchGroup(env, campaign, group, now.toISOString())
        )
      )
    ).filter((group): group is DispatchGroup => group !== null);
    if (claimed.length === 0) {
      await finishEmptyRun(env.DB, campaign, runId, now);
      return { campaignId: campaign.id, planned: 0, status: "completed" };
    }
    const statements: D1PreparedStatement[] = [];
    for (const group of claimed) {
      const dispatchId = group.dispatchId as string;
      if (group.targets.length === 0) {
        statements.push(
          env.DB.prepare(
            `UPDATE campaign_dispatches
                SET run_id=?,scheduled_for=?,updated_at=?
              WHERE id=? AND campaign_id=? AND status='ready'`
          ).bind(
            runId,
            scheduledFor,
            now.toISOString(),
            dispatchId,
            campaign.id
          ),
          skipDuplicateTargetsStatement(
            env.DB,
            campaign.id,
            group.dedupKey,
            dispatchId,
            group.routeStrategy,
            now.toISOString()
          )
        );
        continue;
      }
      const task = buildAgentTaskRequestCreation(env.DB, {
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
        userId: campaign.user_id,
      });
      statements.push(
        env.DB.prepare(
          `INSERT INTO campaign_dispatches
            (id,campaign_id,run_id,dedup_key,route_strategy,channel,status,
             scheduled_for,created_at,updated_at)
           VALUES (?,?,?,?,?,?,'queued',?,?,?)`
        ).bind(
          dispatchId,
          campaign.id,
          runId,
          group.dedupKey,
          group.routeStrategy,
          group.channel,
          scheduledFor,
          now.toISOString(),
          now.toISOString()
        ),
        task.statement,
        ...group.targets.map((target, ordinal) =>
          env.DB.prepare(
            `INSERT INTO campaign_dispatch_targets
              (dispatch_id,target_id,ordinal) VALUES (?,?,?)`
          ).bind(dispatchId, target.id, ordinal)
        ),
        ...group.targets.map((target) =>
          env.DB.prepare(
            `UPDATE campaign_targets SET status='claimed',updated_at=?
              WHERE id=? AND campaign_id=? AND status='eligible'`
          ).bind(now.toISOString(), target.id, campaign.id)
        ),
        skipDuplicateTargetsStatement(
          env.DB,
          campaign.id,
          group.dedupKey,
          dispatchId,
          group.routeStrategy,
          now.toISOString()
        )
      );
    }
    statements.push(
      env.DB.prepare(
        `UPDATE campaign_runs
            SET status=?,planned_dispatch_count=?,updated_at=?
          WHERE id=? AND status='planning'`
      ).bind(
        claimed.some((group) => group.targets.length > 0)
          ? "generating"
          : "delivering",
        claimed.length,
        now.toISOString(),
        runId
      ),
      env.DB.prepare(
        `UPDATE campaigns SET next_run_at=?,updated_at=?
          WHERE id=? AND status='running' AND next_run_at=?`
      ).bind(
        nextDailyRun(scheduledFor, now),
        now.toISOString(),
        campaign.id,
        scheduledFor
      )
    );
    try {
      await env.DB.batch(statements);
    } catch (error) {
      await Promise.all(
        claimed.map((group) =>
          releaseOutboundRecipientClaim(
            env.DB,
            "campaign_dispatch",
            group.dispatchId as string
          )
        )
      );
      throw error;
    }
    return {
      campaignId: campaign.id,
      planned: claimed.length,
      status: "planned" as const,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE campaign_runs
            SET status='failed',error_detail=?,completed_at=?,updated_at=?
          WHERE id=? AND status='planning'`
      ).bind(
        detail.slice(0, 1000),
        now.toISOString(),
        now.toISOString(),
        runId
      ),
      env.DB.prepare(
        `UPDATE campaigns
            SET status='paused',pause_reason=?,next_run_at=NULL,updated_at=?
          WHERE id=? AND status='running'`
      ).bind(
        `Campaign planning failed: ${detail}`.slice(0, 1000),
        now.toISOString(),
        campaign.id
      ),
    ]);
    return { campaignId: campaign.id, error: detail, status: "failed" };
  }
}
