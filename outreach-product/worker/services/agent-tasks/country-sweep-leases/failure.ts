import { AgentTaskError } from "../contracts";
import { isConstraintError, sha256 } from "../run-store";
import {
  type ActiveCountryTaskPairRow,
  type CountryTaskFailureContext,
  RETRYABLE_COUNTRY_FAILURES,
} from "./model";

export async function failCountryTaskAttempt(
  db: D1Database,
  context: CountryTaskFailureContext
) {
  const pair = await readCountryFailurePair(db, context);
  if (!pair) {
    throw new AgentTaskError("Country task lease changed before failure", 409);
  }
  const retry =
    (context.mode !== "runner" || isRetryableFailure(context.errorCode)) &&
    pair.attempt_count < pair.max_attempts;
  const failureGuard = JSON.stringify({ failureGuard: crypto.randomUUID() });
  const auditTask = await prepareCoverageAuditTask(pair);
  const statements: D1PreparedStatement[] = [
    countryFailureGuardStatement(db, context, failureGuard),
    requiredChangesAssertionStatement(db, 1),
    transitionCountryTaskAfterFailureStatement(
      db,
      context,
      failureGuard,
      retry
    ),
    requiredChangesAssertionStatement(db, 1),
    abandonCountryOutputStatement(db, context),
    requiredChangesAssertionStatement(db, 1),
    failCountryRunStatement(db, context, failureGuard),
    requiredChangesAssertionStatement(db, 1),
  ];
  if (!(retry || pair.phase === "coverage_audit")) {
    statements.push(
      insertCoverageAuditAfterFailureStatement(db, pair, auditTask)
    );
  }
  statements.push(
    updateCountrySweepAfterFailureStatement(db, pair, retry, context),
    requiredChangesAssertionStatement(db, 1)
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (isConstraintError(error)) {
      const failureError = new AgentTaskError(
        "Country task state changed before failure",
        409
      );
      failureError.cause = error;
      throw failureError;
    }
    throw error;
  }
  return { retry, status: retry ? ("queued" as const) : ("failed" as const) };
}

