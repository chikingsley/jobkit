import { AgentTaskError } from "../contracts";
import type {
  AgentTaskCompletionCondition,
  RequestedAgentTaskCompletionContext,
} from "../run-store";

export function agentTaskCompletionStatement(
  db: D1Database,
  runnerId: string,
  runId: string,
  output: unknown
) {
  return db
    .prepare(
      `UPDATE agent_task_runs
          SET status='completed',result_json=?,
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND runner_id=? AND status='running'
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND EXISTS (
            SELECT 1 FROM agent_runners completion_runner
             WHERE completion_runner.id=agent_task_runs.runner_id
               AND completion_runner.user_id=agent_task_runs.user_id
               AND completion_runner.revoked_at IS NULL
          )`
    )
    .bind(JSON.stringify(output), runId, runnerId);
}

export function agentTaskCompletionGuardStatement(
  db: D1Database,
  runnerId: string,
  runId: string,
  guardResultJson: string
) {
  return db
    .prepare(
      `UPDATE agent_task_runs
          SET result_json=?
        WHERE id=? AND runner_id=? AND status='running'
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND EXISTS (
            SELECT 1 FROM agent_runners completion_runner
             WHERE completion_runner.id=agent_task_runs.runner_id
               AND completion_runner.user_id=agent_task_runs.user_id
               AND completion_runner.revoked_at IS NULL
          )`
    )
    .bind(guardResultJson, runId, runnerId);
}

export function requestedAgentTaskCompletionGuardStatement(
  db: D1Database,
  context: RequestedAgentTaskCompletionContext,
  guardResultJson: string,
  condition: AgentTaskCompletionCondition
) {
  return db
    .prepare(
      `UPDATE agent_task_runs
          SET result_json=?
        WHERE id=? AND runner_id=? AND user_id=? AND source_task_id=?
          AND task_type=? AND status='running'
          AND attempt_number=? AND lease_token=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND EXISTS (
            SELECT 1 FROM agent_task_requests completion_request
             WHERE completion_request.id=?
               AND completion_request.user_id=?
               AND completion_request.runner_id=?
               AND completion_request.task_type=?
               AND completion_request.status='claimed'
               AND completion_request.attempt_count=?
               AND completion_request.lease_token=?
               AND completion_request.lease_expires_at>
                   strftime('%Y-%m-%dT%H:%M:%fZ','now')
          )
          AND (${condition.clause})`
    )
    .bind(
      guardResultJson,
      context.runId,
      context.runnerId,
      context.userId,
      context.requestId,
      context.taskType,
      context.attemptNumber,
      context.leaseToken,
      context.requestId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.attemptNumber,
      context.leaseToken,
      ...condition.values
    );
}

export function requestedAgentTaskCompletionStatement(
  db: D1Database,
  context: RequestedAgentTaskCompletionContext,
  guardResultJson: string,
  output: unknown
) {
  return db
    .prepare(
      `UPDATE agent_task_requests
          SET status='completed',result_json=?,error_detail='',
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              runner_id=NULL,claimed_at=NULL,lease_expires_at=NULL,
              lease_token=NULL,next_attempt_at=NULL,last_error_code='',
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND user_id=? AND runner_id=? AND task_type=?
          AND status='claimed'
          AND attempt_count=? AND lease_token=?
          AND EXISTS (
            SELECT 1 FROM agent_task_runs completion_run
             WHERE completion_run.id=?
               AND completion_run.runner_id=?
               AND completion_run.user_id=?
               AND completion_run.source_task_id=?
               AND completion_run.attempt_number=?
               AND completion_run.lease_token=?
               AND completion_run.status='running'
               AND completion_run.result_json=?
          )`
    )
    .bind(
      JSON.stringify(output),
      context.requestId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.attemptNumber,
      context.leaseToken,
      context.runId,
      context.runnerId,
      context.userId,
      context.requestId,
      context.attemptNumber,
      context.leaseToken,
      guardResultJson
    );
}

export function requiredChangesAssertionStatement(
  db: D1Database,
  expectedChanges: number
) {
  return db
    .prepare(
      `INSERT INTO transaction_assertions(must_equal_one)
       SELECT 0 WHERE changes()<>?`
    )
    .bind(expectedChanges);
}

export function guardedAgentTaskCompletionStatement(
  db: D1Database,
  runnerId: string,
  runId: string,
  guardResultJson: string,
  output: unknown
) {
  return db
    .prepare(
      `UPDATE agent_task_runs
          SET status='completed',result_json=?,
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND runner_id=? AND status='running' AND result_json=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND EXISTS (
            SELECT 1 FROM agent_runners completion_runner
             WHERE completion_runner.id=agent_task_runs.runner_id
               AND completion_runner.user_id=agent_task_runs.user_id
               AND completion_runner.revoked_at IS NULL
          )`
    )
    .bind(JSON.stringify(output), runId, runnerId, guardResultJson);
}

export function assertAgentTaskCompleted(result: D1Result | undefined) {
  if ((result?.meta.changes ?? 0) !== 1) {
    throw new AgentTaskError("Agent task run could not be completed", 409);
  }
}
