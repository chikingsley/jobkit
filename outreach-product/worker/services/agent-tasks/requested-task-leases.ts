import type { AgentRunnerContext } from "../../app-types";
import type { QueuedAgentTaskRequest } from "../agent-task-requests";
import {
  AgentTaskClaimLostError,
  AgentTaskError,
  type PreparedAgentTask,
} from "./contracts";
import {
  activePairFence,
  claimRequestStatement,
  guardedFailureFence,
  insertRequestedRunStatement,
} from "./requested-task-leases/claims";
import {
  appendWrites,
  failRunStatement,
  failureGuardStatement,
  isRetryableFailure,
  readFailurePair,
  requiredChangesAssertionStatement,
  retryOutboxStatement,
  transitionRequestAfterFailureStatement,
} from "./requested-task-leases/failure";
import {
  LEASE_SQL_MODIFIER,
  type RequestedAgentTaskClaimContext,
  type RequestedAgentTaskFailureContext,
  type RequestedAgentTaskSpecification,
} from "./requested-task-leases/model";
import {
  type AgentTaskCompletionFence,
  type AgentTaskCompletionWrite,
  isConstraintError,
  sha256,
} from "./run-store";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export { expireRequestedAgentTasks } from "./requested-task-leases/claims";
export type {
  ActiveRequestedPairRow,
  RequestedAgentTaskClaimContext,
  RequestedAgentTaskFailureContext,
  RequestedAgentTaskSpecification,
} from "./requested-task-leases/model";
export { AGENT_TASK_REAPER_LIMIT } from "./requested-task-leases/model";

