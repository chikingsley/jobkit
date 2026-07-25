import { monthlyCompensationUsd } from "../../src/features/jobs/compensation";
import type { FxData, Job } from "../../src/features/jobs/types";
import type { QualificationClaims } from "../../src/features/matching/claims";
import { evaluateJob } from "../../src/features/matching/evaluate";
import type {
  Preferences,
  Profile,
  StoredDocument,
} from "../../src/profile-types";
import type { AppEnv } from "../env";
import { readQualificationClaims } from "../repositories/qualification-claims";
import { readPreferences, readProfile } from "../repositories/user-settings";
import { fetchExchangeRates } from "./lookups";

export interface MatchingContext {
  claims: QualificationClaims;
  documents: StoredDocument[];
  fx: FxData;
  preferences: Preferences;
  profile: Profile;
}

export async function readMatchingContext(env: AppEnv, userId: string) {
  const [profile, preferences, documents, claims, fx] = await Promise.all([
    readProfile(env.DB, userId),
    readPreferences(env.DB, userId),
    readDocuments(env.DB, userId),
    readQualificationClaims(env.DB, userId),
    currentFxData(env),
  ]);
  return {
    claims,
    documents,
    fx,
    preferences: preferences.value,
    profile: profile.value,
  } satisfies MatchingContext;
}

export function evaluateJobWithContext(job: Job, context: MatchingContext) {
  return evaluateJob(
    job,
    context.profile,
    context.preferences,
    monthlyCompensationUsd(job.compensation, context.fx),
    context.documents,
    context.claims
  );
}

export async function currentFxData(env: AppEnv): Promise<FxData> {
  if (env.FX_RATES_JSON) {
    const rates = JSON.parse(env.FX_RATES_JSON) as unknown;
    if (!isRateTable(rates)) {
      throw new Error("Configured exchange rates are invalid");
    }
    return { rates, updatedAt: "configured" };
  }
  try {
    const result = await fetchExchangeRates();
    return { rates: result.rates, updatedAt: result.updatedAt };
  } catch {
    return { rates: { USD: 1 }, updatedAt: null };
  }
}

async function readDocuments(db: D1Database, userId: string) {
  const rows = await db
    .prepare(
      `SELECT id,category,filename,content_type,size_bytes,is_default,created_at
         FROM user_documents
        WHERE user_id=? AND archived_at IS NULL AND category<>'test_lab'
        ORDER BY created_at`
    )
    .bind(userId)
    .all<StoredDocument>();
  return rows.results;
}

function isRateTable(value: unknown): value is Record<string, number> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.entries(value).every(
      ([currency, rate]) =>
        currency.length === 3 && typeof rate === "number" && rate > 0
    )
  );
}
