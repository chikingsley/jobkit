import {
  type AutomationPolicy,
  AutomationPolicySchema,
  defaultAutomationPolicy,
} from "../../src/features/automation/schema";

interface AutomationPolicyRow {
  allowed_boards_json: string;
  board_form_daily_limit: number;
  board_form_mode: string;
  email_daily_limit: number;
  email_mode: string;
  excluded_market_segments_json: string;
  follow_up_delays_json: string;
  minimum_fit: string;
  paused: number;
  require_known_compensation: number;
  route_freshness_days: number;
  updated_at: string;
}

export async function readAutomationPolicy(db: D1Database, userId: string) {
  const row = await db
    .prepare(
      `SELECT email_mode,email_daily_limit,board_form_mode,board_form_daily_limit,
              allowed_boards_json,excluded_market_segments_json,
              follow_up_delays_json,minimum_fit,
              require_known_compensation,route_freshness_days,paused,updated_at
       FROM user_automation_policies WHERE user_id=?`
    )
    .bind(userId)
    .first<AutomationPolicyRow>();
  if (!row) {
    return { updatedAt: null, value: defaultAutomationPolicy };
  }
  const value = AutomationPolicySchema.parse({
    allowedBoards: JSON.parse(row.allowed_boards_json),
    boardForm: {
      dailyLimit: row.board_form_daily_limit,
      mode: row.board_form_mode,
    },
    email: { dailyLimit: row.email_daily_limit, mode: row.email_mode },
    excludedMarketSegments: JSON.parse(row.excluded_market_segments_json),
    followUpDelaysDays: JSON.parse(row.follow_up_delays_json),
    minimumFit: row.minimum_fit,
    paused: Boolean(row.paused),
    requireKnownCompensation: Boolean(row.require_known_compensation),
    routeFreshnessDays: row.route_freshness_days,
  });
  return { updatedAt: row.updated_at, value };
}

export async function writeAutomationPolicy(
  db: D1Database,
  userId: string,
  input: unknown
) {
  const policy: AutomationPolicy = AutomationPolicySchema.parse(input);
  const updatedAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO user_automation_policies
        (user_id,email_mode,email_daily_limit,board_form_mode,
         board_form_daily_limit,allowed_boards_json,
         excluded_market_segments_json,follow_up_delays_json,minimum_fit,
         require_known_compensation,route_freshness_days,paused,created_at,
         updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET
         email_mode=excluded.email_mode,
         email_daily_limit=excluded.email_daily_limit,
         board_form_mode=excluded.board_form_mode,
         board_form_daily_limit=excluded.board_form_daily_limit,
         allowed_boards_json=excluded.allowed_boards_json,
         excluded_market_segments_json=excluded.excluded_market_segments_json,
         follow_up_delays_json=excluded.follow_up_delays_json,
         minimum_fit=excluded.minimum_fit,
         require_known_compensation=excluded.require_known_compensation,
         route_freshness_days=excluded.route_freshness_days,
         paused=excluded.paused,
         updated_at=excluded.updated_at`
    )
    .bind(
      userId,
      policy.email.mode,
      policy.email.dailyLimit,
      policy.boardForm.mode,
      policy.boardForm.dailyLimit,
      JSON.stringify(policy.allowedBoards),
      JSON.stringify(policy.excludedMarketSegments),
      JSON.stringify(policy.followUpDelaysDays),
      policy.minimumFit,
      Number(policy.requireKnownCompensation),
      policy.routeFreshnessDays,
      Number(policy.paused),
      updatedAt,
      updatedAt
    )
    .run();
  return { updatedAt, value: policy };
}
