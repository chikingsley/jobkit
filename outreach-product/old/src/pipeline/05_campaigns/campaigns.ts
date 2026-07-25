import { z } from "zod";
import type { AppEnv } from "../../../worker/env";
import { readAutomationPolicy } from "../../../worker/repositories/automation-policy";
import { campaignDeliveryEnabled } from "../../../worker/repositories/campaign-delivery-authorization";
import {
  countryNameForCode,
  listCountryMarkets,
} from "../../../worker/services/country-markets";
import type { CampaignCreate } from "../../features/campaigns/schema";
import type {
  CampaignDetail,
  CampaignMarketOption,
  CampaignSummary,
} from "../../features/campaigns/types";
import { matchCampaignTargets } from "./campaign-matching";
import { readCampaignReplies, readCampaignRuns } from "./campaigns/decisions";
import { materializeCountryTargets } from "./campaigns/materialization";
import { type CampaignRow, D1_ROW_SCHEMA } from "./campaigns/model";
import {
  campaignSummary,
  readCampaignDispatches,
  requireCampaign,
} from "./campaigns/summary";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export {
  beginCampaignCalibration,
  decideCampaignTarget,
  listCampaignTargets,
  updateCampaignStatus,
} from "./campaigns/decisions";
export { campaignTargetPageSize } from "./campaigns/materialization";
export { CampaignError } from "./campaigns/model";

export async function readCampaignSetup(
  db: D1Database,
  userId: string
): Promise<{
  defaults: {
    dailyPace: number;
    firstFiveRequired: boolean;
    postedTargetPercent: number;
    stopAfterHumanReplies: number;
  };
  liveDeliveryEnabled: boolean;
  markets: CampaignMarketOption[];
}> {
  const [markets, policy, liveDeliveryEnabled] = await Promise.all([
    listCountryMarkets(db, userId),
    readAutomationPolicy(db, userId),
    campaignDeliveryEnabled(db, userId),
  ]);
  return {
    defaults: {
      dailyPace: policy.value.email.dailyLimit,
      firstFiveRequired: true,
      postedTargetPercent: 80,
      stopAfterHumanReplies: 3,
    },
    liveDeliveryEnabled,
    markets: markets.map((market) => ({
      countryCode: market.countryCode,
      countryName: market.countryName,
      latestSweepAt: market.latestSweepAt,
      latestSweepStatus: market.latestSweepStatus,
      openPositionCount: market.openPositionCount,
      organizationCount: market.organizationCount,
      verifiedContactCount: market.verifiedContactCount,
    })),
  };
}

export async function createCampaign(
  env: AppEnv,
  userId: string,
  input: CampaignCreate
) {
  const { DB: db } = env;
  const markets = input.countryCodes.map((countryCode) => ({
    countryCode,
    countryName: countryNameForCode(countryCode),
  }));
  const policy = (await readAutomationPolicy(db, userId)).value;
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const name =
    input.name?.trim() ||
    markets.map((market) => market.countryName).join(" + ");
  await db.batch([
    db
      .prepare(
        `INSERT INTO campaigns
          (id,user_id,name,status,daily_pace,stop_after_human_replies,
           posted_target_percent,first_five_required,policy_snapshot_json,
           created_at,updated_at)
         VALUES (?,?,?,'preparing',?,?,?,?,?,?,?)`
      )
      .bind(
        id,
        userId,
        name,
        input.dailyPace,
        input.stopAfterHumanReplies,
        input.postedTargetPercent,
        Number(input.firstFiveRequired),
        JSON.stringify(policy),
        timestamp,
        timestamp
      ),
    ...markets.map((market) =>
      db
        .prepare(
          `INSERT INTO campaign_markets
            (campaign_id,country_code,country_name,added_at)
           VALUES (?,?,?,?)`
        )
        .bind(id, market.countryCode, market.countryName, timestamp)
    ),
  ]);
  await Promise.all(
    markets.map((market) =>
      materializeCountryTargets(db, id, market.countryCode, policy, timestamp)
    )
  );
  await matchCampaignTargets(env, userId, id);
  return readCampaign(db, userId, id);
}

export async function listCampaigns(
  db: D1Database,
  userId: string
): Promise<CampaignSummary[]> {
  const rows = await db
    .prepare(
      `SELECT id,user_id,name,status,daily_pace,stop_after_human_replies,
              human_reply_count,pause_reason,next_run_at,created_at,updated_at
         FROM campaigns
        WHERE user_id=?
        ORDER BY CASE status
          WHEN 'running' THEN 0 WHEN 'paused' THEN 1 WHEN 'calibrating' THEN 2
          WHEN 'ready' THEN 3 WHEN 'preparing' THEN 4 WHEN 'draft' THEN 5
          ELSE 6 END,
          updated_at DESC`
    )
    .bind(userId)
    .all<CampaignRow>();
  return Promise.all(rows.results.map(async (row) => campaignSummary(db, row)));
}

export async function readCampaign(
  db: D1Database,
  userId: string,
  campaignId: string
): Promise<CampaignDetail> {
  const row = await requireCampaign(db, userId, campaignId);
  const [summary, dispatches, guidance, runs, replies] = await Promise.all([
    campaignSummary(db, row),
    readCampaignDispatches(db, campaignId),
    db
      .prepare(
        `SELECT id,instruction,scope,status,created_at
           FROM campaign_guidance
          WHERE campaign_id=?
          ORDER BY created_at DESC`
      )
      .bind(campaignId)
      .all(),
    readCampaignRuns(db, campaignId),
    readCampaignReplies(db, campaignId),
  ]);
  return {
    ...summary,
    dispatches,
    firstFiveCompletedAt: row.first_five_completed_at,
    firstFiveRequired: Boolean(row.first_five_required),
    guidance: guidance.results.map((rawRow) => {
      const item = D1_ROW_SCHEMA.parse(rawRow);
      return {
        createdAt: String(item.created_at),
        id: String(item.id),
        instruction: String(item.instruction),
        scope: z.enum(["message", "campaign", "future"]).parse(item.scope),
        status: z.enum(["accepted", "proposed", "rejected"]).parse(item.status),
      };
    }),
    postedTargetPercent: Number(row.posted_target_percent),
    replies,
    runs,
  };
}
