import type { Profile } from "../../src/features/profile/schema";
import { validateApplicationMessage } from "../ai/application-message-policy";
import {
  generateApplicationMessage,
  type MessageContext,
  messageRouteFor,
  openingFor,
  reviseApplicationMessage,
  signatureFor,
} from "../ai/application-messages";
import type { AppEnv } from "../env";
import {
  readAiModel,
  readApplicationMessageModel,
} from "../repositories/ai-model-settings";
import { upsertApplicationRoutes } from "../repositories/application-routes";
import {
  copyPacketSnapshotStatements,
  defaultPacketSnapshotStatements,
} from "../repositories/draft-attachments";
import { recordJobEvent } from "../repositories/job-events";
import { upsertJob, upsertUserJob } from "../repositories/jobs";
import { readMessageExemplars } from "../repositories/message-exemplars";
import { readActiveMessageFoundation } from "../repositories/message-foundations";
import { readMessageStyleGuidance } from "../repositories/message-style";
import { readPreferences, readProfile } from "../repositories/user-settings";
import { readUserTimeZone } from "../repositories/user-time-zone";
import { type JobImport, JobImportSchema } from "../schemas";
import { ensureJobMatchFactsForImport } from "./job-analysis";

export class DraftProfileRequiredError extends Error {}
export class DraftMessageFoundationRequiredError extends Error {}
export class DraftMutationError extends Error {
  readonly status: 409 | 422;

  constructor(message: string, options: ErrorOptions, status: 409 | 422) {
    super(message, options);
    this.status = status;
  }
}

export async function messageContext(
  env: AppEnv,
  userId: string,
  job: JobImport,
  shapeOverride?: MessageContext["shape"]
): Promise<MessageContext> {
  const [preferences, exemplars, emailRoute, factsRow, timeZone] =
    await Promise.all([
      readPreferences(env.DB, userId),
      readMessageExemplars(env.DB, userId, job.country),
      env.DB.prepare(
        "SELECT 1 present FROM application_routes WHERE job_id=? AND kind='email' AND status='active' LIMIT 1"
      )
        .bind(job.id)
        .first(),
      env.DB.prepare("SELECT facts_json FROM job_match_facts WHERE job_id=?")
        .bind(job.id)
        .first<{ facts_json: string }>(),
      readUserTimeZone(env.DB, userId),
    ]);
  const audiences = audiencesFrom(factsRow?.facts_json);
  const shape = shapeOverride ?? {
    // Young-learner shape only when the listing is exclusively about young
    // audiences; board-form submissions get the short template.
    audience:
      audiences.length > 0 &&
      audiences.every((value) => value === "preschool" || value === "primary")
        ? ("young" as const)
        : ("general" as const),
    length: emailRoute ? ("long" as const) : ("short" as const),
  };
  const foundation = await readActiveMessageFoundation(
    env.DB,
    userId,
    messageRouteFor(job),
    shape
  );
  if (!foundation) {
    throw new DraftMessageFoundationRequiredError(
      "Complete message setup before generating applications"
    );
  }
  return {
    exemplars,
    ...foundation,
    preferences: preferences.value,
    shape,
    timeZone,
  };
}

function audiencesFrom(factsJson: string | undefined): string[] {
  if (!factsJson) {
    return [];
  }
  try {
    const parsed = JSON.parse(factsJson) as {
      audiences?: { value?: string }[];
    };
    return (parsed.audiences ?? []).map((fact) => String(fact.value ?? ""));
  } catch {
    return [];
  }
}