function readCountryFailurePair(
  db: D1Database,
  context: CountryTaskFailureContext
) {
  let temporalGuard = "runner.revoked_at IS NOT NULL";
  if (context.mode === "runner") {
    temporalGuard = `task.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND run.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND runner.revoked_at IS NULL`;
  } else if (context.mode === "expiry") {
    temporalGuard = `(task.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      OR run.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
  }
  return db
    .prepare(
      `SELECT task.id task_id,task.sweep_id,task.phase,task.attempt_count,
              task.max_attempts,task.lease_token,task.input_hash,
              sweep.country_code,sweep.country_name,
              sweep.requested_by_user_id user_id,run.id run_id,
              output.id output_id,
              task.worker_id runner_id,runner.revoked_at runner_revoked_at
         FROM country_sweep_tasks task
         JOIN country_sweeps sweep ON sweep.id=task.sweep_id
         JOIN agent_task_runs run
           ON run.id=? AND run.source_task_id=task.id
          AND run.user_id=sweep.requested_by_user_id
          AND run.runner_id=task.worker_id
          AND run.task_type='country_sweep.'||task.phase
          AND run.attempt_number=task.attempt_count
          AND run.lease_token=task.lease_token
          AND run.source_hash=task.input_hash
          AND run.status='running'
         JOIN agent_runners runner
           ON runner.id=task.worker_id
          AND runner.user_id=sweep.requested_by_user_id
         JOIN country_sweep_outputs output
           ON output.task_id=task.id AND output.agent_run_id=run.id
          AND output.attempt_number=task.attempt_count
          AND output.status='uploading'
        WHERE task.id=? AND task.sweep_id=?
          AND sweep.requested_by_user_id=? AND task.worker_id=?
          AND task.status='claimed' AND task.attempt_count=?
          AND task.lease_token=? AND task.input_hash=?
          AND ${temporalGuard}`
    )
    .bind(
      context.runId,
      context.taskId,
      context.sweepId,
      context.userId,
      context.runnerId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash
    )
    .first<ActiveCountryTaskPairRow>();
}

function abandonCountryOutputStatement(
  db: D1Database,
  context: CountryTaskFailureContext
) {
  return db
    .prepare(
      `UPDATE country_sweep_outputs
          SET status='abandoned',error_code=?,error_detail=?,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND sweep_id=? AND task_id=? AND agent_run_id=?
          AND attempt_number=? AND status='uploading'`
    )
    .bind(
      context.errorCode,
      context.errorDetail.slice(0, 4000),
      context.outputId,
      context.sweepId,
      context.taskId,
      context.runId,
      context.attemptNumber
    );
}

function countryFailureGuardStatement(
  db: D1Database,
  context: CountryTaskFailureContext,
  failureGuard: string
) {
  let temporalGuard = "runner.revoked_at IS NOT NULL";
  if (context.mode === "runner") {
    temporalGuard = `task.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND run.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND runner.revoked_at IS NULL`;
  } else if (context.mode === "expiry") {
    temporalGuard = `(task.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      OR run.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
  }
  return db
    .prepare(
      `UPDATE agent_task_runs AS run SET result_json=?
        WHERE run.id=? AND run.user_id=? AND run.runner_id=?
          AND run.task_type=? AND run.source_task_id=?
          AND run.attempt_number=? AND run.lease_token=?
          AND run.source_hash=? AND run.status='running'
          AND EXISTS (
            SELECT 1 FROM country_sweep_tasks task
            JOIN country_sweeps sweep ON sweep.id=task.sweep_id
            JOIN agent_runners runner
              ON runner.id=task.worker_id
             AND runner.user_id=sweep.requested_by_user_id
           WHERE task.id=run.source_task_id AND task.sweep_id=?
             AND sweep.requested_by_user_id=run.user_id
             AND task.worker_id=run.runner_id AND task.status='claimed'
             AND task.attempt_count=run.attempt_number
             AND task.lease_token=run.lease_token
             AND task.input_hash=run.source_hash AND ${temporalGuard}
          )`
    )
    .bind(
      failureGuard,
      context.runId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.taskId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash,
      context.sweepId
    );
}

function transitionCountryTaskAfterFailureStatement(
  db: D1Database,
  context: CountryTaskFailureContext,
  failureGuard: string,
  retry: boolean
) {
  return db
    .prepare(
      `UPDATE country_sweep_tasks
          SET status=?,worker_id=NULL,claimed_at=NULL,lease_token=NULL,
              lease_expires_at=NULL,error_code=?,error_detail=?,
              completed_at=CASE WHEN ?=1 THEN NULL ELSE
                strftime('%Y-%m-%dT%H:%M:%fZ','now') END,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND sweep_id=? AND worker_id=? AND status='claimed'
          AND attempt_count=? AND lease_token=? AND input_hash=?
          AND EXISTS (
            SELECT 1 FROM agent_task_runs failed_run
             WHERE failed_run.id=? AND failed_run.user_id=?
               AND failed_run.runner_id=? AND failed_run.task_type=?
               AND failed_run.source_task_id=country_sweep_tasks.id
               AND failed_run.attempt_number=country_sweep_tasks.attempt_count
               AND failed_run.lease_token=country_sweep_tasks.lease_token
               AND failed_run.source_hash=country_sweep_tasks.input_hash
               AND failed_run.status='running'
               AND failed_run.result_json=?
          )`
    )
    .bind(
      retry ? "queued" : "failed",
      context.errorCode,
      context.errorDetail.slice(0, 4000),
      retry ? 1 : 0,
      context.taskId,
      context.sweepId,
      context.runnerId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash,
      context.runId,
      context.userId,
      context.runnerId,
      context.taskType,
      failureGuard
    );
}

function failCountryRunStatement(
  db: D1Database,
  context: CountryTaskFailureContext,
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
          AND source_hash=? AND status='running' AND result_json=?`
    )
    .bind(
      context.errorCode,
      context.errorDetail.slice(0, 4000),
      context.runId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.taskId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash,
      failureGuard
    );
}

async function prepareCoverageAuditTask(pair: ActiveCountryTaskPairRow) {
  const id = crypto.randomUUID();
  const inputJson = JSON.stringify({
    countryCode: pair.country_code,
    countryName: pair.country_name,
    phase: "coverage_audit",
    progress: { source: "terminal_task_failure" },
  });
  return {
    id,
    inputHash: await sha256(inputJson),
    inputJson,
    scopeKey: `coverage:failure:${pair.task_id}:${pair.attempt_count}`,
  };
}

function insertCoverageAuditAfterFailureStatement(
  db: D1Database,
  pair: ActiveCountryTaskPairRow,
  auditTask: Awaited<ReturnType<typeof prepareCoverageAuditTask>>
) {
  return db
    .prepare(
      `INSERT INTO country_sweep_tasks
        (id,sweep_id,phase,scope_key,status,input_json,input_hash,
         created_at,updated_at)
       SELECT ?,?,'coverage_audit',?,'queued',?,?,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE NOT EXISTS (
          SELECT 1 FROM country_sweep_tasks active_task
           WHERE active_task.sweep_id=?
             AND active_task.phase IN ('discovery','verification')
             AND active_task.status IN ('queued','claimed','materializing')
        )
          AND NOT EXISTS (
            SELECT 1 FROM country_sweep_tasks active_audit
             WHERE active_audit.sweep_id=?
               AND active_audit.phase='coverage_audit'
               AND active_audit.status IN ('queued','claimed','materializing')
          )
       ON CONFLICT(sweep_id,phase,scope_key) DO NOTHING`
    )
    .bind(
      auditTask.id,
      pair.sweep_id,
      auditTask.scopeKey,
      auditTask.inputJson,
      auditTask.inputHash,
      pair.sweep_id,
      pair.sweep_id
    );
}

function updateCountrySweepAfterFailureStatement(
  db: D1Database,
  pair: ActiveCountryTaskPairRow,
  retry: boolean,
  context: CountryTaskFailureContext
) {
  const terminalCoverageFailure = pair.phase === "coverage_audit" && !retry;
  return db
    .prepare(
      `UPDATE country_sweeps
          SET status=CASE WHEN ?=1 THEN 'failed' ELSE 'running' END,
              task_total=(
                SELECT COUNT(*) FROM country_sweep_tasks task
                 WHERE task.sweep_id=country_sweeps.id
              ),
              task_completed=(
                SELECT COUNT(*) FROM country_sweep_tasks task
                 WHERE task.sweep_id=country_sweeps.id
                   AND task.status='completed'
              ),
              task_failed=(
                SELECT COUNT(*) FROM country_sweep_tasks task
                 WHERE task.sweep_id=country_sweeps.id AND task.status='failed'
              ),
              missing_scope_count=(
                SELECT COUNT(*) FROM country_sweep_tasks task
                 WHERE task.sweep_id=country_sweeps.id AND task.status='failed'
                   AND task.phase IN ('discovery','verification')
              ),
              error_detail=CASE WHEN ?=1 THEN ? ELSE error_detail END,
              completed_at=CASE WHEN ?=1 THEN
                strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND requested_by_user_id=? AND status='running'
          AND EXISTS (
            SELECT 1 FROM country_sweep_tasks failed_task
             WHERE failed_task.id=? AND failed_task.sweep_id=country_sweeps.id
               AND failed_task.attempt_count=? AND failed_task.status=?
               AND failed_task.error_code=?
          )`
    )
    .bind(
      terminalCoverageFailure ? 1 : 0,
      terminalCoverageFailure ? 1 : 0,
      context.errorDetail.slice(0, 4000),
      terminalCoverageFailure ? 1 : 0,
      pair.sweep_id,
      pair.user_id,
      pair.task_id,
      pair.attempt_count,
      retry ? "queued" : "failed",
      context.errorCode
    );
}

function isRetryableFailure(code: CountryTaskFailureContext["errorCode"]) {
  return RETRYABLE_COUNTRY_FAILURES.has(code);
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
