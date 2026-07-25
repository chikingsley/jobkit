import { APPLICATION_MESSAGE_TASK_TYPE } from "../../../src/agent-tasks/application-message";
import {
  openingFor,
  validateGeneratedApplicationMessage,
} from "../../ai/application-messages";
import type { AppEnv } from "../../env";
import { defaultPacketSnapshotWrites } from "../../repositories/draft-attachments";
import { jobEventStatement } from "../../repositories/job-events";
import { readActiveAgentTaskRequest } from "../agent-task-requests";
import type {
  AgentTaskCompletionFence,
  AgentTaskCompletionWrite,
} from "../agent-tasks/run-store";
import {
  ANESL_CONTACT_NAME,
  ApplicationBundleError,
} from "../application-bundle-model";
import {
  type ApplicationBundleStatus,
  readAneslApplicationSet,
} from "../application-bundle-view";
import {
  type AneslBundleTaskInput,
  prepareAneslBundleTask,
} from "../application-bundles";
import { DraftMutationError, savedProfile } from "../application-drafts";
import {
  buildFencedBundleDraftMutationPlan,
  currentBundleDraft,
  persistBundleDraftMutation,
  validatedBundleMessage,
} from "./mutations";

export async function buildAneslBundleTaskCompletion(
  env: AppEnv,
  userId: string,
  input: AneslBundleTaskInput,
  rawOutput: unknown,
  modelId: string,
  fence: AgentTaskCompletionFence
) {
  const state = await prepareAneslBundleTask(env, userId, input);
  const generated = validateGeneratedApplicationMessage(
    rawOutput,
    state.prepared,
    modelId
  );
  if (state.current) {
    return buildFencedBundleDraftMutationPlan(
      env,
      userId,
      state.current,
      {
        changeSummary: generated.summary,
        foundationId: state.context.foundationId,
        message: generated.message,
        modelId: generated.modelId,
        modelProvider: generated.provider,
        revisionInstruction: input.instruction ?? "",
        revisionSource: "ai_revision",
        snapshotDraftId: state.current.draftId,
        templateKey: state.context.templateKey,
      },
      fence
    );
  }

  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const version = state.latestVersion + 1;
  const packetStatements = await defaultPacketSnapshotWrites(
    env,
    userId,
    draftId,
    timestamp,
    fence
  );
  return {
    condition: {
      clause: `EXISTS (
        SELECT 1 FROM application_bundles completion_bundle
         WHERE completion_bundle.id=? AND completion_bundle.user_id=?
           AND completion_bundle.status='review'
      ) AND (
        SELECT COUNT(*) FROM application_bundle_targets completion_targets
         WHERE completion_targets.bundle_id=?
      )=? AND COALESCE((
        SELECT MAX(version) FROM application_drafts
         WHERE user_job_id=?
      ),0)=?`,
      values: [
        input.bundleId,
        userId,
        input.bundleId,
        state.targets.length,
        state.userJobId,
        state.latestVersion,
      ],
    },
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
    writes: [
      {
        statement: env.DB.prepare(
          `UPDATE application_drafts SET status='superseded'
            WHERE user_job_id=? AND status='draft' AND ${fence.clause}`
        ).bind(state.userJobId, ...fence.values),
      },
      {
        expectedChanges: 1,
        statement: env.DB.prepare(
          `INSERT INTO application_drafts
            (id,user_job_id,application_bundle_id,version,message,required_opening,
             change_summary,model_provider,model_id,message_foundation_id,
             message_template_key,revision_source,created_at)
           SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${fence.clause}`
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
          timestamp,
          ...fence.values
        ),
      },
      ...packetStatements,
      {
        expectedChanges: state.targets.length,
        statement: env.DB.prepare(
          `UPDATE user_listing_states SET status='review',updated_at=?
            WHERE user_id=? AND id IN (
              SELECT user_job_id FROM application_bundle_targets
               WHERE bundle_id=?
            ) AND ${fence.clause}`
        ).bind(timestamp, userId, input.bundleId, ...fence.values),
      },
      {
        expectedChanges: 1,
        statement: env.DB.prepare(
          `UPDATE application_bundles SET status='review',updated_at=?
            WHERE id=? AND user_id=? AND status='review'
              AND ${fence.clause}`
        ).bind(timestamp, input.bundleId, userId, ...fence.values),
      },
      ...state.targets.map(
        (target): AgentTaskCompletionWrite => ({
          expectedChanges: 1,
          statement: jobEventStatement(
            env.DB,
            target.user_job_id,
            "bundle_draft_generated",
            `Added ${target.source_reference} to an ANESL application set`,
            draftId,
            { applicationBundleId: input.bundleId },
            fence
          ),
        })
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