export async function regenerateDrafts(
  env: AppEnv,
  userId: string
): Promise<number> {
  const [model, profile, styleGuidance] = await Promise.all([
    readApplicationMessageModel(env.DB),
    savedProfile(env.DB, userId),
    readMessageStyleGuidance(env.DB, userId),
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
    // biome-ignore lint/performance/noAwaitInLoops: Draft regeneration is deliberately sequential to bound model-provider load.
    const latest = await env.DB.prepare(
      "SELECT version FROM application_drafts WHERE user_job_id=? ORDER BY version DESC LIMIT 1"
    )
      .bind(userJobId)
      .first<{ version: number }>();
    const context = await messageContext(env, userId, job);
    const draft = await generateApplicationMessage(
      env,
      model,
      job,
      profile,
      styleGuidance,
      context
    );
    const draftId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const snapshotStatements = await defaultPacketSnapshotStatements(
      env,
      userId,
      draftId,
      timestamp
    );
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE application_drafts SET status='superseded' WHERE user_job_id=? AND status='draft'"
      ).bind(userJobId),
      env.DB.prepare(
        `INSERT INTO application_drafts
          (id,user_job_id,version,message,change_summary,model_provider,model_id,
           message_foundation_id,message_template_key,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        draftId,
        userJobId,
        (latest?.version ?? 0) + 1,
        draft.message,
        draft.summary,
        draft.provider,
        draft.modelId,
        context.foundationId,
        context.templateKey,
        timestamp
      ),
      ...snapshotStatements,
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
  const [model, factsModel, profile, styleGuidance] = await Promise.all([
    readApplicationMessageModel(env.DB),
    readAiModel(env.DB, "job_fact_extraction"),
    savedProfile(env.DB, userId),
    readMessageStyleGuidance(env.DB, userId),
  ]);
  for (const job of jobs) {
    const timestamp = new Date().toISOString();
    // biome-ignore lint/performance/noAwaitInLoops: Imports are ordered so each job's route, user row, facts, and draft remain a coherent unit.
    await upsertJob(env.DB, job, timestamp);
    await upsertApplicationRoutes(env.DB, job, timestamp);
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
      await ensureJobMatchFactsForImport(env, factsModel, job);
      continue;
    }
    const context = await messageContext(env, userId, job);
    const [draft] = await Promise.all([
      generateApplicationMessage(
        env,
        model,
        job,
        profile,
        styleGuidance,
        context
      ),
      ensureJobMatchFactsForImport(env, factsModel, job),
    ]);
    const draftId = crypto.randomUUID();
    const snapshotStatements = await defaultPacketSnapshotStatements(
      env,
      userId,
      draftId,
      timestamp
    );
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO application_drafts
          (id,user_job_id,version,message,change_summary,model_provider,model_id,
           message_foundation_id,message_template_key,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        draftId,
        userJobId,
        1,
        draft.message,
        draft.summary,
        draft.provider,
        draft.modelId,
        context.foundationId,
        context.templateKey,
        timestamp
      ),
      ...snapshotStatements,
    ]);
    await recordJobEvent(
      env.DB,
      userJobId,
      "draft_generated",
      `Automatic tailored draft created with ${draft.provider}/${draft.modelId}`
    );
  }
}

// On-demand draft creation for a single job that has none yet — the
// "Generate application" button. Bulk-imported jobs deliberately skip
// pre-generation; a draft is written only when the user asks for one.
export async function generateJobDraft(
  env: AppEnv,
  userId: string,
  jobId: string
) {
  const [model, profile, styleGuidance] = await Promise.all([
    readApplicationMessageModel(env.DB),
    savedProfile(env.DB, userId),
    readMessageStyleGuidance(env.DB, userId),
  ]);
  const row = await env.DB.prepare(
    `SELECT j.*,uj.id user_job_id,uj.priority,
            (SELECT MAX(version) FROM application_drafts d
              WHERE d.user_job_id=uj.id) latest_version
       FROM user_jobs uj
       JOIN jobs j ON j.id=uj.job_id
      WHERE uj.user_id=? AND j.id=?`
  )
    .bind(userId, jobId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new Error("Job not found");
  }
  const job = toJobImport(row);
  const userJobId = String(row.user_job_id);
  const context = await messageContext(env, userId, job);
  const draft = await generateApplicationMessage(
    env,
    model,
    job,
    profile,
    styleGuidance,
    context
  );
  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const snapshotStatements = await defaultPacketSnapshotStatements(
    env,
    userId,
    draftId,
    timestamp
  );
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE application_drafts SET status='superseded' WHERE user_job_id=? AND status='draft'"
    ).bind(userJobId),
    env.DB.prepare(
      `INSERT INTO application_drafts
        (id,user_job_id,version,message,change_summary,model_provider,model_id,
         message_foundation_id,message_template_key,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      draftId,
      userJobId,
      Number(row.latest_version ?? 0) + 1,
      draft.message,
      draft.summary,
      draft.provider,
      draft.modelId,
      context.foundationId,
      context.templateKey,
      timestamp
    ),
    ...snapshotStatements,
    env.DB.prepare(
      "UPDATE user_jobs SET status='review',updated_at=? WHERE id=? AND user_id=?"
    ).bind(timestamp, userJobId, userId),
  ]);
  await recordJobEvent(
    env.DB,
    userJobId,
    "draft_generated",
    `On-demand draft created with ${draft.provider}/${draft.modelId}`,
    draftId
  );
  return draft;
}

