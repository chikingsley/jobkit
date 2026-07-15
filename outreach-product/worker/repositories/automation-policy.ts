import {
  type AutomationPolicy,
  AutomationPolicySchema,
  defaultAutomationPolicy,
} from "../../src/features/automation/schema";

interface AutomationPolicyRow {
  allowed_boards_json: string;
  daily_application_limit: number;
  minimum_fit: string;
  mode: string;
  require_known_compensation: number;
  updated_at: string;
}

export async function readAutomationPolicy(db: D1Database, userId: string) {
  const row = await db
    .prepare(
      `SELECT mode,allowed_boards_json,minimum_fit,daily_application_limit,
              require_known_compensation,updated_at
       FROM user_automation_policies WHERE user_id=?`
    )
    .bind(userId)
    .first<AutomationPolicyRow>();
  if (!row) {
    return { updatedAt: null, value: defaultAutomationPolicy };
  }
  const value = AutomationPolicySchema.parse({
    allowedBoards: JSON.parse(row.allowed_boards_json),
    dailyApplicationLimit: row.daily_application_limit,
    minimumFit: row.minimum_fit,
    mode: row.mode,
    requireKnownCompensation: Boolean(row.require_known_compensation),
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
        (user_id,mode,allowed_boards_json,minimum_fit,daily_application_limit,
         require_known_compensation,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET
         mode=excluded.mode,
         allowed_boards_json=excluded.allowed_boards_json,
         minimum_fit=excluded.minimum_fit,
         daily_application_limit=excluded.daily_application_limit,
         require_known_compensation=excluded.require_known_compensation,
         updated_at=excluded.updated_at`
    )
    .bind(
      userId,
      policy.mode,
      JSON.stringify(policy.allowedBoards),
      policy.minimumFit,
      policy.dailyApplicationLimit,
      Number(policy.requireKnownCompensation),
      updatedAt,
      updatedAt
    )
    .run();
  return { updatedAt, value: policy };
}
