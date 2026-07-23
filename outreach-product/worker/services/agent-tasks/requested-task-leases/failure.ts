import type { AgentTaskCompletionWrite } from "../run-store";
import type {
  ActiveRequestedPairRow,
  RequestedAgentTaskFailureContext,
} from "./model";

export function failureGuardStatement(
  db: D1Database,
  context: RequestedAgentTaskFailureContext,
  failureGuard: string
) {
  let temporalGuard = "runner.revoked_at IS NOT NULL";
  if (context.mode === "runner") {
    temporalGuard = `request.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
         AND run.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
         AND runner.revoked_at IS NULL`;
  } else if (context.mode === "expiry") {
    temporalGuard = `(request.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            OR run.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
  }
  return db
    .prepare(
      `UPDATE agent_task_runs AS run SET result_json=?
        WHERE run.id=? AND run.user_id=? AND run.runner_id=?
          AND run.task_type=? AND run.source_task_id=?
          AND run.attempt_number=? AND run.lease_token=?
          AND run.status='running'
          AND EXISTS (
            SELECT 1 FROM agent_task_requests request
            JOIN agent_runners runner
              ON runner.id=request.runner_id AND runner.user_id=request.user_id
           WHERE request.id=run.source_task_id
             AND request.user_id=run.user_id
             AND request.runner_id=run.runner_id
             AND request.task_type=run.task_type
             AND request.status='claimed'
             AND request.attempt_count=run.attempt_number
             AND request.lease_token=run.lease_token
             AND ${temporalGuard}
          )`
    )
    .bind(
      failureGuard,
      context.runId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.requestId,
      context.attemptNumber,
      context.leaseToken
    );
}

export function failRunStatement(
  db: D1Database,
  context: RequestedAgentTaskFailureContext,
  failureGuard: string
) {
  return db
    .prepare(
      `UPDATE agent_task_runs
          SET status='failed',result_json=NULL,error_code=?,error_detail=?,
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND user_id=? AND runner_id=? AND task_type=?
          AND source_task_id=? AND attempt_number=? AND lease_token=?
          AND status='running' AND result_json=?`
    )
    .bind(
      context.errorCode,
      context.errorDetail.slice(0, 4000),
      context.runId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.requestId,
      context.attemptNumber,
      context.leaseToken,
      failureGuard
    );
}

export function transitionRequestAfterFailureStatement(
  db: D1Database,
  context: RequestedAgentTaskFailureContext,
  retry: boolean
) {
  return db
    .prepare(
      `UPDATE agent_task_requests
          SET status=?,runner_id=NULL,claimed_at=NULL,lease_expires_at=NULL,
              lease_token=NULL,
              next_attempt_at=CASE WHEN ?=1 THEN
                strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
              last_error_code=?,error_detail=?,
              completed_at=CASE WHEN ?=1 THEN NULL ELSE
                strftime('%Y-%m-%dT%H:%M:%fZ','now') END,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND user_id=? AND runner_id=? AND task_type=?
          AND status='claimed' AND attempt_count=? AND lease_token=?
          AND EXISTS (
            SELECT 1 FROM agent_task_runs failed_run
             WHERE failed_run.id=? AND failed_run.user_id=?
               AND failed_run.runner_id=? AND failed_run.task_type=?
               AND failed_run.source_task_id=?
               AND failed_run.attempt_number=?
               AND failed_run.lease_token=? AND failed_run.status='failed'
               AND failed_run.error_code=?
          )`
    )
    .bind(
      retry ? "queued" : "failed",
      retry ? 1 : 0,
      context.errorCode,
      context.errorDetail.slice(0, 4000),
      retry ? 1 : 0,
      context.requestId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.attemptNumber,
      context.leaseToken,
      context.runId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.requestId,
      context.attemptNumber,
      context.leaseToken,
      context.errorCode
    );
}

export function retryOutboxStatement(
  db: D1Database,
  context: RequestedAgentTaskFailureContext
) {
  return db
    .prepare(
      `INSERT INTO work_outbox
        (id,topic,aggregate_id,available_at,created_at)
       SELECT ?,'agent_task.request.ready',?,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE EXISTS (
          SELECT 1 FROM agent_task_requests retry_request
           WHERE retry_request.id=? AND retry_request.status='queued'
             AND retry_request.attempt_count=?
             AND retry_request.last_error_code=?
        )`
    )
    .bind(
      `agent-task-retry:${context.runId}`,
      context.requestId,
      context.requestId,
      context.attemptNumber,
      context.errorCode
    );
}

export function readFailurePair(
  db: D1Database,
  context: RequestedAgentTaskFailureContext
) {
  return db
    .prepare(
      `SELECT request.id,request.user_id,request.runner_id,request.task_type,
              request.attempt_count,request.max_attempts,request.lease_token,
              request.error_detail,request.subject_id,request.input_json,
              run.id run_id
         FROM agent_task_requests request
         JOIN agent_task_runs run
           ON run.source_task_id=request.id
          AND run.user_id=request.user_id
          AND run.runner_id=request.runner_id
          AND run.task_type=request.task_type
          AND run.attempt_number=request.attempt_count
          AND run.lease_token=request.lease_token
        WHERE request.id=? AND request.user_id=? AND request.runner_id=?
          AND request.task_type=? AND request.status='claimed'
          AND request.attempt_count=? AND request.lease_token=?
          AND run.id=? AND run.status='running'`
    )
    .bind(
      context.requestId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.attemptNumber,
      context.leaseToken,
      context.runId
    )
    .first<ActiveRequestedPairRow>();
}

export function appendWrites(
  db: D1Database,
  statements: D1PreparedStatement[],
  writes: AgentTaskCompletionWrite[]
) {
  for (const write of writes) {
    statements.push(write.statement);
    if (write.expectedChanges !== undefined) {
      statements.push(
        requiredChangesAssertionStatement(db, write.expectedChanges)
      );
    }
  }
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

export function isRetryableFailure(
  errorCode: RequestedAgentTaskFailureContext["errorCode"]
) {
  return [
    "d1_unavailable",
    "lease_expired",
    "provider_transport",
    "provider_unavailable",
    "r2_unavailable",
    "runner_failure",
    "runner_revoked",
  ].includes(errorCode);
}