export async function claimRequestedAgentTaskWithDomainWrites(
  db: D1Database,
  runner: AgentRunnerContext,
  request: QueuedAgentTaskRequest,
  task: RequestedAgentTaskSpecification,
  buildWrites: (
    context: RequestedAgentTaskClaimContext,
    fence: AgentTaskCompletionFence
  ) =>
    | Promise<AgentTaskCompletionWrite[]>
    | AgentTaskCompletionWrite[] = () => []
): Promise<PreparedAgentTask | null> {
  const runId = crypto.randomUUID();
  const leaseToken = crypto.randomUUID();
  const context: RequestedAgentTaskClaimContext = {
    attemptNumber: request.attemptCount + 1,
    leaseToken,
    requestId: request.id,
    runId,
    runnerId: runner.id,
    taskType: request.taskType,
    userId: runner.user.id,
  };
  const fence = activePairFence(context);
  const writes = await buildWrites(context, fence);
  const statements: D1PreparedStatement[] = [
    claimRequestStatement(db, context),
    requiredChangesAssertionStatement(db, 1),
    insertRequestedRunStatement(db, context, task, await sha256(task.prompt)),
    requiredChangesAssertionStatement(db, 1),
  ];
  appendWrites(db, statements, writes);
  try {
    const results = await db.batch(statements);
    const claim = results[0]?.results?.[0] as
      | { attempt_count?: number; lease_expires_at?: string }
      | undefined;
    const attemptNumber = Number(claim?.attempt_count ?? 0);
    const leaseExpiresAt = String(claim?.lease_expires_at ?? "");
    if (!(attemptNumber > 0 && leaseExpiresAt)) {
      throw new AgentTaskError("Agent task claim returned no lease", 409);
    }
    return {
      artifacts: task.artifacts ?? [],
      attemptNumber,
      leaseExpiresAt,
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
  } catch (error) {
    if (isConstraintError(error)) {
      const [current, revokedAt] = await Promise.all([
        db
          .prepare(
            `SELECT status,attempt_count FROM agent_task_requests
              WHERE id=? AND user_id=? AND task_type=?`
          )
          .bind(context.requestId, context.userId, context.taskType)
          .first<{ attempt_count: number; status: string }>(),
        db
          .prepare(
            "SELECT revoked_at FROM agent_runners WHERE id=? AND user_id=?"
          )
          .bind(context.runnerId, context.userId)
          .first<string>("revoked_at"),
      ]);
      const claimWasLost =
        current?.status !== "queued" ||
        current?.attempt_count !== request.attemptCount;
      if (claimWasLost || revokedAt) {
        throw new AgentTaskClaimLostError(
          "Agent task claim was resolved by another transition",
          { cause: error }
        );
      }
      const claimError = new AgentTaskError(
        "Agent task claim transaction violated an invariant",
        409
      );
      claimError.cause = error;
      throw claimError;
    }
    throw error;
  }
}

export async function heartbeatRequestedAgentTask(
  db: D1Database,
  context: RequestedAgentTaskClaimContext
) {
  const statements = [
    db
      .prepare(
        `UPDATE agent_task_requests
            SET lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?),
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND user_id=? AND runner_id=? AND task_type=?
            AND status='claimed' AND attempt_count=? AND lease_token=?
            AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
            AND EXISTS (
              SELECT 1 FROM agent_task_runs heartbeat_run
               WHERE heartbeat_run.id=?
                 AND heartbeat_run.user_id=agent_task_requests.user_id
                 AND heartbeat_run.runner_id=agent_task_requests.runner_id
                 AND heartbeat_run.task_type=agent_task_requests.task_type
                 AND heartbeat_run.source_task_id=agent_task_requests.id
                 AND heartbeat_run.attempt_number=agent_task_requests.attempt_count
                 AND heartbeat_run.lease_token=agent_task_requests.lease_token
                 AND heartbeat_run.status='running'
                 AND heartbeat_run.lease_expires_at>
                     strftime('%Y-%m-%dT%H:%M:%fZ','now')
            )
            AND EXISTS (
              SELECT 1 FROM agent_runners heartbeat_runner
               WHERE heartbeat_runner.id=agent_task_requests.runner_id
                 AND heartbeat_runner.user_id=agent_task_requests.user_id
                 AND heartbeat_runner.revoked_at IS NULL
            )
        RETURNING lease_expires_at`
      )
      .bind(
        LEASE_SQL_MODIFIER,
        context.requestId,
        context.userId,
        context.runnerId,
        context.taskType,
        context.attemptNumber,
        context.leaseToken,
        context.runId
      ),
    requiredChangesAssertionStatement(db, 1),
    db
      .prepare(
        `UPDATE agent_task_runs
            SET lease_expires_at=(
                  SELECT lease_expires_at FROM agent_task_requests
                   WHERE id=? AND user_id=? AND runner_id=?
                     AND status='claimed' AND attempt_count=? AND lease_token=?
                ),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND user_id=? AND runner_id=? AND task_type=?
            AND source_task_id=? AND status='running'
            AND attempt_number=? AND lease_token=?`
      )
      .bind(
        context.requestId,
        context.userId,
        context.runnerId,
        context.attemptNumber,
        context.leaseToken,
        context.runId,
        context.userId,
        context.runnerId,
        context.taskType,
        context.requestId,
        context.attemptNumber,
        context.leaseToken
      ),
    requiredChangesAssertionStatement(db, 1),
  ];
  try {
    const results = await db.batch(statements);
    const row = results[0]?.results?.[0] as
      | { lease_expires_at?: string }
      | undefined;
    return { leaseExpiresAt: String(row?.lease_expires_at ?? "") };
  } catch (error) {
    if (isConstraintError(error)) {
      const heartbeatError = new AgentTaskError(
        "Agent task lease changed before heartbeat",
        409
      );
      heartbeatError.cause = error;
      throw heartbeatError;
    }
    throw error;
  }
}

export async function failRequestedAgentTaskWithDomainWrites(
  db: D1Database,
  context: RequestedAgentTaskFailureContext,
  buildWrites: (
    retry: boolean,
    fence: AgentTaskCompletionFence
  ) =>
    | Promise<AgentTaskCompletionWrite[]>
    | AgentTaskCompletionWrite[] = () => []
) {
  const pair = await readFailurePair(db, context);
  if (!pair) {
    throw new AgentTaskError("Agent task lease changed before failure", 409);
  }
  const retry =
    isRetryableFailure(context.errorCode) &&
    pair.attempt_count < pair.max_attempts;
  const failureGuard = JSON.stringify({ failureGuard: crypto.randomUUID() });
  const fence = guardedFailureFence(context, failureGuard);
  const writes = await buildWrites(retry, fence);
  const statements: D1PreparedStatement[] = [
    failureGuardStatement(db, context, failureGuard),
    requiredChangesAssertionStatement(db, 1),
  ];
  appendWrites(db, statements, writes);
  statements.push(
    failRunStatement(db, context, failureGuard),
    requiredChangesAssertionStatement(db, 1),
    transitionRequestAfterFailureStatement(db, context, retry),
    requiredChangesAssertionStatement(db, 1)
  );
  if (retry) {
    statements.push(
      retryOutboxStatement(db, context),
      requiredChangesAssertionStatement(db, 1)
    );
  }
  try {
    await db.batch(statements);
  } catch (error) {
    if (isConstraintError(error)) {
      const failureError = new AgentTaskError(
        "Agent task state changed before failure",
        409
      );
      failureError.cause = error;
      throw failureError;
    }
    throw error;
  }
  return { retry, status: retry ? ("queued" as const) : ("failed" as const) };
}
