import { z } from "zod";
import {
  CampaignStatusSchema,
  CampaignTargetStatusSchema,
} from "../../../src/features/campaigns/schema";
import type {
  CampaignCounts,
  CampaignDispatch,
  CampaignMessage,
  CampaignSummary,
  CampaignTarget,
} from "../../../src/features/campaigns/types";
import { campaignDeliveryEnabled } from "../../repositories/campaign-delivery-authorization";
import { CampaignError, type CampaignRow, D1_ROW_SCHEMA } from "./model";

export async function campaignSummary(
  db: D1Database,
  row: CampaignRow
): Promise<CampaignSummary> {
  const [markets, countRows] = await Promise.all([
    db
      .prepare(
        `SELECT country_code,country_name FROM campaign_markets
          WHERE campaign_id=? ORDER BY country_name`
      )
      .bind(row.id)
      .all<{ country_code: string; country_name: string }>(),
    db
      .prepare(
        `SELECT source_kind,status,COUNT(*) count
           FROM campaign_targets WHERE campaign_id=?
          GROUP BY source_kind,status`
      )
      .bind(row.id)
      .all<{ count: number; source_kind: string; status: string }>(),
  ]);
  const counts = emptyCampaignCounts(Number(row.human_reply_count));
  for (const countRow of countRows.results) {
    const count = Number(countRow.count);
    counts.total += count;
    if (countRow.source_kind === "advertised") {
      counts.advertised += count;
    } else {
      counts.school += count;
    }
    if (countRow.status in counts) {
      const key = countRow.status as keyof CampaignCounts;
      counts[key] += count;
    }
    if (
      [
        "eligible",
        "calibration",
        "ready",
        "claimed",
        "drafted",
        "approved",
      ].includes(countRow.status)
    ) {
      counts.remaining += count;
    }
  }
  return {
    counts,
    createdAt: row.created_at,
    dailyPace: Number(row.daily_pace),
    id: row.id,
    liveDeliveryEnabled: await campaignDeliveryEnabled(db, row.user_id),
    markets: markets.results.map((market) => ({
      countryCode: market.country_code,
      countryName: market.country_name,
    })),
    name: row.name,
    nextRunAt: row.next_run_at,
    pauseReason: row.pause_reason,
    status: CampaignStatusSchema.parse(row.status),
    stopAfterHumanReplies: Number(row.stop_after_human_replies),
    updatedAt: row.updated_at,
  };
}

function emptyCampaignCounts(humanReplies: number): CampaignCounts {
  return {
    advertised: 0,
    approved: 0,
    calibration: 0,
    failed: 0,
    held: 0,
    humanReplies,
    ready: 0,
    remaining: 0,
    school: 0,
    sent: 0,
    total: 0,
  };
}

export async function readCampaignDispatches(
  db: D1Database,
  campaignId: string
): Promise<CampaignDispatch[]> {
  const rows = await db
    .prepare(
      `SELECT id,dedup_key,route_strategy,channel,recipient,subject,status,
              updated_at
         FROM campaign_dispatches
        WHERE campaign_id=?
        ORDER BY created_at,id`
    )
    .bind(campaignId)
    .all();
  return Promise.all(
    rows.results.map(async (rawRow) => {
      const row = D1_ROW_SCHEMA.parse(rawRow);
      const [targets, message] = await Promise.all([
        db
          .prepare(
            `${campaignTargetSelect()}
              JOIN campaign_dispatch_targets dt ON dt.target_id=t.id
             WHERE dt.dispatch_id=? ORDER BY dt.ordinal`
          )
          .bind(String(row.id))
          .all(),
        db
          .prepare(
            `SELECT id,dispatch_id,version,message,change_summary,status,created_at,
                    COALESCE((
                      SELECT previous.message FROM campaign_messages previous
                       WHERE previous.dispatch_id=campaign_messages.dispatch_id
                         AND previous.version<campaign_messages.version
                       ORDER BY previous.version DESC LIMIT 1
                    ),'') previous_message
               FROM campaign_messages
              WHERE dispatch_id=? AND status IN ('draft','approved','sent')
              ORDER BY version DESC LIMIT 1`
          )
          .bind(String(row.id))
          .first(),
      ]);
      return {
        channel: z
          .enum(["email", "board_form", "external_url", "manual"])
          .parse(row.channel),
        id: String(row.id),
        message: message ? mapCampaignMessage(message) : null,
        recipient: String(row.recipient),
        routeStrategy: z
          .enum(["single", "anesl_bundle"])
          .parse(row.route_strategy),
        status: String(row.status),
        subject: String(row.subject),
        targets: targets.results.map(mapCampaignTarget),
        updatedAt: String(row.updated_at),
      };
    })
  );
}

