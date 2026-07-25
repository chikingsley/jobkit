import {
  APPLICATION_MESSAGE_OUTPUT_JSON_SCHEMA,
  APPLICATION_MESSAGE_TASK_TYPE,
  ApplicationMessageRequestInputSchema,
  applicationMessagePrompt,
  applicationMessageTaskConfig,
} from "../../../src/agent-tasks/application-message";
import type { AgentTaskFailureCode } from "../../../src/features/agents/schema";
import type { AgentRunnerContext } from "../../../worker/app-types";
import type { AppEnv } from "../../../worker/env";
import { agentRunnerHasCapability } from "../../../worker/services/agent-runners";
import {
  failQueuedAgentTaskRequest,
  readClaimedAgentTaskRequest,
  readNextAgentTaskRequest,
} from "../../../worker/services/agent-task-requests";
import {
  AgentTaskError,
  type AgentTaskRunRow,
  type PreparedAgentTask,
} from "../../../worker/services/agent-tasks/contracts";
import {
  claimRequestedAgentTaskWithDomainWrites,
  failRequestedAgentTaskWithDomainWrites,
} from "../../../worker/services/agent-tasks/requested-task-leases";
import {
  type AgentTaskCompletionFence,
  completeRequestedAgentTaskWithDomainWrites,
  sha256,
} from "../../../worker/services/agent-tasks/run-store";
import {
  buildAneslBundleTaskCompletion,
  prepareAneslBundleTask,
} from "../06_deliver/application-bundles";
import {
  buildFollowUpTaskCompletion,
  prepareFollowUpTask,
} from "../07_respond/followups";
import {
  buildJobDraftTaskCompletion,
  prepareJobDraftTask,
} from "./application-drafts";
import {
  buildCampaignDispatchTaskCompletion,
  prepareCampaignDispatchTask,
} from "./campaign-messages";
import {
  completeMessagePreviewTask,
  prepareMessagePreviewTask,
} from "./message-preview";

export async function claimApplicationMessageTask(
  env: AppEnv,
  runner: AgentRunnerContext
): Promise<PreparedAgentTask | null> {
  if (!agentRunnerHasCapability(runner, "drafting")) {
    return null;
  }
  const request = await readNextAgentTaskRequest(env.DB, {
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId: runner.user.id,
  });
  if (!request) {
    return null;
  }
  const parsed = ApplicationMessageRequestInputSchema.safeParse(request.input);
  if (!parsed.success) {
    await failQueuedAgentTaskRequest(env.DB, {
      error: parsed.error.message,
      errorCode: "invalid_input",
      requestId: request.id,
      userId: runner.user.id,
    });
    return null;
  }
  const input = parsed.data;
  let prepared: Awaited<ReturnType<typeof prepareApplicationMessageRequest>>;
  try {
    prepared = await prepareApplicationMessageRequest(
      env,
      runner.user.id,
      input
    );
  } catch (error) {
    const sourceError = permanentPreparationError(error);
    if (!sourceError) {
      throw error;
    }
    await failQueuedAgentTaskRequest(env.DB, {
      error: sourceError,
      errorCode: "source_changed",
      requestId: request.id,
      userId: runner.user.id,
    });
    return null;
  }
  const config = applicationMessageTaskConfig(input.mode);
  const source = JSON.stringify(prepared.input);
  return claimRequestedAgentTaskWithDomainWrites(
    env.DB,
    runner,
    request,
    {
      model: config.model,
      outputSchema: APPLICATION_MESSAGE_OUTPUT_JSON_SCHEMA,
      prompt: applicationMessagePrompt(input.mode, prepared.input),
      promptVersion: config.promptVersion,
      reasoningEffort: config.reasoningEffort,
      sourceHash: await sha256(source),
      taskType: APPLICATION_MESSAGE_TASK_TYPE,
      webSearch: "disabled",
    },
    (_context, fence) =>
      applicationMessageClaimWrites(env.DB, runner.user.id, input, fence)
  );
}

