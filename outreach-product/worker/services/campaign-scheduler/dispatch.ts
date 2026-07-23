import type { AppEnv } from "../../env";
import {
  acquireOutboundRecipientClaim,
  OutboundRecipientClaimError,
} from "../../repositories/outbound-recipient-claims";
import { deliverCampaignDispatchWithGmail } from "../campaign-email-attempts";
import { skipClaimedElsewhereDispatch } from "./completion";
import type { DispatchGroup, DispatchSeed, DueCampaignRow } from "./model";

export async function claimDispatchGroup(
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

export function skipDuplicateTargetsStatement(
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

export async function readyDispatchGroups(db: D1Database, campaignId: string) {
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

export async function eligibleDispatchGroups(
  db: D1Database,
  campaignId: string
) {
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

export function selectDispatchPlan(
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
