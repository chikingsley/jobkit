import { AgentTaskError } from "../contracts";
import { failRequestedAgentTaskWithDomainWrites } from "../requested-task-leases";
import type {
  AgentTaskCompletionFence,
  AgentTaskCompletionWrite,
} from "../run-store";
import {
  type ActiveRequestedPairRow,
  AGENT_TASK_REAPER_LIMIT,
  LEASE_SQL_MODIFIER,
  type RequestedAgentTaskClaimContext,
  type RequestedAgentTaskFailureContext,
  type RequestedAgentTaskSpecification,
} from "./model";

export async function expireRequestedAgentTasks(
  db: D1Database,
  userId: string | null,
  buildWrites: (
    pair: ActiveRequestedPairRow,
    retry: boolean,
    fence: AgentTaskCompletionFence,
    errorDetail: string
  ) => Promise<AgentTaskCompletionWrite[]> | AgentTaskCompletionWrite[]
) {
  const rows = await db
    .prepare(
      `SELECT request.id,request.user_id,request.runner_id,request.task_type,
              request.attempt_count,request.max_attempts,request.lease_token,
              request.error_detail,request.subject_id,request.input_json,
              run.id run_id,runner.revoked_at runner_revoked_at
         FROM agent_task_requests request
         JOIN agent_task_runs run
           ON run.source_task_id=request.id
          AND run.user_id=request.user_id
          AND run.runner_id=request.runner_id
          AND run.task_type=request.task_type
          AND run.attempt_number=request.attempt_count
          AND run.lease_token=request.lease_token
          AND run.status='running'
         LEFT JOIN agent_runners runner
           ON runner.id=request.runner_id AND runner.user_id=request.user_id
        WHERE (? IS NULL OR request.user_id=?)
          AND request.status='claimed'
          AND (
            request.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            OR run.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            OR runner.revoked_at IS NOT NULL
          )
        ORDER BY request.claimed_at,request.id LIMIT ?`
    )
    .bind(userId, userId, AGENT_TASK_REAPER_LIMIT)
    .all<ActiveRequestedPairRow>();
  let processed = 0;
  for (const pair of rows.results) {
    const revoked = Boolean(pair.runner_revoked_at);
    const context: RequestedAgentTaskFailureContext = {
      attemptNumber: pair.attempt_count,
      errorCode: revoked ? "runner_revoked" : "lease_expired",
      errorDetail: revoked ? "Runner revoked" : "Runner lease expired",
      leaseToken: pair.lease_token,
      mode: revoked ? "revocation" : "expiry",
      requestId: pair.id,
      runId: pair.run_id,
      runnerId: pair.runner_id,
      taskType: pair.task_type,
      userId: pair.user_id,
    };
    const retry = pair.attempt_count < pair.max_attempts;
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Each exact leased pair owns one bounded atomic transition.
      await failRequestedAgentTaskWithDomainWrites(db, context, (_, fence) =>
        buildWrites(pair, retry, fence, context.errorDetail)
      );
      processed += 1;
    } catch (error) {
      if (!(error instanceof AgentTaskError && error.status === 409)) {
        throw error;
      }
    }
  }
  return { processed, selected: rows.results.length };
}

export function claimRequestStatement(
  db: D1Database,
  context: RequestedAgentTaskClaimContext
) {
  return db
    .prepare(
      `UPDATE agent_task_requests
          SET status='claimed',runner_id=?,attempt_count=attempt_count+1,
              lease_token=?,claimed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?),
              next_attempt_at=NULL,error_detail='',last_error_code='',
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND user_id=? AND task_type=? AND status='queued'
          AND attempt_count=? AND attempt_count<max_attempts
          AND (next_attempt_at IS NULL OR next_attempt_at<=
               strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          AND EXISTS (
            SELECT 1 FROM agent_runners claim_runner
             WHERE claim_runner.id=? AND claim_runner.user_id=?
               AND claim_runner.revoked_at IS NULL
          )
      RETURNING attempt_count,lease_expires_at`
    )
    .bind(
      context.runnerId,
      context.leaseToken,
      LEASE_SQL_MODIFIER,
      context.requestId,
      context.userId,
      context.taskType,
      context.attemptNumber - 1,
      context.runnerId,
      context.userId
    );
}

export function insertRequestedRunStatement(
  db: D1Database,
  context: RequestedAgentTaskClaimContext,
  task: RequestedAgentTaskSpecification,
  promptHash: string
) {
  return db
    .prepare(
      `INSERT INTO agent_task_runs
        (id,user_id,runner_id,task_type,source_task_id,prompt_version,model,
         reasoning_effort,source_hash,prompt_hash,status,started_at,
         lease_expires_at,updated_at,attempt_number,lease_token)
       SELECT ?,request.user_id,request.runner_id,request.task_type,request.id,
              ?,?,?,?,?, 'running',
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),request.lease_expires_at,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),request.attempt_count,
              request.lease_token
         FROM agent_task_requests request
         JOIN agent_runners claim_runner
           ON claim_runner.id=request.runner_id
          AND claim_runner.user_id=request.user_id
          AND claim_runner.revoked_at IS NULL
        WHERE request.id=? AND request.user_id=? AND request.runner_id=?
          AND request.task_type=? AND request.status='claimed'
          AND request.attempt_count=? AND request.lease_token=?`
    )
    .bind(
      context.runId,
      task.promptVersion,
      task.model,
      task.reasoningEffort,
      task.sourceHash,
      promptHash,
      context.requestId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.attemptNumber,
      context.leaseToken
    );
}

export function activePairFence(
  context: RequestedAgentTaskClaimContext
): AgentTaskCompletionFence {
  return {
    clause: `EXISTS (
      SELECT 1 FROM agent_task_requests claim_request
      JOIN agent_task_runs claim_run
        ON claim_run.source_task_id=claim_request.id
       AND claim_run.user_id=claim_request.user_id
       AND claim_run.runner_id=claim_request.runner_id
       AND claim_run.task_type=claim_request.task_type
       AND claim_run.attempt_number=claim_request.attempt_count
       AND claim_run.lease_token=claim_request.lease_token
      JOIN agent_runners claim_runner
        ON claim_runner.id=claim_request.runner_id
       AND claim_runner.user_id=claim_request.user_id
       AND claim_runner.revoked_at IS NULL
      WHERE claim_request.id=? AND claim_run.id=?
        AND claim_request.user_id=? AND claim_request.runner_id=?
        AND claim_request.task_type=? AND claim_request.status='claimed'
        AND claim_request.attempt_count=? AND claim_request.lease_token=?
        AND claim_run.status='running'
    )`,
    values: [
      context.requestId,
      context.runId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.attemptNumber,
      context.leaseToken,
    ],
  };
}

export function guardedFailureFence(
  context: RequestedAgentTaskFailureContext,
  failureGuard: string
): AgentTaskCompletionFence {
  return {
    clause: `EXISTS (
      SELECT 1 FROM agent_task_runs failure_run
       WHERE failure_run.id=? AND failure_run.user_id=?
         AND failure_run.runner_id=? AND failure_run.task_type=?
         AND failure_run.source_task_id=? AND failure_run.attempt_number=?
         AND failure_run.lease_token=? AND failure_run.status='running'
         AND failure_run.result_json=?
    )`,
    values: [
      context.runId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.requestId,
      context.attemptNumber,
      context.leaseToken,
      failureGuard,
    ],
  };
}