export async function reviseJobDraft(
  env: AppEnv,
  userId: string,
  jobId: string,
  instruction: string
) {
  const [model, profile, row, styleGuidance] = await Promise.all([
    readApplicationMessageModel(env.DB),
    savedProfile(env.DB, userId),
    currentJobAndDraft(env.DB, userId, jobId),
    readMessageStyleGuidance(env.DB, userId),
  ]);
  const context = await messageContext(env, userId, row.job);
  const revised = await reviseApplicationMessage(
    env,
    model,
    row.job,
    profile,
    row.message,
    instruction,
    styleGuidance,
    context
  );
  return persistDraftMutation(env, userId, row, {
    changeSummary: revised.summary,
    eventType: "draft_revised",
    foundationId: context.foundationId,
    message: revised.message,
    modelId: revised.modelId,
    modelProvider: revised.provider,
    revisionInstruction: instruction,
    revisionSource: "ai_revision",
    snapshotDraftId: row.draftId,
    templateKey: context.templateKey,
  });
}

export async function saveManualJobDraft(
  env: AppEnv,
  userId: string,
  jobId: string,
  rawMessage: string
) {
  const [profile, row] = await Promise.all([
    savedProfile(env.DB, userId),
    currentJobAndDraft(env.DB, userId, jobId),
  ]);
  if (rawMessage.trim() === row.message.trim()) {
    throw new DraftMutationError("The message has no changes to save", {}, 409);
  }
  let message: string;
  try {
    message = validateApplicationMessage(
      rawMessage,
      openingFor(row.job.contactName),
      `Best,\n${signatureFor(profile)}`,
      messageRouteFor(row.job)
    );
  } catch (error) {
    throw new DraftMutationError(
      error instanceof Error ? error.message : "The message is invalid",
      { cause: error },
      422
    );
  }
  return persistDraftMutation(env, userId, row, {
    changeSummary: "Saved a manual edit.",
    eventType: "draft_edited",
    foundationId: row.foundationId,
    message,
    modelId: null,
    modelProvider: null,
    revisionInstruction: "Manual edit",
    revisionSource: "manual_edit",
    snapshotDraftId: row.draftId,
    templateKey: row.templateKey,
  });
}

