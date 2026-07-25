import type { AppEnv } from "../../../worker/env";
import { ensureDocumentPackets } from "../../../worker/repositories/document-packets";
import { jobEventStatement } from "../../../worker/repositories/job-events";
import { readMessageStyleGuidance } from "../../../worker/repositories/message-style";
import {
  buildAgentTaskRequestCreation,
  createAgentTaskRequest,
  readActiveAgentTaskRequest,
} from "../../../worker/services/agent-task-requests";
import {
  APPLICATION_MESSAGE_TASK_TYPE,
  type ApplicationMessageRequestInput,
} from "../../agent-tasks/application-message";
import {
  DraftMutationError,
  savedProfile,
} from "../04_compose/application-drafts";
import {
  type MessageContext,
  type PreparedApplicationMessage,
  prepareApplicationMessageGeneration,
  prepareApplicationMessageRevision,
} from "../04_compose/application-messages";
import {
  ANESL_KIND,
  ANESL_RECIPIENT,
  ApplicationBundleError,
  aneslBundleJob,
  aneslBundleSubject,
  assertCompatibleAneslTargets,
  ensureSelectedAneslUserJobs,
  readAneslBundleTargets,
  readSelectedAneslTargets,
  validateAneslSelection,
} from "./application-bundle-model";
import { readAneslApplicationSet } from "./application-bundle-view";
import {
  bundleMessageContext,
  type CurrentBundleDraft,
  currentBundleDraft,
} from "./application-bundles/mutations";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export {
  buildAneslBundleTaskCompletion,
  cancelAneslApplicationSet,
  saveManualAneslApplicationSetDraft,
  undoAneslApplicationSetDraft,
} from "./application-bundles/completion";

export type AneslBundleTaskInput = Extract<
  ApplicationMessageRequestInput,
  { kind: "anesl_bundle" }
>;

export async function createAneslApplicationSet(
  env: AppEnv,
  userId: string,
  jobIds: string[]
) {
  validateAneslSelection(jobIds);
  const existing = await env.DB.prepare(
    `SELECT id FROM application_bundles
      WHERE user_id=? AND kind=? AND status IN ('review','approved','failed')
      LIMIT 1`
  )
    .bind(userId, ANESL_KIND)
    .first<{ id: string }>();
  if (existing) {
    throw new ApplicationBundleError(
      "Finish or cancel the current ANESL application set before starting another",
      409
    );
  }
  await ensureSelectedAneslUserJobs(env.DB, userId, jobIds);
  const targets = await readSelectedAneslTargets(env.DB, userId, jobIds);
  const orderedTargets = jobIds.map((jobId) => {
    const target = targets.find((row) => String(row.id) === jobId);
    if (!target) {
      throw new ApplicationBundleError(
        "One or more selected ANESL positions are unavailable",
        409
      );
    }
    return target;
  });
  assertCompatibleAneslTargets(orderedTargets);

  const bundleId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const [first] = orderedTargets;
  if (!first) {
    throw new ApplicationBundleError("Select at least one position", 400);
  }
  const subject = aneslBundleSubject(orderedTargets);
  await ensureDocumentPackets(env.DB, userId);
  const taskCreation = buildAgentTaskRequestCreation(env.DB, {
    payload: {
      bundleId,
      kind: "anesl_bundle",
      mode: "generate",
    } satisfies AneslBundleTaskInput,
    subjectId: bundleId,
    subjectType: "application_bundle",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId,
  });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO application_bundles
        (id,user_id,kind,contact_channel_id,recipient,subject,status,
         created_at,updated_at)
       VALUES (?,?,?,?,?,?,'review',?,?)`
    ).bind(
      bundleId,
      userId,
      ANESL_KIND,
      first.contact_channel_id,
      ANESL_RECIPIENT,
      subject,
      timestamp,
      timestamp
    ),
    ...orderedTargets.map((target, ordinal) =>
      env.DB.prepare(
        `INSERT INTO application_bundle_targets
          (bundle_id,user_job_id,route_id,ordinal,source_reference,title,location)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(
        bundleId,
        target.user_job_id,
        target.route_id,
        ordinal,
        target.source_reference,
        target.title,
        target.location
      )
    ),
    taskCreation.statement,
    env.DB.prepare(
      `UPDATE user_listing_states SET status='review',updated_at=?
        WHERE user_id=? AND id IN (${orderedTargets.map(() => "?").join(",")})`
    ).bind(
      timestamp,
      userId,
      ...orderedTargets.map((target) => target.user_job_id)
    ),
    ...orderedTargets.map((target) =>
      jobEventStatement(
        env.DB,
        target.user_job_id,
        "bundle_draft_queued",
        `Queued ${target.source_reference} in an ANESL application set`,
        undefined,
        { applicationBundleId: bundleId }
      )
    ),
  ]);
  return {
    applicationSet: await readAneslApplicationSet(env.DB, userId, bundleId),
    taskRequest: taskCreation.request,
  };
}

