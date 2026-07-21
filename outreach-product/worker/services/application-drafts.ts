import {
  APPLICATION_MESSAGE_TASK_TYPE,
  type ApplicationMessageRequestInput,
} from "../../src/agent-tasks/application-message";
import type { Profile } from "../../src/features/profile/schema";
import { validateApplicationMessage } from "../ai/application-message-policy";
import {
  type MessageContext,
  messageRouteFor,
  openingFor,
  type PreparedApplicationMessage,
  prepareApplicationMessageGeneration,
  prepareApplicationMessageRevision,
  signatureFor,
  validateCodexApplicationMessage,
} from "../ai/application-messages";
import type { AppEnv } from "../env";
import { upsertApplicationRoutes } from "../repositories/application-routes";
import {
  copyPacketSnapshotStatements,
  defaultPacketSnapshotStatements,
} from "../repositories/draft-attachments";
import { jobEventStatement } from "../repositories/job-events";
import { upsertJob, upsertUserJob } from "../repositories/jobs";
import { readMessageExemplars } from "../repositories/message-exemplars";
import { readActiveMessageFoundation } from "../repositories/message-foundations";
import { readMessageStyleGuidance } from "../repositories/message-style";
import { readPreferences, readProfile } from "../repositories/user-settings";
import { readUserTimeZone } from "../repositories/user-time-zone";
import { type JobImport, JobImportSchema } from "../schemas";
import {
  createAgentTaskRequest,
  readActiveAgentTaskRequest,
} from "./agent-task-requests";

export class DraftProfileRequiredError extends Error {}
export class DraftMessageFoundationRequiredError extends Error {}
export class DraftMutationError extends Error {
  readonly status: 409 | 422;

  constructor(message: string, options: ErrorOptions, status: 409 | 422) {
    super(message, options);
    this.status = status;
  }
}

export type JobDraftTaskInput = Extract<
  ApplicationMessageRequestInput,
  { kind: "job_draft" }
>;

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

export async function importJobs(
  env: AppEnv,
  userId: string,
  jobs: JobImport[]
): Promise<void> {
  for (const job of jobs) {
    const timestamp = new Date().toISOString();
    // biome-ignore lint/performance/noAwaitInLoops: Each imported job's listing, routes, and user row form one ordered unit.
    await upsertJob(env.DB, job, timestamp);
    await upsertApplicationRoutes(env.DB, job, timestamp);
    await upsertUserJob(env.DB, userId, job.id, job.priority, timestamp);
  }
}

// On-demand draft creation for a single job that has none yet — the
// "Generate application" button. Bulk-imported jobs deliberately skip
// pre-generation; a draft is written only when the user asks for one.
export async function queueJobDraftGeneration(
  env: AppEnv,
  userId: string,
  jobId: string
) {
  await ensureUserJobForDraftGeneration(env.DB, userId, jobId);
  await readJobForDraftGeneration(env.DB, userId, jobId);
  return queueJobDraftTask(env.DB, userId, jobId, {
    jobId,
    kind: "job_draft",
    mode: "generate",
  });
}

