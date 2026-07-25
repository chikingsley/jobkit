import type { AppEnv } from "../../../worker/env";
import { upsertApplicationRoutes } from "../../../worker/repositories/application-routes";
import { ensureDocumentPackets } from "../../../worker/repositories/document-packets";
import { upsertJob, upsertUserJob } from "../../../worker/repositories/jobs";
import { readMessageExemplars } from "../../../worker/repositories/message-exemplars";
import { readActiveMessageFoundation } from "../../../worker/repositories/message-foundations";
import { readMessageStyleGuidance } from "../../../worker/repositories/message-style";
import { readPreferences } from "../../../worker/repositories/user-settings";
import { readUserTimeZone } from "../../../worker/repositories/user-time-zone";
import type { JobImport } from "../../../worker/schemas";
import {
  createAgentTaskRequest,
  readActiveAgentTaskRequest,
} from "../../../worker/services/agent-task-requests";
import {
  APPLICATION_MESSAGE_TASK_TYPE,
  type ApplicationMessageRequestInput,
} from "../../agent-tasks/application-message";
import {
  type CurrentDraft,
  currentJobAndDraft,
  jobImportFromRow,
  readJobForDraftGeneration,
  savedProfile,
} from "./application-drafts/mutations";
import {
  type MessageContext,
  messageRouteFor,
  type PreparedApplicationMessage,
  prepareApplicationMessageGeneration,
  prepareApplicationMessageRevision,
} from "./application-messages";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export {
  buildJobDraftTaskCompletion,
  saveManualJobDraft,
  undoJobDraft,
} from "./application-drafts/completion";
export { jobImportFromRow, savedProfile } from "./application-drafts/mutations";

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

export async function queueJobDraftGeneration(
  env: AppEnv,
  userId: string,
  jobId: string
) {
  await ensureUserJobForDraftGeneration(env.DB, userId, jobId);
  await readJobForDraftGeneration(env.DB, userId, jobId);
  await ensureDocumentPackets(env.DB, userId);
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

export interface PreparedJobDraftTask {
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
  if (input.mode === "revise") {
    const current = await currentJobAndDraft(env.DB, userId, input.jobId);
    if (current.draftId !== input.expectedDraftId) {
      throw new DraftMutationError(
        "The draft changed before Codex could revise it",
        {},
        409
      );
    }
    const [profile, styleGuidance] = await Promise.all([
      savedProfile(env.DB, userId),
      readMessageStyleGuidance(env.DB, userId),
    ]);
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
  const [profile, styleGuidance] = await Promise.all([
    savedProfile(env.DB, userId),
    readMessageStyleGuidance(env.DB, userId),
  ]);
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
