import type { Profile } from "../../src/features/profile/schema";
import {
  generateApplicationMessage,
  reviseApplicationMessage,
} from "../ai/application-messages";
import type { AppEnv } from "../env";
import {
  readAiModel,
  readApplicationMessageModel,
} from "../repositories/ai-model-settings";
import { recordJobEvent } from "../repositories/job-events";
import { upsertJob, upsertUserJob } from "../repositories/jobs";
import { readProfile } from "../repositories/user-settings";
import { type JobImport, JobImportSchema } from "../schemas";
import { ensureJobMatchFacts } from "./job-analysis";

export class DraftProfileRequiredError extends Error {}

export async function regenerateDrafts(
  env: AppEnv,
  userId: string
): Promise<number> {
  const [model, profile] = await Promise.all([
    readApplicationMessageModel(env.DB),
    savedProfile(env.DB, userId),
  ]);
  const rows = await env.DB.prepare(
    `SELECT j.*,uj.id user_job_id,uj.priority
       FROM user_jobs uj
       JOIN jobs j ON j.id=uj.job_id
       WHERE uj.user_id=? AND uj.status IN ('new','review')`
  )
    .bind(userId)
    .all();
  let regenerated = 0;
  for (const row of rows.results) {
    const job = toJobImport(row);
    const userJobId = String(row.user_job_id);
    const latest = await env.DB.prepare(
      "SELECT version FROM application_drafts WHERE user_job_id=? ORDER BY version DESC LIMIT 1"
    )
      .bind(userJobId)
      .first<{ version: number }>();
    const draft = await generateApplicationMessage(env, model, job, profile);
    const timestamp = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO application_drafts (id,user_job_id,version,message,change_summary,model_provider,model_id,created_at) VALUES (?,?,?,?,?,?,?,?)"
      ).bind(
        crypto.randomUUID(),
        userJobId,
        (latest?.version ?? 0) + 1,
        draft.message,
        draft.summary,
        draft.provider,
        draft.modelId,
        timestamp
      ),
      env.DB.prepare(
        "UPDATE user_jobs SET status='review',updated_at=? WHERE id=? AND user_id=?"
      ).bind(timestamp, userJobId, userId),
    ]);
    regenerated += 1;
  }
  return regenerated;
}

export async function importJobsWithDrafts(
  env: AppEnv,
  userId: string,
  jobs: JobImport[]
): Promise<void> {
  const [model, factsModel, profile] = await Promise.all([
    readApplicationMessageModel(env.DB),
    readAiModel(env.DB, "job_fact_extraction"),
    savedProfile(env.DB, userId),
  ]);
  for (const job of jobs) {
    const timestamp = new Date().toISOString();
    await upsertJob(env.DB, job, timestamp);
    const userJobId = await upsertUserJob(
      env.DB,
      userId,
      job.id,
      job.priority,
      timestamp
    );
    const existing = await env.DB.prepare(
      "SELECT id FROM application_drafts WHERE user_job_id=? ORDER BY version DESC LIMIT 1"
    )
      .bind(userJobId)
      .first();
    if (existing) {
      await ensureJobMatchFacts(env, factsModel, job);
      continue;
    }
    const [draft] = await Promise.all([
      generateApplicationMessage(env, model, job, profile),
      ensureJobMatchFacts(env, factsModel, job),
    ]);
    await env.DB.prepare(
      "INSERT INTO application_drafts (id,user_job_id,version,message,change_summary,model_provider,model_id,created_at) VALUES (?,?,?,?,?,?,?,?)"
    )
      .bind(
        crypto.randomUUID(),
        userJobId,
        1,
        draft.message,
        draft.summary,
        draft.provider,
        draft.modelId,
        timestamp
      )
      .run();
    await recordJobEvent(
      env.DB,
      userJobId,
      "draft_generated",
      `Automatic tailored draft created with ${draft.provider}/${draft.modelId}`
    );
  }
}

export async function reviseJobDraft(
  env: AppEnv,
  userId: string,
  jobId: string,
  instruction: string
) {
  const [model, profile, row] = await Promise.all([
    readApplicationMessageModel(env.DB),
    savedProfile(env.DB, userId),
    currentJobAndDraft(env.DB, userId, jobId),
  ]);
  const revised = await reviseApplicationMessage(
    env,
    model,
    row.job,
    profile,
    row.message,
    instruction
  );
  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE application_drafts SET status='superseded' WHERE user_job_id=? AND status='draft'"
    ).bind(row.userJobId),
    env.DB.prepare(
      "INSERT INTO application_drafts (id,user_job_id,version,message,change_summary,revision_instruction,model_provider,model_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(
      draftId,
      row.userJobId,
      row.version + 1,
      revised.message,
      revised.summary,
      instruction,
      revised.provider,
      revised.modelId,
      timestamp
    ),
    env.DB.prepare(
      "UPDATE user_jobs SET status='review',updated_at=? WHERE id=? AND user_id=?"
    ).bind(timestamp, row.userJobId, userId),
  ]);
  await recordJobEvent(
    env.DB,
    row.userJobId,
    "draft_revised",
    revised.summary,
    draftId
  );
  return revised;
}

async function currentJobAndDraft(
  db: D1Database,
  userId: string,
  jobId: string
) {
  const row = await db
    .prepare(
      `SELECT j.*,uj.id user_job_id,uj.priority,d.version,d.message
       FROM user_jobs uj
       JOIN jobs j ON j.id=uj.job_id
       JOIN application_drafts d ON d.user_job_id=uj.id
       WHERE uj.user_id=? AND j.id=?
       ORDER BY d.version DESC LIMIT 1`
    )
    .bind(userId, jobId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new Error("Job or draft not found");
  }
  return {
    job: toJobImport(row),
    message: String(row.message),
    userJobId: String(row.user_job_id),
    version: Number(row.version),
  };
}

async function savedProfile(db: D1Database, userId: string): Promise<Profile> {
  const profile = await readProfile(db, userId);
  if (!profile.updatedAt) {
    throw new DraftProfileRequiredError(
      "Save a profile before generating or revising drafts"
    );
  }
  return profile.value;
}

function toJobImport(row: Record<string, unknown>): JobImport {
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
