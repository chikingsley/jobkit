import { z } from "zod";
import {
  APPLICATION_MESSAGE_TASK_TYPE,
  type ApplicationMessageRequestInput,
} from "../../src/agent-tasks/application-message";
import type { AutomationPolicy } from "../../src/features/automation/schema";
import type {
  CampaignCreate,
  CampaignStatus,
  CampaignTargetDecision,
} from "../../src/features/campaigns/schema";
import {
  CampaignStatusSchema,
  CampaignTargetStatusSchema,
} from "../../src/features/campaigns/schema";
import type {
  CampaignCounts,
  CampaignDetail,
  CampaignDispatch,
  CampaignMarketOption,
  CampaignMessage,
  CampaignReplyEvent,
  CampaignRun,
  CampaignSummary,
  CampaignTarget,
  CampaignTargetPage,
} from "../../src/features/campaigns/types";
import { readAutomationPolicy } from "../repositories/automation-policy";
import { campaignDeliveryEnabled } from "../repositories/campaign-delivery-authorization";
import { buildAgentTaskRequestCreation } from "./agent-task-requests";
import { matchCampaignTargets } from "./campaign-matching";
import {
  countryNameForCode,
  countryNamesForCode,
  listCountryMarkets,
} from "./country-markets";

const D1_ROW_SCHEMA = z.record(z.string(), z.unknown());
const CAMPAIGN_TARGET_PAGE_SIZE = 100;

interface CampaignRow {
  created_at: string;
  daily_pace: number;
  first_five_completed_at: string | null;
  first_five_required: number;
  human_reply_count: number;
  id: string;
  name: string;
  next_run_at: string | null;
  pause_reason: string;
  posted_target_percent: number;
  status: string;
  stop_after_human_replies: number;
  updated_at: string;
  user_id: string;
}

interface TargetSeedRow {
  channel: string;
  country_code: string;
  dedup_key: string;
  id: string;
  route_strategy: "anesl_bundle" | "single";
  source_kind: "advertised" | "school";
}

