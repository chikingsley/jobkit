import { eq } from "drizzle-orm";
import {
  type AutomationPolicy,
  AutomationPolicySchema,
  defaultAutomationPolicy,
} from "../../src/features/automation/schema";
import { excluded, getDb } from "../db/client";
import { userAutomationPolicies } from "../db/schema/user-profile";

export async function readAutomationPolicy(db: D1Database, userId: string) {
  const row = await getDb(db)
    .select({
      allowedBoardsJson: userAutomationPolicies.allowedBoardsJson,
      boardFormDailyLimit: userAutomationPolicies.boardFormDailyLimit,
      boardFormMode: userAutomationPolicies.boardFormMode,
      emailDailyLimit: userAutomationPolicies.emailDailyLimit,
      emailMode: userAutomationPolicies.emailMode,
      excludedMarketSegmentsJson:
        userAutomationPolicies.excludedMarketSegmentsJson,
      followUpDelaysJson: userAutomationPolicies.followUpDelaysJson,
      minimumFit: userAutomationPolicies.minimumFit,
      paused: userAutomationPolicies.paused,
      requireKnownCompensation: userAutomationPolicies.requireKnownCompensation,
      routeFreshnessDays: userAutomationPolicies.routeFreshnessDays,
      updatedAt: userAutomationPolicies.updatedAt,
    })
    .from(userAutomationPolicies)
    .where(eq(userAutomationPolicies.userId, userId))
    .get();
  if (!row) {
    return { updatedAt: null, value: defaultAutomationPolicy };
  }
  const value = AutomationPolicySchema.parse({
    allowedBoards: JSON.parse(row.allowedBoardsJson),
    boardForm: {
      dailyLimit: row.boardFormDailyLimit,
      mode: row.boardFormMode,
    },
    email: { dailyLimit: row.emailDailyLimit, mode: row.emailMode },
    excludedMarketSegments: JSON.parse(row.excludedMarketSegmentsJson),
    followUpDelaysDays: JSON.parse(row.followUpDelaysJson),
    minimumFit: row.minimumFit,
    paused: Boolean(row.paused),
    requireKnownCompensation: Boolean(row.requireKnownCompensation),
    routeFreshnessDays: row.routeFreshnessDays,
  });
  return { updatedAt: row.updatedAt, value };
}

export async function writeAutomationPolicy(
  db: D1Database,
  userId: string,
  input: unknown
) {
  const policy: AutomationPolicy = AutomationPolicySchema.parse(input);
  const updatedAt = new Date().toISOString();
  await getDb(db)
    .insert(userAutomationPolicies)
    .values({
      allowedBoardsJson: JSON.stringify(policy.allowedBoards),
      boardFormDailyLimit: policy.boardForm.dailyLimit,
      boardFormMode: policy.boardForm.mode,
      createdAt: updatedAt,
      emailDailyLimit: policy.email.dailyLimit,
      emailMode: policy.email.mode,
      excludedMarketSegmentsJson: JSON.stringify(policy.excludedMarketSegments),
      followUpDelaysJson: JSON.stringify(policy.followUpDelaysDays),
      minimumFit: policy.minimumFit,
      paused: Number(policy.paused),
      requireKnownCompensation: Number(policy.requireKnownCompensation),
      routeFreshnessDays: policy.routeFreshnessDays,
      updatedAt,
      userId,
    })
    .onConflictDoUpdate({
      set: {
        allowedBoardsJson: excluded(userAutomationPolicies.allowedBoardsJson),
        boardFormDailyLimit: excluded(
          userAutomationPolicies.boardFormDailyLimit
        ),
        boardFormMode: excluded(userAutomationPolicies.boardFormMode),
        emailDailyLimit: excluded(userAutomationPolicies.emailDailyLimit),
        emailMode: excluded(userAutomationPolicies.emailMode),
        excludedMarketSegmentsJson: excluded(
          userAutomationPolicies.excludedMarketSegmentsJson
        ),
        followUpDelaysJson: excluded(userAutomationPolicies.followUpDelaysJson),
        minimumFit: excluded(userAutomationPolicies.minimumFit),
        paused: excluded(userAutomationPolicies.paused),
        requireKnownCompensation: excluded(
          userAutomationPolicies.requireKnownCompensation
        ),
        routeFreshnessDays: excluded(userAutomationPolicies.routeFreshnessDays),
        updatedAt: excluded(userAutomationPolicies.updatedAt),
      },
      target: userAutomationPolicies.userId,
    })
    .run();
  return { updatedAt, value: policy };
}