export async function undoJobDraft(env: AppEnv, userId: string, jobId: string) {
  const row = await currentJobAndDraft(env.DB, userId, jobId);
  const previous = await env.DB.prepare(
    `SELECT id,version,message,model_provider,model_id,
            message_foundation_id,message_template_key
       FROM application_drafts
      WHERE user_job_id=? AND version<?
      ORDER BY version DESC LIMIT 1`
  )
    .bind(row.userJobId, row.version)
    .first<PreviousDraftRow>();
  if (!previous) {
    throw new DraftMutationError(
      "There is no earlier draft to restore",
      {},
      409
    );
  }
  return persistDraftMutation(env, userId, row, {
    changeSummary: `Restored draft version ${previous.version}.`,
    eventType: "draft_undone",
    foundationId: previous.message_foundation_id,
    message: previous.message,
    modelId: previous.model_id,
    modelProvider: previous.model_provider,
    revisionInstruction: `Undo to version ${previous.version}`,
    revisionSource: "undo",
    snapshotDraftId: previous.id,
    templateKey: previous.message_template_key,
  });
}

type DraftRevisionSource = "ai_revision" | "manual_edit" | "undo";

interface CurrentDraft {
  draftId: string;
  foundationId: string | null;
  job: JobImport;
  message: string;
  templateKey: string | null;
  userJobId: string;
  version: number;
}

interface PreviousDraftRow {
  id: string;
  message: string;
  message_foundation_id: string | null;
  message_template_key: string | null;
  model_id: string | null;
  model_provider: string | null;
  version: number;
}

interface DraftMutationInput {
  changeSummary: string;
  eventType: string;
  foundationId: string | null;
  message: string;
  modelId: string | null;
  modelProvider: string | null;
  revisionInstruction: string;
  revisionSource: DraftRevisionSource;
  snapshotDraftId: string;
  templateKey: string | null;
}

async function persistDraftMutation(
  env: AppEnv,
  userId: string,
  current: CurrentDraft,
  input: DraftMutationInput
) {
  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const version = current.version + 1;
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM application_attempts
       WHERE draft_id=? AND status='approved' AND send_requested_at IS NULL
         AND gmail_draft_id=''`
    ).bind(current.draftId),
    env.DB.prepare(
      "UPDATE application_drafts SET status='superseded' WHERE id=? AND status IN ('draft','approved')"
    ).bind(current.draftId),
    env.DB.prepare(
      `INSERT INTO application_drafts
        (id,user_job_id,version,message,change_summary,revision_instruction,
         model_provider,model_id,message_foundation_id,message_template_key,
         revision_source,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      draftId,
      current.userJobId,
      version,
      input.message,
      input.changeSummary,
      input.revisionInstruction,
      input.modelProvider,
      input.modelId,
      input.foundationId,
      input.templateKey,
      input.revisionSource,
      timestamp
    ),
    ...copyPacketSnapshotStatements(
      env.DB,
      input.snapshotDraftId,
      draftId,
      timestamp
    ),
    env.DB.prepare(
      "UPDATE user_jobs SET status='review',updated_at=? WHERE id=? AND user_id=?"
    ).bind(timestamp, current.userJobId, userId),
  ]);
  await recordJobEvent(
    env.DB,
    current.userJobId,
    input.eventType,
    input.changeSummary,
    draftId
  );
  return {
    draft: {
      changeSummary: input.changeSummary,
      createdAt: timestamp,
      id: draftId,
      message: input.message,
      previousMessage: current.message,
      revisionSource: input.revisionSource,
      status: "draft" as const,
      version,
    },
  };
}

async function currentJobAndDraft(
  db: D1Database,
  userId: string,
  jobId: string
) {
  const row = await db
    .prepare(
      `SELECT j.*,uj.id user_job_id,uj.priority,d.id draft_id,d.version,d.message,
              d.message_foundation_id,d.message_template_key
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
    draftId: String(row.draft_id),
    foundationId: row.message_foundation_id
      ? String(row.message_foundation_id)
      : null,
    job: toJobImport(row),
    message: String(row.message),
    templateKey: row.message_template_key
      ? String(row.message_template_key)
      : null,
    userJobId: String(row.user_job_id),
    version: Number(row.version),
  };
}

export async function savedProfile(
  db: D1Database,
  userId: string
): Promise<Profile> {
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
    contactName: row.contact_name,
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
