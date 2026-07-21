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
import {
  copyPacketSnapshotStatements,
  defaultPacketSnapshotStatements,
} from "../repositories/draft-attachments";
import { jobEventStatement } from "../repositories/job-events";
import { readMessageStyleGuidance } from "../repositories/message-style";
import {
  buildAgentTaskRequestCreation,
  createAgentTaskRequest,
  readActiveAgentTaskRequest,
} from "./agent-task-requests";
import {
  ANESL_CONTACT_NAME,
  ANESL_KIND,
  ANESL_RECIPIENT,
  ANESL_REQUIRED_QUESTION,
  ApplicationBundleError,
  aneslBundleJob,
  aneslBundleSubject,
  assertCompatibleAneslTargets,
  ensureSelectedAneslUserJobs,
  readAneslBundleTargets,
  readSelectedAneslTargets,
  validateAneslSelection,
} from "./application-bundle-model";
import {
  type ApplicationBundleStatus,
  readAneslApplicationSet,
} from "./application-bundle-view";
import {
  DraftMutationError,
  messageContext,
  savedProfile,
} from "./application-drafts";

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

interface PreparedAneslBundleTask {
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

export async function buildAneslBundleTaskCompletion(
  env: AppEnv,
  userId: string,
  input: AneslBundleTaskInput,
  rawOutput: unknown,
  modelId: string
) {
  const state = await prepareAneslBundleTask(env, userId, input);
  const generated = validateCodexApplicationMessage(
    rawOutput,
    state.prepared,
    modelId
  );
  if (state.current) {
    return buildBundleDraftMutationPlan(env, userId, state.current, {
      changeSummary: generated.summary,
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

  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const version = state.latestVersion + 1;
  const packetStatements = await defaultPacketSnapshotStatements(
    env,
    userId,
    draftId,
    timestamp
  );
  return {
    result: {
      applicationSetId: input.bundleId,
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
    statements: [
      env.DB.prepare(
        `UPDATE application_drafts SET status='superseded'
          WHERE user_job_id=? AND status='draft'`
      ).bind(state.userJobId),
      env.DB.prepare(
        `INSERT INTO application_drafts
          (id,user_job_id,application_bundle_id,version,message,required_opening,
           change_summary,model_provider,model_id,message_foundation_id,
           message_template_key,revision_source,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        draftId,
        state.userJobId,
        input.bundleId,
        version,
        generated.message,
        openingFor(ANESL_CONTACT_NAME),
        generated.summary,
        generated.provider,
        generated.modelId,
        state.context.foundationId,
        state.context.templateKey,
        "generated",
        timestamp
      ),
      ...packetStatements,
      env.DB.prepare(
        `UPDATE user_listing_states SET status='review',updated_at=?
          WHERE user_id=? AND id IN (
            SELECT user_job_id FROM application_bundle_targets WHERE bundle_id=?
          )`
      ).bind(timestamp, userId, input.bundleId),
      env.DB.prepare(
        `UPDATE application_bundles SET status='review',updated_at=?
          WHERE id=? AND user_id=? AND status='review'`
      ).bind(timestamp, input.bundleId, userId),
      ...state.targets.map((target) =>
        jobEventStatement(
          env.DB,
          target.user_job_id,
          "bundle_draft_generated",
          `Added ${target.source_reference} to an ANESL application set`,
          draftId,
          { applicationBundleId: input.bundleId }
        )
      ),
    ],
  };
}

export async function saveManualAneslApplicationSetDraft(
  env: AppEnv,
  userId: string,
  bundleId: string,
  rawMessage: string
) {
  const [profile, current] = await Promise.all([
    savedProfile(env.DB, userId),
    currentBundleDraft(env.DB, userId, bundleId),
  ]);
  if (rawMessage.trim() === current.message.trim()) {
    throw new DraftMutationError("The message has no changes to save", {}, 409);
  }
  const message = validatedBundleMessage(rawMessage, current.job, profile);
  await persistBundleDraftMutation(env, userId, current, {
    changeSummary: "Saved a manual edit.",
    foundationId: current.foundationId,
    message,
    modelId: null,
    modelProvider: null,
    revisionInstruction: "Manual edit",
    revisionSource: "manual_edit",
    snapshotDraftId: current.draftId,
    templateKey: current.templateKey,
  });
  return readAneslApplicationSet(env.DB, userId, bundleId);
}

export async function undoAneslApplicationSetDraft(
  env: AppEnv,
  userId: string,
  bundleId: string
) {
  const current = await currentBundleDraft(env.DB, userId, bundleId);
  const previous = await env.DB.prepare(
    `SELECT id,version,message,model_provider,model_id,
            message_foundation_id,message_template_key
       FROM application_drafts
      WHERE application_bundle_id=? AND version<?
      ORDER BY version DESC LIMIT 1`
  )
    .bind(bundleId, current.version)
    .first<{
      id: string;
      message: string;
      message_foundation_id: string | null;
      message_template_key: string | null;
      model_id: string | null;
      model_provider: string | null;
      version: number;
    }>();
  if (!previous) {
    throw new DraftMutationError(
      "There is no earlier bundle draft to restore",
      {},
      409
    );
  }
  await persistBundleDraftMutation(env, userId, current, {
    changeSummary: `Restored draft version ${previous.version}.`,
    foundationId: previous.message_foundation_id,
    message: previous.message,
    modelId: previous.model_id,
    modelProvider: previous.model_provider,
    revisionInstruction: `Undo to version ${previous.version}`,
    revisionSource: "undo",
    snapshotDraftId: previous.id,
    templateKey: previous.message_template_key,
  });
  return readAneslApplicationSet(env.DB, userId, bundleId);
}

export async function cancelAneslApplicationSet(
  db: D1Database,
  userId: string,
  bundleId: string
) {
  const bundle = await db
    .prepare("SELECT status FROM application_bundles WHERE id=? AND user_id=?")
    .bind(bundleId, userId)
    .first<{ status: ApplicationBundleStatus }>();
  if (!bundle) {
    throw new ApplicationBundleError("ANESL application set not found", 404);
  }
  if (bundle.status === "sent") {
    throw new ApplicationBundleError(
      "A sent application set cannot be cancelled",
      409
    );
  }
  const activeDraftTask = await readActiveAgentTaskRequest(db, {
    subjectId: bundleId,
    subjectType: "application_bundle",
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId,
  });
  if (activeDraftTask?.status === "claimed") {
    throw new ApplicationBundleError(
      "Codex is currently drafting this application set",
      409
    );
  }
  const activeAttempt = await db
    .prepare(
      `SELECT status FROM application_attempts
      WHERE application_bundle_id=?
        AND status IN ('claimed','drafted','sending','uncertain') LIMIT 1`
    )
    .bind(bundleId)
    .first<{ status: string }>();
  if (activeAttempt) {
    throw new ApplicationBundleError(
      `The application set cannot be cancelled while its email is ${activeAttempt.status}`,
      409
    );
  }
  const timestamp = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE agent_task_requests
            SET status='cancelled',completed_at=?,updated_at=?
          WHERE user_id=? AND subject_type='application_bundle'
            AND subject_id=? AND task_type=? AND status='queued'`
      )
      .bind(
        timestamp,
        timestamp,
        userId,
        bundleId,
        APPLICATION_MESSAGE_TASK_TYPE
      ),
    db
      .prepare(
        `UPDATE outbound_recipient_claims
            SET status='released',released_at=?,updated_at=?
          WHERE source_kind='application_attempt' AND status='claimed'
            AND source_id IN (
              SELECT id FROM application_attempts
               WHERE application_bundle_id=?
                 AND status IN ('approved','failed')
            )`
      )
      .bind(timestamp, timestamp, bundleId),
    db
      .prepare(
        `DELETE FROM application_attempts
        WHERE application_bundle_id=? AND status IN ('approved','failed')`
      )
      .bind(bundleId),
    db
      .prepare(
        `UPDATE application_drafts SET status='superseded'
        WHERE application_bundle_id=? AND status IN ('draft','approved')`
      )
      .bind(bundleId),
    db
      .prepare(
        `UPDATE user_listing_states SET status='new',updated_at=?
        WHERE user_id=? AND id IN (
          SELECT user_job_id FROM application_bundle_targets WHERE bundle_id=?
        ) AND status IN ('review','approved','failed')`
      )
      .bind(timestamp, userId, bundleId),
    db
      .prepare(
        `UPDATE application_bundles SET status='cancelled',updated_at=?
        WHERE id=? AND user_id=?`
      )
      .bind(timestamp, bundleId, userId),
  ]);
  return readAneslApplicationSet(db, userId, bundleId);
}

interface CurrentBundleDraft {
  bundleId: string;
  draftId: string;
  foundationId: string | null;
  job: ReturnType<typeof aneslBundleJob>;
  message: string;
  requiredOpening: string;
  templateKey: string | null;
  userJobId: string;
  version: number;
}

interface BundleDraftMutation {
  changeSummary: string;
  foundationId: string | null;
  message: string;
  modelId: string | null;
  modelProvider: string | null;
  revisionInstruction: string;
  revisionSource: "ai_revision" | "manual_edit" | "undo";
  snapshotDraftId: string;
  templateKey: string | null;
}

async function currentBundleDraft(
  db: D1Database,
  userId: string,
  bundleId: string
): Promise<CurrentBundleDraft> {
  const targets = await readAneslBundleTargets(db, userId, bundleId);
  const [first] = targets;
  if (!first) {
    throw new ApplicationBundleError("ANESL application set not found", 404);
  }
  const draft = await db
    .prepare(
      `SELECT id,version,message,required_opening,message_foundation_id,
              message_template_key
       FROM application_drafts
      WHERE application_bundle_id=?
      ORDER BY version DESC LIMIT 1`
    )
    .bind(bundleId)
    .first<{
      id: string;
      message: string;
      required_opening: string;
      message_foundation_id: string | null;
      message_template_key: string | null;
      version: number;
    }>();
  if (!draft) {
    throw new ApplicationBundleError("ANESL application draft not found", 404);
  }
  return {
    bundleId,
    draftId: draft.id,
    foundationId: draft.message_foundation_id,
    job: aneslBundleJob(bundleId, targets),
    message: draft.message,
    requiredOpening: draft.required_opening,
    templateKey: draft.message_template_key,
    userJobId: first.user_job_id,
    version: draft.version,
  };
}

async function persistBundleDraftMutation(
  env: AppEnv,
  userId: string,
  current: CurrentBundleDraft,
  input: BundleDraftMutation
) {
  const plan = buildBundleDraftMutationPlan(env, userId, current, input);
  await env.DB.batch(plan.statements);
  return plan.result;
}

function buildBundleDraftMutationPlan(
  env: AppEnv,
  userId: string,
  current: CurrentBundleDraft,
  input: BundleDraftMutation
) {
  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const version = current.version + 1;
  return {
    result: {
      applicationSetId: current.bundleId,
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
    statements: [
      env.DB.prepare(
        `UPDATE outbound_recipient_claims
            SET status='released',released_at=?,updated_at=?
          WHERE source_kind='application_attempt' AND status='claimed'
            AND source_id IN (
              SELECT id FROM application_attempts
               WHERE application_bundle_id=? AND draft_id=?
                 AND status='approved' AND send_requested_at IS NULL
                 AND gmail_draft_id=''
            )`
      ).bind(timestamp, timestamp, current.bundleId, current.draftId),
      env.DB.prepare(
        `DELETE FROM application_attempts
          WHERE application_bundle_id=? AND draft_id=? AND status='approved'
            AND send_requested_at IS NULL AND gmail_draft_id=''`
      ).bind(current.bundleId, current.draftId),
      env.DB.prepare(
        `UPDATE application_drafts SET status='superseded'
          WHERE id=? AND application_bundle_id=? AND status IN ('draft','approved')`
      ).bind(current.draftId, current.bundleId),
      env.DB.prepare(
        `INSERT INTO application_drafts
          (id,user_job_id,application_bundle_id,version,message,required_opening,
           change_summary,revision_instruction,model_provider,model_id,
           message_foundation_id,message_template_key,revision_source,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        draftId,
        current.userJobId,
        current.bundleId,
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
        `UPDATE user_listing_states SET status='review',updated_at=?
          WHERE user_id=? AND id IN (
            SELECT user_job_id FROM application_bundle_targets WHERE bundle_id=?
          ) AND status IN ('new','review','approved','failed')`
      ).bind(timestamp, userId, current.bundleId),
      env.DB.prepare(
        `UPDATE application_bundles SET status='review',updated_at=?
          WHERE id=? AND user_id=? AND status IN ('review','approved','failed')`
      ).bind(timestamp, current.bundleId, userId),
    ],
  };
}

async function bundleMessageContext(
  env: AppEnv,
  userId: string,
  job: ReturnType<typeof aneslBundleJob>
) {
  const context = await messageContext(env, userId, job, {
    audience: "general",
    length: "long",
  });
  context.requiredPositionReferences = job.sourceReference
    .split(",")
    .map((reference) => reference.trim())
    .filter(Boolean);
  context.requiredQuestion = ANESL_REQUIRED_QUESTION;
  return context;
}

function validatedBundleMessage(
  rawMessage: string,
  job: ReturnType<typeof aneslBundleJob>,
  profile: Profile
) {
  try {
    const message = validateApplicationMessage(
      rawMessage,
      openingFor(job.contactName),
      `Best,\n${signatureFor(profile)}`,
      messageRouteFor(job),
      ANESL_REQUIRED_QUESTION
    );
    const missing = job.sourceReference
      .split(",")
      .map((reference) => reference.trim())
      .filter((reference) => reference && !message.includes(reference));
    if (missing.length > 0) {
      throw new Error(
        `The message must include every selected position ID: ${missing.join(", ")}`
      );
    }
    return message;
  } catch (error) {
    throw new DraftMutationError(
      error instanceof Error ? error.message : "The message is invalid",
      { cause: error },
      422
    );
  }
}
