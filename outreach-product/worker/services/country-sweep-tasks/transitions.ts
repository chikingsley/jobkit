import type { CountrySweepTaskOutput } from "../../../src/features/countries/schema";
import type { CountryTaskLeaseContext } from "../agent-tasks/country-sweep-leases";
import type { CompletionTaskRow, PreparedFollowUpTask } from "./model";

export function completeCountryTaskStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  outputJson: string,
  completionGuard: string
) {
  return db
    .prepare(
      `UPDATE country_sweep_tasks
          SET status='completed',output_json=?,worker_id=NULL,lease_token=NULL,
              lease_expires_at=NULL,error_code='',error_detail='',
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND sweep_id=? AND worker_id=? AND status='claimed'
          AND attempt_count=? AND lease_token=? AND input_hash=?
          AND ${completionFenceSql("(SELECT requested_by_user_id FROM country_sweeps WHERE id=country_sweep_tasks.sweep_id)")}`
    )
    .bind(
      outputJson,
      context.taskId,
      context.sweepId,
      context.runnerId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash,
      ...completionFenceValues(context, completionGuard)
    );
}

export function insertCoverageAuditStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  task: PreparedFollowUpTask,
  completionGuard: string
) {
  return db
    .prepare(
      `INSERT INTO country_sweep_tasks
        (id,sweep_id,phase,scope_key,status,input_json,input_hash,
         created_at,updated_at)
       SELECT ?,?,'coverage_audit',?,'queued',?,?,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
       FROM country_sweeps sweep WHERE sweep.id=?
         AND NOT EXISTS (
           SELECT 1 FROM country_sweep_tasks active_task
            WHERE active_task.sweep_id=sweep.id
              AND active_task.phase IN ('discovery','verification')
              AND active_task.status IN ('queued','claimed','materializing')
         )
         AND NOT EXISTS (
           SELECT 1 FROM country_sweep_tasks active_audit
            WHERE active_audit.sweep_id=sweep.id
              AND active_audit.phase='coverage_audit'
              AND active_audit.status IN ('queued','claimed','materializing')
         )
         AND ${completionFenceSql("sweep.requested_by_user_id")}
       ON CONFLICT(sweep_id,phase,scope_key) DO NOTHING`
    )
    .bind(
      task.id,
      context.sweepId,
      task.scopeKey,
      task.inputJson,
      task.inputHash,
      context.sweepId,
      ...completionFenceValues(context, completionGuard)
    );
}

export function advanceCountrySweepStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  task: CompletionTaskRow,
  output: CountrySweepTaskOutput,
  completionGuard: string
) {
  const isCoverageAudit = task.phase === "coverage_audit";
  const coverageSummaryJson = JSON.stringify(output.coverageSummary);
  return db
    .prepare(
      `UPDATE country_sweeps
          SET status=CASE
                WHEN ?=1 AND NOT EXISTS (
                  SELECT 1 FROM country_sweep_tasks active_task
                   WHERE active_task.sweep_id=country_sweeps.id
                     AND active_task.status IN ('queued','claimed','materializing')
                ) THEN CASE WHEN EXISTS (
                  SELECT 1 FROM country_sweep_tasks failed_task
                   WHERE failed_task.sweep_id=country_sweeps.id
                     AND failed_task.status='failed'
                     AND failed_task.phase IN ('discovery','verification')
                ) THEN 'completed_with_gaps' ELSE 'completed' END
                ELSE 'running' END,
              coverage_summary_json=CASE WHEN ?=1 THEN ?
                ELSE coverage_summary_json END,
              task_total=(
                SELECT COUNT(*) FROM country_sweep_tasks counted
                 WHERE counted.sweep_id=country_sweeps.id
              ),
              task_completed=(
                SELECT COUNT(*) FROM country_sweep_tasks counted
                 WHERE counted.sweep_id=country_sweeps.id
                   AND counted.status='completed'
              ),
              task_failed=(
                SELECT COUNT(*) FROM country_sweep_tasks counted
                 WHERE counted.sweep_id=country_sweeps.id
                   AND counted.status='failed'
              ),
              missing_scope_count=(
                SELECT COUNT(*) FROM country_sweep_tasks counted
                 WHERE counted.sweep_id=country_sweeps.id
                   AND counted.status='failed'
                   AND counted.phase IN ('discovery','verification')
              ),
              completed_at=CASE WHEN ?=1 AND NOT EXISTS (
                SELECT 1 FROM country_sweep_tasks active_task
                 WHERE active_task.sweep_id=country_sweeps.id
                   AND active_task.status IN ('queued','claimed','materializing')
              ) THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND requested_by_user_id=? AND status='running'
          AND ${completionFenceSql("country_sweeps.requested_by_user_id")}`
    )
    .bind(
      isCoverageAudit ? 1 : 0,
      isCoverageAudit ? 1 : 0,
      coverageSummaryJson,
      isCoverageAudit ? 1 : 0,
      context.sweepId,
      context.userId,
      ...completionFenceValues(context, completionGuard)
    );
}

export function completeCountryRunStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  outputJson: string,
  completionGuard: string
) {
  return db
    .prepare(
      `UPDATE agent_task_runs
          SET status='completed',result_json=?,error_code='',error_detail='',
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND user_id=? AND runner_id=? AND task_type=?
          AND source_task_id=? AND attempt_number=? AND lease_token=?
          AND source_hash=? AND status='running' AND result_json=?
          AND EXISTS (
            SELECT 1 FROM country_sweep_tasks completed_task
             WHERE completed_task.id=agent_task_runs.source_task_id
               AND completed_task.sweep_id=?
               AND completed_task.status='completed'
               AND completed_task.attempt_count=agent_task_runs.attempt_number
          )`
    )
    .bind(
      outputJson,
      context.runId,
      context.userId,
      context.runnerId,
      context.taskType,
      context.taskId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash,
      completionGuard,
      context.sweepId
    );
}

export function completionFenceSql(userExpression: string) {
  return `EXISTS (
    SELECT 1 FROM agent_task_runs completion_run
     WHERE completion_run.id=? AND completion_run.user_id=${userExpression}
       AND completion_run.runner_id=? AND completion_run.task_type=?
       AND completion_run.source_task_id=?
       AND completion_run.attempt_number=? AND completion_run.lease_token=?
       AND completion_run.source_hash=? AND completion_run.status='running'
       AND completion_run.result_json=?
  )`;
}

export function completionFenceValues(
  context: CountryTaskLeaseContext,
  completionGuard: string
) {
  return [
    context.runId,
    context.runnerId,
    context.taskType,
    context.taskId,
    context.attemptNumber,
    context.leaseToken,
    context.sourceHash,
    completionGuard,
  ] as const;
}