export class CampaignError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409) {
    super(message);
    this.status = status;
  }
}

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
  db: D1Database,
  userId: string,
  input: CampaignCreate
) {
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
  await matchCampaignTargets(db, userId, id);
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

async function readCampaignRuns(
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

async function readCampaignReplies(
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
      `SELECT id,country_code,source_kind,dedup_key,route_strategy,channel
         FROM campaign_targets
        WHERE campaign_id=? AND status='eligible'
        ORDER BY admitted_at,id`
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

async function campaignSummary(
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

async function readCampaignDispatches(
  db: D1Database,
  campaignId: string
): Promise<CampaignDispatch[]> {
  const rows = await db
    .prepare(
      `SELECT id,dedup_key,route_strategy,channel,recipient,subject,status,
              updated_at
         FROM campaign_dispatches
        WHERE campaign_id=?
        ORDER BY CASE status WHEN 'calibration' THEN 0 WHEN 'review' THEN 1
          WHEN 'ready' THEN 2 ELSE 3 END,created_at`
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

function campaignTargetSelect() {
  return `SELECT t.id,t.country_code,t.source_kind,t.route_strategy,t.channel,
                 t.status,t.hold_reason,t.match_label,t.match_score,t.updated_at,
                 j.title,j.company,j.location,j.board,j.source_url,
                 o.name organization_name,o.city,o.market_segment,o.website_url,
                 ar.destination route_destination,
                 cp.value contact_destination
            FROM campaign_targets t
            LEFT JOIN jobs j ON j.id=t.job_id
            LEFT JOIN organizations o ON o.id=t.organization_id
            LEFT JOIN application_routes ar ON ar.id=t.route_id
            LEFT JOIN organization_contact_points cp ON cp.id=t.contact_point_id`;
}

function mapCampaignTarget(rawRow: Record<string, unknown>): CampaignTarget {
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

async function requireCampaign(
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

async function materializeCountryTargets(
  db: D1Database,
  campaignId: string,
  countryCode: string,
  policy: AutomationPolicy,
  timestamp: string
) {
  const countryNames = countryNamesForCode(countryCode);
  const placeholders = countryNames.map(() => "?").join(",");
  const allowedBoards = JSON.stringify(
    policy.allowedBoards.map((board) => board.toLowerCase())
  );
  const excludedSegments = JSON.stringify(policy.excludedMarketSegments);
  const freshnessThreshold = new Date(
    new Date(timestamp).getTime() - policy.routeFreshnessDays * 86_400_000
  ).toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO campaign_targets
          (id,campaign_id,country_code,source_kind,subject_kind,subject_id,
           job_id,route_id,contact_channel_id,channel,route_strategy,dedup_key,
           status,hold_reason,match_label,admitted_at,updated_at)
         SELECT
           lower(hex(randomblob(16))),?,?,'advertised','job',j.id,j.id,ar.id,
           ar.contact_channel_id,
           CASE ar.kind
             WHEN 'email' THEN 'email'
             WHEN 'board_form' THEN 'board_form'
             WHEN 'external_url' THEN 'external_url'
             ELSE 'manual'
           END,
           CASE WHEN lower(j.board)='anesl' THEN 'anesl_bundle' ELSE 'single' END,
           CASE
             WHEN ar.contact_channel_id IS NOT NULL
               THEN 'contact:' || ar.contact_channel_id
             WHEN ar.kind='email' THEN 'email:' || lower(trim(ar.destination))
             WHEN ar.id IS NOT NULL THEN 'route:' || ar.id
             ELSE 'job:' || j.id
           END,
           CASE
             WHEN ar.id IS NULL OR ar.kind<>'email' THEN 'held'
             WHEN json_array_length(?)>0 AND lower(j.board) NOT IN (
               SELECT lower(value) FROM json_each(?)
             ) THEN 'held'
             WHEN EXISTS (
               SELECT 1 FROM json_each(j.market_segments_json) segment
                WHERE segment.value IN (SELECT value FROM json_each(?))
             ) THEN 'held'
             WHEN ?=1 AND j.compensation_amount_min IS NULL
               AND j.compensation_amount_max IS NULL THEN 'held'
             WHEN COALESCE(ar.last_verified_at,'')<? THEN 'held'
             ELSE 'eligible'
           END,
           CASE
             WHEN ar.id IS NULL THEN 'No active application route'
             WHEN ar.kind<>'email' THEN 'Manual application route; open it from Jobs'
             WHEN json_array_length(?)>0 AND lower(j.board) NOT IN (
               SELECT lower(value) FROM json_each(?)
             ) THEN 'Board is outside the saved automation policy'
             WHEN EXISTS (
               SELECT 1 FROM json_each(j.market_segments_json) segment
                WHERE segment.value IN (SELECT value FROM json_each(?))
             ) THEN 'Excluded market segment in the saved automation policy'
             WHEN ?=1 AND j.compensation_amount_min IS NULL
               AND j.compensation_amount_max IS NULL
               THEN 'Compensation is required by the saved automation policy'
             WHEN COALESCE(ar.last_verified_at,'')<?
               THEN 'Application route needs verification'
             ELSE ''
           END,
           CASE
             WHEN ar.id IS NULL OR ar.kind<>'email' THEN 'Manual review'
             ELSE ''
           END,
           ?,?
         FROM jobs j
         LEFT JOIN application_routes ar ON ar.id=(
           SELECT candidate.id FROM application_routes candidate
            WHERE candidate.job_id=j.id AND candidate.status='active'
            ORDER BY CASE candidate.kind
              WHEN 'email' THEN 0 WHEN 'board_form' THEN 1
              WHEN 'external_url' THEN 2 ELSE 3 END,
              candidate.last_verified_at DESC,candidate.updated_at DESC
            LIMIT 1
         )
         WHERE lower(trim(j.country)) IN (${placeholders})`
      )
      .bind(
        campaignId,
        countryCode,
        allowedBoards,
        allowedBoards,
        excludedSegments,
        Number(policy.requireKnownCompensation),
        freshnessThreshold,
        allowedBoards,
        allowedBoards,
        excludedSegments,
        Number(policy.requireKnownCompensation),
        freshnessThreshold,
        timestamp,
        timestamp,
        ...countryNames
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO campaign_targets
          (id,campaign_id,country_code,source_kind,subject_kind,subject_id,
           organization_id,contact_point_id,channel,route_strategy,dedup_key,
           status,hold_reason,match_label,admitted_at,updated_at)
         SELECT
           lower(hex(randomblob(16))),?,?,'school','organization',o.id,o.id,
           cp.id,'email','single','email:' || lower(trim(cp.value)),
           CASE
             WHEN o.market_segment IN (SELECT value FROM json_each(?))
               THEN 'held'
             ELSE 'eligible'
           END,
           CASE
             WHEN o.market_segment IN (SELECT value FROM json_each(?))
               THEN 'Excluded market segment in the saved automation policy'
             ELSE ''
           END,
           CASE
             WHEN o.market_segment IN (SELECT value FROM json_each(?))
               THEN 'Excluded market segment'
             ELSE 'Eligible outreach'
           END,
           ?,?
         FROM organizations o
         JOIN organization_contact_points cp ON cp.id=(
           SELECT candidate.id FROM organization_contact_points candidate
            WHERE candidate.organization_id=o.id
              AND candidate.kind='email' AND candidate.status='active'
            ORDER BY candidate.last_verified_at DESC,candidate.updated_at DESC
            LIMIT 1
         )
         WHERE o.country_code=? AND o.status='active'
           AND o.outreach_eligibility='eligible'`
      )
      .bind(
        campaignId,
        countryCode,
        JSON.stringify(policy.excludedMarketSegments),
        JSON.stringify(policy.excludedMarketSegments),
        JSON.stringify(policy.excludedMarketSegments),
        timestamp,
        timestamp,
        countryCode
      ),
  ]);
}

interface CalibrationGroup {
  channel: string;
  dedupKey: string;
  routeStrategy: "anesl_bundle" | "single";
  targets: TargetSeedRow[];
}

function selectCalibrationGroups(
  seeds: TargetSeedRow[],
  count: number
): CalibrationGroup[] {
  const grouped = new Map<string, TargetSeedRow[]>();
  for (const seed of seeds) {
    const group = grouped.get(seed.dedup_key) ?? [];
    if (seed.route_strategy === "anesl_bundle" && group.length >= 5) {
      continue;
    }
    group.push(seed);
    grouped.set(seed.dedup_key, group);
  }
  const candidates = [...grouped.values()].map((targets) => ({
    channel: targets[0]?.channel ?? "manual",
    countryCode: targets[0]?.country_code ?? "",
    dedupKey: targets[0]?.dedup_key ?? "",
    routeStrategy: targets[0]?.route_strategy ?? "single",
    sourceKind: targets[0]?.source_kind ?? "advertised",
    targets:
      targets[0]?.route_strategy === "anesl_bundle"
        ? targets
        : targets.slice(0, 1),
  }));
  const selected: typeof candidates = [];
  const dimensions = [
    ...new Set(
      candidates.map(
        (candidate) => `${candidate.countryCode}:${candidate.sourceKind}`
      )
    ),
  ];
  while (selected.length < count) {
    let changed = false;
    for (const dimension of dimensions) {
      const candidate = candidates.find(
        (item) =>
          `${item.countryCode}:${item.sourceKind}` === dimension &&
          !selected.includes(item)
      );
      if (candidate) {
        selected.push(candidate);
        changed = true;
      }
      if (selected.length >= count) {
        break;
      }
    }
    if (!changed) {
      break;
    }
  }
  return selected;
}

function campaignTransition(
  current: CampaignStatus,
  action: "cancel" | "pause" | "resume" | "start"
): CampaignStatus {
  if (action === "cancel" && !["completed", "canceled"].includes(current)) {
    return "canceled";
  }
  if (action === "pause" && current === "running") {
    return "paused";
  }
  if (action === "resume" && current === "paused") {
    return "running";
  }
  if (action === "start" && current === "ready") {
    return "running";
  }
  throw new CampaignError(`A ${current} campaign cannot ${action}`, 409);
}

export function campaignTargetPageSize() {
  return CAMPAIGN_TARGET_PAGE_SIZE;
}
