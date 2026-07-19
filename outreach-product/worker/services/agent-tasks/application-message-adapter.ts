import {
  APPLICATION_MESSAGE_OUTPUT_JSON_SCHEMA,
  APPLICATION_MESSAGE_TASK_TYPE,
  ApplicationMessageRequestInputSchema,
  applicationMessagePrompt,
  applicationMessageTaskConfig,
} from "../../../src/agent-tasks/application-message";
import type { AgentRunnerContext } from "../../app-types";
import type { AppEnv } from "../../env";
import { agentRunnerHasCapability } from "../agent-runners";
import {
  claimAgentTaskRequest,
  failAgentTaskRequest,
  readClaimedAgentTaskRequest,
} from "../agent-task-requests";
import {
  buildAneslBundleTaskCompletion,
  prepareAneslBundleTask,
} from "../application-bundles";
import {
  buildJobDraftTaskCompletion,
  prepareJobDraftTask,
} from "../application-drafts";
import {
  completeMessagePreviewTask,
  prepareMessagePreviewTask,
} from "../message-preview";
import {
  AGENT_TASK_LEASE_MS,
  AgentTaskError,
  type AgentTaskRunRow,
  type PreparedAgentTask,
} from "./contracts";
import { createAgentTaskRun, sha256 } from "./run-store";

export async function claimApplicationMessageTask(
  env: AppEnv,
  runner: AgentRunnerContext
): Promise<PreparedAgentTask | null> {
  if (!agentRunnerHasCapability(runner, "drafting")) {
    return null;
  }
  const leaseExpiresAt = new Date(
    Date.now() + AGENT_TASK_LEASE_MS
  ).toISOString();
  const request = await claimAgentTaskRequest(env.DB, {
    leaseExpiresAt,
    runnerId: runner.id,
    taskType: APPLICATION_MESSAGE_TASK_TYPE,
    userId: runner.user.id,
  });
  if (!request) {
    return null;
  }
  try {
    const input = ApplicationMessageRequestInputSchema.parse(request.input);
    const prepared = await prepareApplicationMessageRequest(
      env,
      runner.user.id,
      input
    );
    const config = applicationMessageTaskConfig(input.mode);
    const source = JSON.stringify(prepared.input);
    return await createAgentTaskRun(env.DB, runner, {
      leaseExpiresAt,
      model: config.model,
      outputSchema: APPLICATION_MESSAGE_OUTPUT_JSON_SCHEMA,
      prompt: applicationMessagePrompt(input.mode, prepared.input),
      promptVersion: config.promptVersion,
      reasoningEffort: config.reasoningEffort,
      sourceHash: await sha256(source),
      sourceTaskId: request.id,
      taskType: APPLICATION_MESSAGE_TASK_TYPE,
      webSearch: "disabled",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failAgentTaskRequest(env.DB, {
      error: message,
      requestId: request.id,
      runnerId: runner.id,
      userId: runner.user.id,
    });
    return null;
  }
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
  const plan = await buildApplicationMessageCompletionPlan(
    env,
    runner.user.id,
    input,
    rawOutput,
    run.model
  );
  const timestamp = new Date().toISOString();
  const results = await env.DB.batch([
    ...plan.statements,
    env.DB.prepare(
      `UPDATE agent_task_requests
          SET status='completed',result_json=?,error_detail='',completed_at=?,
              updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='claimed'`
    ).bind(
      JSON.stringify(plan.result),
      timestamp,
      timestamp,
      request.id,
      runner.user.id,
      runner.id
    ),
    env.DB.prepare(
      `UPDATE agent_task_runs
          SET status='completed',result_json=?,completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='running'`
    ).bind(
      JSON.stringify(plan.result),
      timestamp,
      timestamp,
      runId,
      runner.user.id,
      runner.id
    ),
  ]);
  const lifecycleResults = results.slice(-2);
  if (lifecycleResults.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new AgentTaskError(
      "Application message task could not be completed",
      409
    );
  }
  return plan.result;
}

async function buildApplicationMessageCompletionPlan(
  env: AppEnv,
  userId: string,
  input: ReturnType<typeof ApplicationMessageRequestInputSchema.parse>,
  rawOutput: unknown,
  modelId: string
) {
  if (input.kind === "job_draft") {
    return buildJobDraftTaskCompletion(env, userId, input, rawOutput, modelId);
  }
  if (input.kind === "anesl_bundle") {
    return buildAneslBundleTaskCompletion(
      env,
      userId,
      input,
      rawOutput,
      modelId
    );
  }
  return {
    result: await completeMessagePreviewTask(
      env,
      userId,
      input,
      rawOutput,
      modelId
    ),
    statements: [],
  };
}

async function prepareApplicationMessageRequest(
  env: AppEnv,
  userId: string,
  input: ReturnType<typeof ApplicationMessageRequestInputSchema.parse>
) {
  if (input.kind === "job_draft") {
    return (await prepareJobDraftTask(env, userId, input)).prepared;
  }
  if (input.kind === "anesl_bundle") {
    return (await prepareAneslBundleTask(env, userId, input)).prepared;
  }
  return prepareMessagePreviewTask(env, userId, input);
}

export async function failApplicationMessageTask(
  env: AppEnv,
  runner: AgentRunnerContext,
  requestId: string,
  runId: string,
  error: string
) {
  const request = await requireClaimedRequest(env.DB, runner, requestId);
  const timestamp = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE agent_task_requests
          SET status='failed',error_detail=?,completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='claimed'`
    ).bind(
      error.slice(0, 4000),
      timestamp,
      timestamp,
      request.id,
      runner.user.id,
      runner.id
    ),
    env.DB.prepare(
      `UPDATE agent_task_runs
          SET status='failed',error_detail=?,completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='running'`
    ).bind(error, timestamp, timestamp, runId, runner.user.id, runner.id),
  ]);
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    throw new AgentTaskError(
      "Application message task could not be failed",
      409
    );
  }
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