export async function completeApplicationMessageTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  run: AgentTaskRunRow,
  runId: string,
  rawOutput: unknown
) {
  const request = await requireClaimedRequest(
    env.DB,
    runner,
    run.source_task_id
  );
  const input = ApplicationMessageRequestInputSchema.parse(request.input);
  const prepared = await prepareApplicationMessageRequest(
    env,
    runner.user.id,
    input
  );
  if ((await sha256(JSON.stringify(prepared.input))) !== run.source_hash) {
    throw new AgentTaskError("Application message source changed", 409);
  }
  return completeRequestedAgentTaskWithDomainWrites<unknown>(
    env.DB,
    {
      attemptNumber: run.attempt_number,
      leaseToken: run.lease_token,
      requestId: request.id,
      runId,
      runnerId: runner.id,
      taskType: run.task_type,
      userId: runner.user.id,
    },
    (fence) =>
      buildApplicationMessageCompletionPlan(
        env,
        runner.user.id,
        input,
        rawOutput,
        run.model,
        fence
      )
  );
}

async function buildApplicationMessageCompletionPlan(
  env: AppEnv,
  userId: string,
  input: ReturnType<typeof ApplicationMessageRequestInputSchema.parse>,
  rawOutput: unknown,
  modelId: string,
  fence: AgentTaskCompletionFence
) {
  if (input.kind === "follow_up") {
    return buildFollowUpTaskCompletion(
      env,
      userId,
      input,
      rawOutput,
      modelId,
      fence
    );
  }
  if (input.kind === "job_draft") {
    return buildJobDraftTaskCompletion(
      env,
      userId,
      input,
      rawOutput,
      modelId,
      fence
    );
  }
  if (input.kind === "anesl_bundle") {
    return buildAneslBundleTaskCompletion(
      env,
      userId,
      input,
      rawOutput,
      modelId,
      fence
    );
  }
  if (input.kind === "campaign_dispatch") {
    return buildCampaignDispatchTaskCompletion(
      env,
      userId,
      input,
      rawOutput,
      modelId,
      fence
    );
  }
  return {
    condition: { clause: "1=1", values: [] },
    result: await completeMessagePreviewTask(
      env,
      userId,
      input,
      rawOutput,
      modelId
    ),
    writes: [],
  };
}

async function prepareApplicationMessageRequest(
  env: AppEnv,
  userId: string,
  input: ReturnType<typeof ApplicationMessageRequestInputSchema.parse>
) {
  if (input.kind === "follow_up") {
    return prepareFollowUpTask(env, userId, input);
  }
  if (input.kind === "job_draft") {
    return (await prepareJobDraftTask(env, userId, input)).prepared;
  }
  if (input.kind === "anesl_bundle") {
    return (await prepareAneslBundleTask(env, userId, input)).prepared;
  }
  if (input.kind === "campaign_dispatch") {
    return (await prepareCampaignDispatchTask(env, userId, input)).prepared;
  }
  return prepareMessagePreviewTask(env, userId, input);
}

const PERMANENT_PREPARATION_MESSAGES = new Set([
  "ANESL application set not found",
  "Campaign dispatch was not found",
  "Campaign job was not found",
  "Campaign school was not found",
  "Follow-up not found",
  "Job not found",
  "Job or draft not found",
  "Unknown message preview sample",
]);

function permanentPreparationError(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }
  const status = "status" in error ? Number(error.status) : 0;
  if (status >= 400 && status < 500) {
    return error.message;
  }
  return PERMANENT_PREPARATION_MESSAGES.has(error.message)
    ? error.message
    : null;
}

