import type { Profile } from "../../src/features/profile/schema";
import { generateDraft, reviseDraft } from "../ai/drafts";
import type { AppEnv } from "../env";
import { recordJobEvent } from "../repositories/job-events";
import { upsertJob } from "../repositories/jobs";
import { readProfile } from "../repositories/user-settings";
import { type JobImport, JobImportSchema } from "../schemas";

export class DraftProfileRequiredError extends Error {}

export async function regenerateDrafts(env: AppEnv): Promise<number> {
  const profile = await savedProfile(env.DB);
  const rows = await env.DB.prepare(
    "SELECT * FROM jobs WHERE status IN ('new','review')"
  ).all();
  let regenerated = 0;
  for (const row of rows.results) {
    const job = toJobImport(row);
    const latest = await env.DB.prepare(
      "SELECT version FROM application_drafts WHERE job_id=? ORDER BY version DESC LIMIT 1"
    )
      .bind(job.id)
      .first<{ version: number }>();
    const draft = await generateDraft(env, job, profile);
    const timestamp = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO application_drafts (id,job_id,version,message,change_summary,model_provider,model_id,created_at) VALUES (?,?,?,?,?,?,?,?)"
      ).bind(
        crypto.randomUUID(),
        job.id,
        (latest?.version ?? 0) + 1,
        draft.message,
        draft.summary,
        draft.provider,
        draft.modelId,
        timestamp
      ),
      env.DB.prepare(
        "UPDATE jobs SET status='review',updated_at=? WHERE id=?"
      ).bind(timestamp, job.id),
    ]);
    regenerated += 1;
  }
  return regenerated;
}

export async function importJobsWithDrafts(
  env: AppEnv,
  jobs: JobImport[]
): Promise<void> {
  const profile = await savedProfile(env.DB);
  for (const job of jobs) {
    const timestamp = new Date().toISOString();
    await upsertJob(env.DB, job, timestamp);
    const existing = await env.DB.prepare(
      "SELECT id FROM application_drafts WHERE job_id=? ORDER BY version DESC LIMIT 1"
    )
      .bind(job.id)
      .first();
    if (existing) {
      continue;
    }
    const draft = await generateDraft(env, job, profile);
    await env.DB.prepare(
      "INSERT INTO application_drafts (id,job_id,version,message,change_summary,model_provider,model_id,created_at) VALUES (?,?,?,?,?,?,?,?)"
    )
      .bind(
        crypto.randomUUID(),
        job.id,
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
      job.id,
      "draft_generated",
      `Automatic tailored draft created with ${draft.provider}/${draft.modelId}`
    );
  }
}

export async function reviseJobDraft(
  env: AppEnv,
  jobId: string,
  instruction: string
) {
  const [profile, row] = await Promise.all([
    savedProfile(env.DB),
    currentJobAndDraft(env.DB, jobId),
  ]);
  const revised = await reviseDraft(
    env,
    row.job,
    profile,
    row.message,
    instruction
  );
  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE application_drafts SET status='superseded' WHERE job_id=? AND status='draft'"
    ).bind(jobId),
    env.DB.prepare(
      "INSERT INTO application_drafts (id,job_id,version,message,change_summary,revision_instruction,model_provider,model_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).bind(
      draftId,
      jobId,
      row.version + 1,
      revised.message,
      revised.summary,
      instruction,
      revised.provider,
      revised.modelId,
      timestamp
    ),
    env.DB.prepare(
      "UPDATE jobs SET status='review',updated_at=? WHERE id=?"
    ).bind(timestamp, jobId),
  ]);
  await recordJobEvent(
    env.DB,
    jobId,
    "draft_revised",
    revised.summary,
    draftId
  );
  return revised;
}

async function currentJobAndDraft(db: D1Database, jobId: string) {
  const row = await db
    .prepare(
      "SELECT j.*,d.version,d.message FROM jobs j JOIN application_drafts d ON d.job_id=j.id WHERE j.id=? ORDER BY d.version DESC LIMIT 1"
    )
    .bind(jobId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new Error("Job or draft not found");
  }
  return {
    job: toJobImport(row),
    message: String(row.message),
    version: Number(row.version),
  };
}

async function savedProfile(db: D1Database): Promise<Profile> {
  const profile = await readProfile(db);
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
