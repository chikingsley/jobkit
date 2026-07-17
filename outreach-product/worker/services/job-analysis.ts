import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../src/features/matching/version";
import {
  extractJobMatchFactsWithFallback,
  JobFactExtractionError,
  jobSourceHash,
} from "../ai/job-fact-extraction";
import type { AiModelSelection } from "../ai/model-catalog";
import type { AppEnv } from "../env";
import { readAiModel } from "../repositories/ai-model-settings";
import {
  jobMatchFactsStatement,
  readJobMatchFacts,
} from "../repositories/job-match-facts";
import { type JobImport, JobImportSchema } from "../schemas";

export async function ensureJobMatchFacts(
  env: AppEnv,
  model: AiModelSelection,
  job: JobImport
) {
  const [current, sourceHash] = await Promise.all([
    readJobMatchFacts(env.DB, job.id, JOB_MATCH_FACTS_SCHEMA_VERSION),
    jobSourceHash(job),
  ]);
  if (current?.sourceHash === sourceHash) {
    return false;
  }
  const result = await extractJobMatchFactsWithFallback(env, model, job);
  await jobMatchFactsStatement(
    env.DB,
    job.id,
    result,
    JOB_MATCH_FACTS_SCHEMA_VERSION
  ).run();
  return true;
}

export async function ensureJobMatchFactsForImport(
  env: AppEnv,
  model: AiModelSelection,
  job: JobImport
) {
  try {
    return await ensureJobMatchFacts(env, model, job);
  } catch (error) {
    if (!(error instanceof JobFactExtractionError)) {
      throw error;
    }
    // Match facts are derived metadata. A provider failure must not discard a
    // verified job route or an otherwise valid application draft.
    return false;
  }
}

const MAX_ANALYSES_PER_REQUEST = 4;

export async function analyzeUserJobs(env: AppEnv, userId: string) {
  const [model, rows] = await Promise.all([
    readAiModel(env.DB, "job_fact_extraction"),
    env.DB.prepare(
      `SELECT j.*,uj.priority
         FROM user_jobs uj
         JOIN jobs j ON j.id=uj.job_id
         WHERE uj.user_id=?
         ORDER BY uj.updated_at DESC`
    )
      .bind(userId)
      .all(),
  ]);
  let analyzed = 0;
  for (const row of rows.results) {
    // biome-ignore lint/performance/noAwaitInLoops: Stop after four newly analyzed rows; later iterations depend on whether earlier rows already had facts.
    if (await ensureJobMatchFacts(env, model, jobImportFromRow(row))) {
      analyzed += 1;
      if (analyzed === MAX_ANALYSES_PER_REQUEST) {
        break;
      }
    }
  }
  return analyzed;
}

function jobImportFromRow(row: Record<string, unknown>): JobImport {
  return JobImportSchema.parse({
    applyUrl: row.apply_url,
    board: row.board,
    company: row.company,
    country: row.country,
    description: row.description,
    employerId: row.employer_id,
    id: row.id,
    location: row.location,
    marketSegments: JSON.parse(String(row.market_segments_json)),
    messageRoute: row.message_route,
    opportunityScope: row.opportunity_scope,
    priority: row.priority,
    salary: row.salary,
    sourceUrl: row.source_url,
    title: row.title,
  });
}
