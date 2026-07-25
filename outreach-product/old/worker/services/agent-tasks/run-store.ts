import type { AgentRunnerContext } from "../../app-types";
import {
  AgentTaskError,
  type AgentTaskRunRow,
  type PreparedAgentTask,
} from "./contracts";
import {
  agentTaskCompletionGuardStatement,
  agentTaskCompletionStatement,
  assertAgentTaskCompleted,
  guardedAgentTaskCompletionStatement,
  requestedAgentTaskCompletionGuardStatement,
  requestedAgentTaskCompletionStatement,
  requiredChangesAssertionStatement,
} from "./run-store/statements";

export async function createAgentTaskRun(
  db: D1Database,
  runner: AgentRunnerContext,
  task: Omit<PreparedAgentTask, "attemptNumber" | "leaseToken" | "runId"> & {
    sourceHash: string;
    sourceTaskId: string;
  }
) {
  const runId = crypto.randomUUID();
  const leaseToken = crypto.randomUUID();
  const result = await db
    .prepare(
      `INSERT INTO agent_task_runs
        (id,user_id,runner_id,task_type,source_task_id,prompt_version,model,
         reasoning_effort,source_hash,prompt_hash,status,started_at,
         lease_expires_at,updated_at,attempt_number,lease_token)
       SELECT ?,?,?,?,?,?,?,?,?,?,'running',
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              COALESCE((
                SELECT MAX(history.attempt_number)
                  FROM agent_task_runs history
                 WHERE history.user_id=? AND history.task_type=?
                   AND history.source_task_id=?
              ),0)+1,?
        WHERE EXISTS (
          SELECT 1 FROM agent_runners active_runner
           WHERE active_runner.id=? AND active_runner.user_id=?
             AND active_runner.revoked_at IS NULL
        )
      RETURNING attempt_number,lease_expires_at`
    )
    .bind(
      runId,
      runner.user.id,
      runner.id,
      task.taskType,
      task.sourceTaskId,
      task.promptVersion,
      task.model,
      task.reasoningEffort,
      task.sourceHash,
      await sha256(task.prompt),
      task.leaseExpiresAt,
      runner.user.id,
      task.taskType,
      task.sourceTaskId,
      leaseToken,
      runner.id,
      runner.user.id
    )
    .first<{ attempt_number: number; lease_expires_at: string }>();
  if (!result) {
    throw new AgentTaskError("Agent task run could not be created", 409);
  }
  return {
    artifacts: task.artifacts ?? [],
    attemptNumber: result.attempt_number,
    leaseExpiresAt: result.lease_expires_at,
    leaseToken,
    model: task.model,
    outputSchema: task.outputSchema,
    prompt: task.prompt,
    promptVersion: task.promptVersion,
    reasoningEffort: task.reasoningEffort,
    runId,
    taskType: task.taskType,
    webSearch: task.webSearch,
  };
}

export async function completeAgentTaskRun(
  db: D1Database,
  runnerId: string,
  runId: string,
  output: unknown
) {
  const result = await agentTaskCompletionStatement(
    db,
    runnerId,
    runId,
    output
  ).run();
  assertAgentTaskCompleted(result);
}

export interface AgentTaskCompletionFence<
  Values extends readonly unknown[] = readonly unknown[],
> {
  clause: string;
  values: Values;
}

export interface AgentTaskCompletionCondition {
  clause: string;
  values: readonly unknown[];
}

export interface AgentTaskCompletionWrite {
  expectedChanges?: number;
  statement: D1PreparedStatement;
}

export interface RequestedAgentTaskCompletionPlan<Result> {
  condition: AgentTaskCompletionCondition;
  result: Result;
  writes: AgentTaskCompletionWrite[];
}

export interface RequestedAgentTaskCompletionContext {
  attemptNumber: number;
  leaseToken: string;
  requestId: string;
  runId: string;
  runnerId: string;
  taskType: string;
  userId: string;
}

export async function completeAgentTaskRunWithDomainWrites(
  db: D1Database,
  runnerId: string,
  runId: string,
  output: unknown,
  domainStatements: (
    fence: AgentTaskCompletionFence<[string, string, string]>
  ) => D1PreparedStatement[]
) {
  const guardResultJson = JSON.stringify({
    completionGuard: crypto.randomUUID(),
  });
  const fence: AgentTaskCompletionFence<[string, string, string]> = {
    clause: `EXISTS (
      SELECT 1 FROM agent_task_runs completion_run
      JOIN agent_runners completion_runner
        ON completion_runner.id=completion_run.runner_id
       AND completion_runner.user_id=completion_run.user_id
       AND completion_runner.revoked_at IS NULL
       WHERE completion_run.id=?
         AND completion_run.runner_id=?
         AND completion_run.status='running'
         AND completion_run.result_json=?
         AND completion_run.lease_expires_at>
             strftime('%Y-%m-%dT%H:%M:%fZ','now')
    )`,
    values: [runId, runnerId, guardResultJson],
  };
  const statements = domainStatements(fence);
  const results = await db.batch([
    agentTaskCompletionGuardStatement(db, runnerId, runId, guardResultJson),
    ...statements,
    guardedAgentTaskCompletionStatement(
      db,
      runnerId,
      runId,
      guardResultJson,
      output
    ),
  ]);
  const guardResult = results.at(0);
  const completionResult = results.at(-1);
  assertAgentTaskCompleted(guardResult);
  assertAgentTaskCompleted(completionResult);
}