async function ensureUserJobForDraftGeneration(
  db: D1Database,
  userId: string,
  jobId: string
) {
  const job = await db
    .prepare(
      "SELECT id FROM job_listings WHERE id=? AND inventory_status='active'"
    )
    .bind(jobId)
    .first<{ id: string }>();
  if (!job) {
    throw new Error("Job not found");
  }
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO user_listing_states
        (id,user_id,job_id,status,priority,created_at,updated_at)
       VALUES (?,?,?,'new',0,?,?)
       ON CONFLICT(user_id,job_id) DO NOTHING`
    )
    .bind(crypto.randomUUID(), userId, jobId, timestamp, timestamp)
    .run();
}

export async function queueJobDraftRevision(
  env: AppEnv,
  userId: string,
  jobId: string,
  instruction: string
) {
  const current = await currentJobAndDraft(env.DB, userId, jobId);
  return queueJobDraftTask(env.DB, userId, jobId, {
    expectedDraftId: current.draftId,
    instruction,
    jobId,
    kind: "job_draft",
    mode: "revise",
  });
}

async function queueJobDraftTask(
  db: D1Database,
  userId: string,
  jobId: string,
  payload: JobDraftTaskInput
) {
  const active = await readActiveAgentTaskRequest(db, {
    subjectId: jobId,
    subjectType: "job",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId,
  });
  if (active) {
    return active;
  }
  return createAgentTaskRequest(db, {
    payload,
    subjectId: jobId,
    subjectType: "job",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId,
  });
}

interface PreparedJobDraftTask {
  context: MessageContext;
  current: CurrentDraft | null;
  job: JobImport;
  latestVersion: number;
  prepared: PreparedApplicationMessage;
  userJobId: string;
}

export async function prepareJobDraftTask(
  env: AppEnv,
  userId: string,
  input: JobDraftTaskInput
): Promise<PreparedJobDraftTask> {
  const [profile, styleGuidance] = await Promise.all([
    savedProfile(env.DB, userId),
    readMessageStyleGuidance(env.DB, userId),
  ]);
  if (input.mode === "revise") {
    const current = await currentJobAndDraft(env.DB, userId, input.jobId);
    if (current.draftId !== input.expectedDraftId) {
      throw new DraftMutationError(
        "The draft changed before Codex could revise it",
        {},
        409
      );
    }
    const context = await messageContext(env, userId, current.job);
    return {
      context,
      current,
      job: current.job,
      latestVersion: current.version,
      prepared: prepareApplicationMessageRevision(
        current.job,
        profile,
        current.message,
        input.instruction ?? "",
        styleGuidance,
        context
      ),
      userJobId: current.userJobId,
    };
  }
  const row = await readJobForDraftGeneration(env.DB, userId, input.jobId);
  const job = jobImportFromRow(row);
  const context = await messageContext(env, userId, job);
  return {
    context,
    current: null,
    job,
    latestVersion: Number(row.latest_version ?? 0),
    prepared: prepareApplicationMessageGeneration(
      job,
      profile,
      styleGuidance,
      context
    ),
    userJobId: String(row.user_job_id),
  };
}

export async function buildJobDraftTaskCompletion(
  env: AppEnv,
  userId: string,
  input: JobDraftTaskInput,
  rawOutput: unknown,
  modelId: string
) {
  const state = await prepareJobDraftTask(env, userId, input);
  const generated = validateCodexApplicationMessage(
    rawOutput,
    state.prepared,
    modelId
  );
  if (state.current) {
    return buildDraftMutationPlan(env, userId, state.current, {
      changeSummary: generated.summary,
      eventType: "draft_revised",
      foundationId: state.context.foundationId,
      message: generated.message,
      modelId: generated.modelId,
      modelProvider: generated.provider,
      revisionInstruction: input.instruction ?? "",
      revisionSource: "ai_revision",
      snapshotDraftId: state.current.draftId,
      templateKey: state.context.templateKey,
    });
  }
  return buildGeneratedJobDraftPlan(env, userId, state, generated);
}

async function buildGeneratedJobDraftPlan(
  env: AppEnv,
  userId: string,
  state: PreparedJobDraftTask,
  generated: ReturnType<typeof validateCodexApplicationMessage>
) {
  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const version = state.latestVersion + 1;
  const snapshotStatements = await defaultPacketSnapshotStatements(
    env,
    userId,
    draftId,
    timestamp
  );
  const statements = [
    env.DB.prepare(
      "UPDATE application_drafts SET status='superseded' WHERE user_job_id=? AND status='draft'"
    ).bind(state.userJobId),
    env.DB.prepare(
      `INSERT INTO application_drafts
        (id,user_job_id,version,message,required_opening,change_summary,
         model_provider,model_id,message_foundation_id,message_template_key,
         revision_source,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      draftId,
      state.userJobId,
      version,
      generated.message,
      openingFor(state.job.contactName),
      generated.summary,
      generated.provider,
      generated.modelId,
      state.context.foundationId,
      state.context.templateKey,
      "generated",
      timestamp
    ),
    ...snapshotStatements,
    env.DB.prepare(
      "UPDATE user_listing_states SET status='review',updated_at=? WHERE id=? AND user_id=?"
    ).bind(timestamp, state.userJobId, userId),
    jobEventStatement(
      env.DB,
      state.userJobId,
      "draft_generated",
      generated.summary,
      draftId
    ),
  ];
  return {
    result: {
      draft: {
        changeSummary: generated.summary,
        createdAt: timestamp,
        id: draftId,
        message: generated.message,
        previousMessage: "",
        revisionSource: "generated" as const,
        status: "draft" as const,
        version,
      },
    },
    statements,
  };
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
  requiredOpening: string;
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
  const plan = buildDraftMutationPlan(env, userId, current, input);
  await env.DB.batch(plan.statements);
  return plan.result;
}

function buildDraftMutationPlan(
  env: AppEnv,
  userId: string,
  current: CurrentDraft,
  input: DraftMutationInput
) {
  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const version = current.version + 1;
  const statements = [
    env.DB.prepare(
      `UPDATE outbound_recipient_claims
          SET status='released',released_at=?,updated_at=?
        WHERE source_kind='application_attempt' AND status='claimed'
          AND source_id IN (
            SELECT id FROM application_attempts
             WHERE draft_id=? AND status='approved'
               AND send_requested_at IS NULL AND gmail_draft_id=''
          )`
    ).bind(timestamp, timestamp, current.draftId),
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
        (id,user_job_id,version,message,required_opening,change_summary,
         revision_instruction,model_provider,model_id,message_foundation_id,
         message_template_key,revision_source,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      draftId,
      current.userJobId,
      version,
      input.message,
      current.requiredOpening,
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
      "UPDATE user_listing_states SET status='review',updated_at=? WHERE id=? AND user_id=?"
    ).bind(timestamp, current.userJobId, userId),
    jobEventStatement(
      env.DB,
      current.userJobId,
      input.eventType,
      input.changeSummary,
      draftId
    ),
  ];
  return {
    result: {
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
    },
    statements,
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
              d.required_opening,d.message_foundation_id,d.message_template_key
       FROM user_listing_states uj
       JOIN job_listings j ON j.id=uj.job_id
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
    job: jobImportFromRow(row),
    message: String(row.message),
    requiredOpening: String(row.required_opening),
    templateKey: row.message_template_key
      ? String(row.message_template_key)
      : null,
    userJobId: String(row.user_job_id),
    version: Number(row.version),
  };
}

async function readJobForDraftGeneration(
  db: D1Database,
  userId: string,
  jobId: string
) {
  const row = await db
    .prepare(
      `SELECT j.*,uj.id user_job_id,uj.priority,
              (SELECT MAX(version) FROM application_drafts d
                WHERE d.user_job_id=uj.id) latest_version
         FROM user_listing_states uj
         JOIN job_listings j ON j.id=uj.job_id
        WHERE uj.user_id=? AND j.id=?`
    )
    .bind(userId, jobId)
    .first<Record<string, unknown>>();
  if (!row) {
    throw new Error("Job not found");
  }
  return row;
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

export function jobImportFromRow(row: Record<string, unknown>): JobImport {
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