export async function reviseAneslApplicationSet(
  env: AppEnv,
  userId: string,
  bundleId: string,
  instruction: string
) {
  const current = await currentBundleDraft(env.DB, userId, bundleId);
  const active = await readActiveAgentTaskRequest(env.DB, {
    subjectId: bundleId,
    subjectType: "application_bundle",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId,
  });
  if (active) {
    return {
      applicationSet: await readAneslApplicationSet(env.DB, userId, bundleId),
      taskRequest: active,
    };
  }
  const taskRequest = await createAgentTaskRequest(env.DB, {
    payload: {
      bundleId,
      expectedDraftId: current.draftId,
      instruction,
      kind: "anesl_bundle",
      mode: "revise",
    } satisfies AneslBundleTaskInput,
    subjectId: bundleId,
    subjectType: "application_bundle",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId,
  });
  return {
    applicationSet: await readAneslApplicationSet(env.DB, userId, bundleId),
    taskRequest,
  };
}

export interface PreparedAneslBundleTask {
  context: MessageContext;
  current: CurrentBundleDraft | null;
  job: ReturnType<typeof aneslBundleJob>;
  latestVersion: number;
  prepared: PreparedApplicationMessage;
  targets: Awaited<ReturnType<typeof readAneslBundleTargets>>;
  userJobId: string;
}

export async function prepareAneslBundleTask(
  env: AppEnv,
  userId: string,
  input: AneslBundleTaskInput
): Promise<PreparedAneslBundleTask> {
  const [profile, styleGuidance] = await Promise.all([
    savedProfile(env.DB, userId),
    readMessageStyleGuidance(env.DB, userId),
  ]);
  if (input.mode === "revise") {
    const current = await currentBundleDraft(env.DB, userId, input.bundleId);
    if (current.draftId !== input.expectedDraftId) {
      throw new DraftMutationError(
        "The bundle draft changed before Codex could revise it",
        {},
        409
      );
    }
    const targets = await readAneslBundleTargets(
      env.DB,
      userId,
      input.bundleId
    );
    const context = await bundleMessageContext(env, userId, current.job);
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
      targets,
      userJobId: current.userJobId,
    };
  }
  const targets = await readAneslBundleTargets(env.DB, userId, input.bundleId);
  const [first] = targets;
  if (!first) {
    throw new ApplicationBundleError("ANESL application set not found", 404);
  }
  assertCompatibleAneslTargets(targets);
  const job = aneslBundleJob(input.bundleId, targets);
  const context = await bundleMessageContext(env, userId, job);
  const latest = await env.DB.prepare(
    "SELECT COALESCE(MAX(version),0) version FROM application_drafts WHERE user_job_id=?"
  )
    .bind(first.user_job_id)
    .first<{ version: number }>();
  return {
    context,
    current: null,
    job,
    latestVersion: Number(latest?.version ?? 0),
    prepared: prepareApplicationMessageGeneration(
      job,
      profile,
      styleGuidance,
      context
    ),
    targets,
    userJobId: first.user_job_id,
  };
}
