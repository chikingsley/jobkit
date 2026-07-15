import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../src/features/matching/version";
import { extractJobMatchFacts, jobSourceHash } from "../ai/job-fact-extraction";
import type { AiModelSelection } from "../ai/model-catalog";
import type { AppEnv } from "../env";
import { readAiModel } from "../repositories/ai-model-settings";
import {
  readJobMatchFacts,
  writeJobMatchFacts,
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
  const result = await extractJobMatchFacts(env, model, job);
  await writeJobMatchFacts(
    env.DB,
    job.id,
    result,
    JOB_MATCH_FACTS_SCHEMA_VERSION
  );
  return true;
}

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
    if (await ensureJobMatchFacts(env, model, jobImportFromRow(row))) {
      analyzed += 1;
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
    priority: row.priority,
    salary: row.salary,
    sourceUrl: row.source_url,
    title: row.title,
  });
}