function mapCampaignMessage(rawRow: Record<string, unknown>): CampaignMessage {
  const row = D1_ROW_SCHEMA.parse(rawRow);
  return {
    changeSummary: String(row.change_summary),
    createdAt: String(row.created_at),
    dispatchId: String(row.dispatch_id),
    id: String(row.id),
    message: String(row.message),
    previousMessage: String(row.previous_message),
    status: z
      .enum(["draft", "approved", "superseded", "sent"])
      .parse(row.status),
    version: Number(row.version),
  };
}

export function campaignTargetSelect() {
  return `SELECT t.id,t.country_code,t.source_kind,t.route_strategy,t.channel,
                 t.status,t.hold_reason,t.match_label,t.match_score,t.updated_at,
                 j.title,j.company,j.location,j.board,j.source_url,
                 o.name organization_name,o.city,o.market_segment,o.website_url,
                 ar.destination route_destination,
                 cp.value contact_destination
            FROM campaign_targets t
            LEFT JOIN job_listings j ON j.id=t.job_id
            LEFT JOIN organizations o ON o.id=t.organization_id
            LEFT JOIN application_routes ar ON ar.id=t.route_id
            LEFT JOIN organization_contact_points cp ON cp.id=t.contact_point_id`;
}

export function mapCampaignTarget(
  rawRow: Record<string, unknown>
): CampaignTarget {
  const row = D1_ROW_SCHEMA.parse(rawRow);
  const isJob = row.source_kind === "advertised";
  const description = isJob
    ? [row.company, row.location, row.board]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .join(" · ")
    : [row.city, row.market_segment]
        .map((value) =>
          String(value ?? "")
            .trim()
            .replaceAll("_", " ")
        )
        .filter(Boolean)
        .join(" · ");
  return {
    channel: z
      .enum(["email", "board_form", "external_url", "manual"])
      .parse(row.channel),
    countryCode: String(row.country_code),
    description,
    destination: String(row.route_destination ?? row.contact_destination ?? ""),
    holdReason: String(row.hold_reason),
    id: String(row.id),
    label: String(isJob ? row.title : row.organization_name),
    matchLabel: String(row.match_label),
    matchScore:
      row.match_score === null || row.match_score === undefined
        ? null
        : Number(row.match_score),
    routeStrategy: z.enum(["single", "anesl_bundle"]).parse(row.route_strategy),
    sourceKind: z.enum(["advertised", "school"]).parse(row.source_kind),
    sourceUrl: String(isJob ? row.source_url : row.website_url),
    status: CampaignTargetStatusSchema.parse(row.status),
    updatedAt: String(row.updated_at),
  };
}

export async function requireCampaign(
  db: D1Database,
  userId: string,
  campaignId: string
) {
  const campaign = await db
    .prepare(
      `SELECT id,user_id,name,status,daily_pace,stop_after_human_replies,
              posted_target_percent,first_five_required,
              first_five_completed_at,human_reply_count,policy_snapshot_json,
              pause_reason,next_run_at,created_at,updated_at
         FROM campaigns WHERE id=? AND user_id=?`
    )
    .bind(campaignId, userId)
    .first<CampaignRow>();
  if (!campaign) {
    throw new CampaignError("Campaign was not found", 404);
  }
  return campaign;
}