export async function completeRequestedAgentTaskWithDomainWrites<Result>(
  db: D1Database,
  context: RequestedAgentTaskCompletionContext,
  buildPlan: (
    fence: AgentTaskCompletionFence
  ) =>
    | Promise<RequestedAgentTaskCompletionPlan<Result>>
    | RequestedAgentTaskCompletionPlan<Result>
) {
  const guardResultJson = JSON.stringify({
    completionGuard: crypto.randomUUID(),
  });
  const fence: AgentTaskCompletionFence = {
    clause: `EXISTS (
      SELECT 1 FROM agent_task_runs completion_run
      JOIN agent_task_requests completion_request
        ON completion_request.id=completion_run.source_task_id
      JOIN agent_runners completion_runner
        ON completion_runner.id=completion_run.runner_id
       AND completion_runner.user_id=completion_run.user_id
       AND completion_runner.revoked_at IS NULL
       WHERE completion_run.id=?
         AND completion_run.runner_id=?
         AND completion_run.user_id=?
         AND completion_run.source_task_id=?
         AND completion_run.attempt_number=?
         AND completion_run.lease_token=?
         AND completion_run.status='running'
         AND completion_run.result_json=?
         AND completion_run.lease_expires_at>
             strftime('%Y-%m-%dT%H:%M:%fZ','now')
         AND completion_request.user_id=completion_run.user_id
         AND completion_request.runner_id=completion_run.runner_id
         AND completion_request.task_type=completion_run.task_type
         AND completion_request.status='claimed'
         AND completion_request.attempt_count=completion_run.attempt_number
         AND completion_request.lease_token=completion_run.lease_token
         AND completion_request.lease_expires_at>
             strftime('%Y-%m-%dT%H:%M:%fZ','now')
    )`,
    values: [
      context.runId,
      context.runnerId,
      context.userId,
      context.requestId,
      context.attemptNumber,
      context.leaseToken,
      guardResultJson,
    ],
  };
  const plan = await buildPlan(fence);
  const statements: D1PreparedStatement[] = [
    requestedAgentTaskCompletionGuardStatement(
      db,
      context,
      guardResultJson,
      plan.condition
    ),
    requiredChangesAssertionStatement(db, 1),
  ];
  for (const write of plan.writes) {
    statements.push(write.statement);
    if (write.expectedChanges !== undefined) {
      statements.push(
        requiredChangesAssertionStatement(db, write.expectedChanges)
      );
    }
  }
  statements.push(
    requestedAgentTaskCompletionStatement(
      db,
      context,
      guardResultJson,
      plan.result
    ),
    requiredChangesAssertionStatement(db, 1),
    guardedAgentTaskCompletionStatement(
      db,
      context.runnerId,
      context.runId,
      guardResultJson,
      plan.result
    ),
    requiredChangesAssertionStatement(db, 1)
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (isConstraintError(error)) {
      const completionError = new AgentTaskError(
        "Agent task state changed before completion",
        409
      );
      completionError.cause = error;
      throw completionError;
    }
    throw error;
  }
  return plan.result;
}

export async function failAgentTaskRun(
  db: D1Database,
  runnerId: string,
  runId: string,
  error: string
) {
  const result = await db
    .prepare(
      `UPDATE agent_task_runs
          SET status='failed',error_detail=?,error_code='runner_failure',
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND runner_id=? AND status='running'
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND EXISTS (
            SELECT 1 FROM agent_runners failure_runner
             WHERE failure_runner.id=agent_task_runs.runner_id
               AND failure_runner.user_id=agent_task_runs.user_id
               AND failure_runner.revoked_at IS NULL
          )`
    )
    .bind(error, runId, runnerId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new AgentTaskError("Agent task run could not be failed", 409);
  }
}

export async function readLastAgentTaskType(db: D1Database, runnerId: string) {
  const latest = await db
    .prepare(
      `SELECT task_type FROM agent_task_runs
        WHERE runner_id=? ORDER BY started_at DESC LIMIT 1`
    )
    .bind(runnerId)
    .first<{ task_type: string }>();
  return latest?.task_type ?? null;
}

export async function readOwnedRunningAgentTask(
  db: D1Database,
  runner: AgentRunnerContext,
  runId: string
) {
  const run = await db
    .prepare(
      `SELECT run.task_type,run.source_task_id,run.source_hash,run.model,
              run.status,run.attempt_number,run.lease_token
         FROM agent_task_runs run
         JOIN agent_runners active_runner
           ON active_runner.id=run.runner_id
          AND active_runner.user_id=run.user_id
          AND active_runner.revoked_at IS NULL
        WHERE run.id=? AND run.user_id=? AND run.runner_id=?`
    )
    .bind(runId, runner.user.id, runner.id)
    .first<AgentTaskRunRow>();
  if (!run) {
    throw new AgentTaskError("Agent task run was not found", 404);
  }
  if (run.status !== "running") {
    throw new AgentTaskError(`Agent task is already ${run.status}`, 409);
  }
  return run;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isConstraintError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLocaleLowerCase("en").includes("constraint")
  );
}
