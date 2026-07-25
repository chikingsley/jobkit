import { validateApplicationMessage } from "../../ai/application-message-policy";
import {
  messageRouteFor,
  openingFor,
  signatureFor,
  validateGeneratedApplicationMessage,
} from "../../ai/application-messages";
import type { AppEnv } from "../../env";
import { defaultPacketSnapshotWrites } from "../../repositories/draft-attachments";
import { jobEventStatement } from "../../repositories/job-events";
import type { AgentTaskCompletionFence } from "../agent-tasks/run-store";
import {
  DraftMutationError,
  type JobDraftTaskInput,
  type PreparedJobDraftTask,
  prepareJobDraftTask,
} from "../application-drafts";
import {
  buildFencedDraftMutationPlan,
  currentJobAndDraft,
  type PreviousDraftRow,
  persistDraftMutation,
  savedProfile,
} from "./mutations";

export async function buildJobDraftTaskCompletion(
  env: AppEnv,
  userId: string,
  input: JobDraftTaskInput,
  rawOutput: unknown,
  modelId: string,
  fence: AgentTaskCompletionFence
) {
  const state = await prepareJobDraftTask(env, userId, input);
  const generated = validateGeneratedApplicationMessage(
    rawOutput,
    state.prepared,
    modelId
  );
  if (state.current) {
    return buildFencedDraftMutationPlan(
      env,
      userId,
      state.current,
      {
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
      },
      fence
    );
  }
  return buildGeneratedJobDraftPlan(env, userId, state, generated, fence);
}

async function buildGeneratedJobDraftPlan(
  env: AppEnv,
  userId: string,
  state: PreparedJobDraftTask,
  generated: ReturnType<typeof validateGeneratedApplicationMessage>,
  fence: AgentTaskCompletionFence
) {
  const draftId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const version = state.latestVersion + 1;
  const snapshotStatements = await defaultPacketSnapshotWrites(
    env,
    userId,
    draftId,
    timestamp,
    fence
  );
  return {
    condition: {
      clause: `EXISTS (
        SELECT 1 FROM user_listing_states completion_job
         WHERE completion_job.id=? AND completion_job.user_id=?
      ) AND COALESCE((
        SELECT MAX(version) FROM application_drafts
         WHERE user_job_id=?
      ),0)=?`,
      values: [state.userJobId, userId, state.userJobId, state.latestVersion],
    },
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
            (id,user_job_id,version,message,required_opening,change_summary,
             model_provider,model_id,message_foundation_id,message_template_key,
             revision_source,created_at)
           SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${fence.clause}`
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
          timestamp,
          ...fence.values
        ),
      },
      ...snapshotStatements,
      {
        expectedChanges: 1,
        statement: env.DB.prepare(
          `UPDATE user_listing_states SET status='review',updated_at=?
            WHERE id=? AND user_id=? AND ${fence.clause}`
        ).bind(timestamp, state.userJobId, userId, ...fence.values),
      },
      {
        expectedChanges: 1,
        statement: jobEventStatement(
          env.DB,
          state.userJobId,
          "draft_generated",
          generated.summary,
          draftId,
          {},
          fence
        ),
      },
    ],
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