export async function failApplicationMessageTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  requestId: string,
  runId: string,
  error: string,
  errorCode: AgentTaskFailureCode
) {
  const request = await requireClaimedRequest(env.DB, runner, requestId);
  const input = ApplicationMessageRequestInputSchema.parse(request.input);
  await failRequestedAgentTaskWithDomainWrites(
    env.DB,
    {
      attemptNumber: request.attemptCount,
      errorCode,
      errorDetail: error,
      leaseToken: request.leaseToken,
      mode: "runner",
      requestId: request.id,
      runId,
      runnerId: runner.id,
      taskType: request.taskType,
      userId: runner.user.id,
    },
    (retry, fence) =>
      buildApplicationMessageFailureWrites(
        env.DB,
        runner.user.id,
        input,
        error,
        retry,
        fence
      )
  );
}

function applicationMessageClaimWrites(
  db: D1Database,
  userId: string,
  input: ReturnType<typeof ApplicationMessageRequestInputSchema.parse>,
  fence: AgentTaskCompletionFence
) {
  if (input.kind === "follow_up") {
    return [
      {
        expectedChanges: 1,
        statement: db
          .prepare(
            `UPDATE outreach_followups SET status='drafting',
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND user_id=? AND status='scheduled'
            AND ${fence.clause}`
          )
          .bind(input.followUpId, userId, ...fence.values),
      },
    ];
  }
  if (input.kind === "campaign_dispatch") {
    return [
      {
        expectedChanges: 1,
        statement: db
          .prepare(
            `UPDATE campaign_dispatches SET status='drafting',
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND status IN ('queued','calibration','drafting')
            AND EXISTS (
              SELECT 1 FROM campaigns claim_campaign
               WHERE claim_campaign.id=campaign_dispatches.campaign_id
                 AND claim_campaign.user_id=?
            ) AND ${fence.clause}`
          )
          .bind(input.dispatchId, userId, ...fence.values),
      },
    ];
  }
  return [];
}

export function buildApplicationMessageFailureWrites(
  db: D1Database,
  userId: string,
  input: ReturnType<typeof ApplicationMessageRequestInputSchema.parse>,
  error: string,
  retry: boolean,
  fence: AgentTaskCompletionFence
) {
  if (input.kind === "follow_up") {
    return [
      {
        expectedChanges: 1,
        statement: db
          .prepare(
            `UPDATE outreach_followups
            SET status=?,error_detail=?,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND user_id=? AND status='drafting'
            AND ${fence.clause}`
          )
          .bind(
            retry ? "scheduled" : "failed",
            retry ? "" : error.slice(0, 4000),
            input.followUpId,
            userId,
            ...fence.values
          ),
      },
    ];
  }
  if (input.kind === "campaign_dispatch") {
    const retryStatus = input.mode === "revise" ? "review" : null;
    return [
      {
        expectedChanges: 1,
        statement: db
          .prepare(
            `UPDATE campaign_dispatches
            SET status=CASE
                  WHEN ?=0 THEN 'failed'
                  WHEN ? IS NOT NULL THEN ?
                  WHEN EXISTS (
                    SELECT 1 FROM campaigns failure_campaign
                     WHERE failure_campaign.id=campaign_dispatches.campaign_id
                       AND failure_campaign.status='calibrating'
                  ) THEN 'calibration'
                  ELSE 'queued'
                END,
                error_detail=CASE WHEN ?=1 THEN '' ELSE ? END,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND status='drafting'
            AND EXISTS (
              SELECT 1 FROM campaigns failure_owner
               WHERE failure_owner.id=campaign_dispatches.campaign_id
                 AND failure_owner.user_id=?
            ) AND ${fence.clause}`
          )
          .bind(
            retry ? 1 : 0,
            retryStatus,
            retryStatus,
            retry ? 1 : 0,
            error.slice(0, 4000),
            input.dispatchId,
            userId,
            ...fence.values
          ),
      },
    ];
  }
  return [];
}

async function requireClaimedRequest(
  db: D1Database,
  runner: AgentRunnerContext,
  requestId: string
) {
  const request = await readClaimedAgentTaskRequest(db, {
    requestId,
    runnerId: runner.id,
    userId: runner.user.id,
  });
  if (!request) {
    throw new AgentTaskError("Agent task request was not found", 404);
  }
  return request;
}
