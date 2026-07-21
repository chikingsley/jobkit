import {
  APPLICATION_MESSAGE_TASK_TYPE,
  type ApplicationMessageRequestInput,
} from "../../src/agent-tasks/application-message";
import type { AppEnv } from "../env";
import {
  acquireOutboundRecipientClaim,
  OutboundRecipientClaimError,
  releaseOutboundRecipientClaim,
} from "../repositories/outbound-recipient-claims";
import { buildAgentTaskRequestCreation } from "./agent-task-requests";
import { deliverCampaignDispatchWithGmail } from "./campaign-email-attempts";

interface DueCampaignRow {
  daily_pace: number;
  first_five_completed_at: string | null;
  first_five_required: number;
  human_reply_count: number;
  id: string;
  next_run_at: string;
  posted_target_percent: number;
  stop_after_human_replies: number;
  user_id: string;
}

interface DispatchSeed {
  channel: string;
  country_code: string;
  dedup_key: string;
  dispatch_id?: string;
  id: string;
  match_score?: number | null;
  route_strategy: "anesl_bundle" | "single";
  source_kind: "advertised" | "school";
}

interface DispatchGroup {
  channel: string;
  countryCode: string;
  dedupKey: string;
  dispatchId?: string;
  routeStrategy: "anesl_bundle" | "single";
  sourceKind: "advertised" | "school";
  targets: DispatchSeed[];
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

async function claimDispatchGroup(
  env: AppEnv,
  campaign: DueCampaignRow,
  group: DispatchGroup,
  timestamp: string
): Promise<DispatchGroup | null> {
  const dispatchId = group.dispatchId ?? crypto.randomUUID();
  try {
    await acquireOutboundRecipientClaim(env.DB, {
      dedupKey: group.dedupKey,
      sourceId: dispatchId,
      sourceKind: "campaign_dispatch",
      userId: campaign.user_id,
    });
    return { ...group, dispatchId };
  } catch (error) {
    if (!(error instanceof OutboundRecipientClaimError)) {
      throw error;
    }
    if (group.dispatchId) {
      await skipClaimedElsewhereDispatch(env.DB, group.dispatchId, timestamp);
    }
    return null;
  }
}

function skipDuplicateTargetsStatement(
  db: D1Database,
  campaignId: string,
  dedupKey: string,
  dispatchId: string,
  routeStrategy: DispatchGroup["routeStrategy"],
  timestamp: string
) {
  const reason =
    routeStrategy === "anesl_bundle"
      ? "Excluded from this ANESL email after selecting its five highest-ranked positions"
      : "Recipient represented by another target in this dispatch";
  return db
    .prepare(
      `UPDATE campaign_targets
          SET status='skipped',
              hold_reason=?,
              updated_at=?
        WHERE campaign_id=? AND dedup_key=? AND status='eligible'
          AND id NOT IN (
            SELECT target_id FROM campaign_dispatch_targets
             WHERE dispatch_id=?
          )`
    )
    .bind(reason, timestamp, campaignId, dedupKey, dispatchId);
}

async function readyDispatchGroups(db: D1Database, campaignId: string) {
  const rows = await db
    .prepare(
      `SELECT d.id dispatch_id,d.dedup_key,d.route_strategy,d.channel,
              t.id,t.country_code,t.source_kind
         FROM campaign_dispatches d
         JOIN campaign_dispatch_targets dt ON dt.dispatch_id=d.id
         JOIN campaign_targets t ON t.id=dt.target_id
        WHERE d.campaign_id=? AND d.status='ready' AND d.run_id IS NULL
        ORDER BY d.created_at,dt.ordinal`
    )
    .bind(campaignId)
    .all<DispatchSeed>();
  const groups = new Map<string, DispatchGroup>();
  for (const row of rows.results) {
    const group = groups.get(row.dispatch_id as string) ?? {
      channel: row.channel,
      countryCode: row.country_code,
      dedupKey: row.dedup_key,
      dispatchId: row.dispatch_id,
      routeStrategy: row.route_strategy,
      sourceKind: row.source_kind,
      targets: [],
    };
    groups.set(row.dispatch_id as string, group);
  }
  return [...groups.values()];
}

async function eligibleDispatchGroups(db: D1Database, campaignId: string) {
  const rows = await db
    .prepare(
      `SELECT t.id,t.country_code,t.source_kind,t.dedup_key,t.route_strategy,
              t.channel,t.match_score
         FROM campaign_targets t
        WHERE t.campaign_id=? AND t.status='eligible' AND t.channel='email'
          AND NOT EXISTS (
            SELECT 1 FROM campaign_dispatches d
             WHERE d.campaign_id=t.campaign_id AND d.dedup_key=t.dedup_key
          )
        ORDER BY COALESCE(t.match_score,-1) DESC,t.admitted_at,t.id`
    )
    .bind(campaignId)
    .all<DispatchSeed>();
  const groups = new Map<string, DispatchGroup>();
  for (const row of rows.results) {
    let group = groups.get(row.dedup_key);
    if (!group) {
      group = {
        channel: row.channel,
        countryCode: row.country_code,
        dedupKey: row.dedup_key,
        routeStrategy: row.route_strategy,
        sourceKind: row.source_kind,
        targets: [],
      };
      groups.set(row.dedup_key, group);
    }
    if (group.routeStrategy === "anesl_bundle") {
      if (group.targets.length < 5) {
        group.targets.push(row);
      }
    } else if (group.targets.length === 0) {
      group.targets.push(row);
    }
  }
  return [...groups.values()];
}

function selectDispatchPlan(
  ready: DispatchGroup[],
  candidates: DispatchGroup[],
  dailyPace: number,
  postedTargetPercent: number
) {
  const selected = ready.slice(0, dailyPace);
  const slots = dailyPace - selected.length;
  if (slots <= 0) {
    return selected;
  }
  const advertised = candidates.filter(
    (group) => group.sourceKind === "advertised"
  );
  const schools = candidates.filter((group) => group.sourceKind === "school");
  let selectedAdvertised = selected.filter(
    (group) => group.sourceKind === "advertised"
  ).length;
  for (let index = 0; index < slots; index += 1) {
    const nextTotal = selected.length + 1;
    const desiredAdvertised = Math.round(
      (nextTotal * postedTargetPercent) / 100
    );
    const preferAdvertised = selectedAdvertised < desiredAdvertised;
    const next = preferAdvertised
      ? (advertised.shift() ?? schools.shift())
      : (schools.shift() ?? advertised.shift());
    if (!next) {
      break;
    }
    selected.push(next);
    if (next.sourceKind === "advertised") {
      selectedAdvertised += 1;
    }
  }
  return selected;
}

export async function deliverReadyCampaignDispatches(env: AppEnv) {
  const rows = await env.DB.prepare(
    `SELECT d.id,c.user_id
       FROM campaign_dispatches d
       JOIN campaigns c ON c.id=d.campaign_id
       JOIN campaign_delivery_authorizations auth ON auth.user_id=c.user_id
      WHERE d.status='ready' AND d.run_id IS NOT NULL AND d.channel='email'
        AND c.status='running'
        AND auth.enabled=1 AND auth.authorized_scope='campaigns'
        AND NOT EXISTS (
          SELECT 1 FROM campaign_dispatch_targets dt
          JOIN campaign_targets target ON target.id=dt.target_id
          JOIN job_listings target_job ON target_job.id=target.job_id
          WHERE dt.dispatch_id=d.id AND target_job.inventory_status<>'active'
        )
      ORDER BY d.scheduled_for,d.created_at`
  ).all<{ id: string; user_id: string }>();
  const results = await Promise.allSettled(
    rows.results.map((row) =>
      deliverCampaignDispatchWithGmail(env, row.user_id, row.id)
    )
  );
  return {
    attempted: results.length,
    failed: results.filter((result) => result.status === "rejected").length,
    sent: results.filter((result) => result.status === "fulfilled").length,
  };
}

async function finishEmptyRun(
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

async function skipClaimedElsewhereDispatch(
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

function nextDailyRun(scheduledFor: string, now: Date) {
  const scheduled = new Date(scheduledFor);
  const anchor = Number.isNaN(scheduled.getTime())
    ? now.getTime()
    : Math.max(scheduled.getTime(), now.getTime());
  return new Date(anchor + ONE_DAY_MS).toISOString();
}

function pauseAtReplyThreshold(
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

function pauseCampaign(
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
