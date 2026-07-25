import { COUNTRY_SWEEP_PROMPT_VERSION } from "../../../../src/agent-tasks/country-sweep";
import {
  COUNTRY_SWEEP_OUTPUT_SCHEMA_VERSION,
  INITIAL_COUNTRY_OUTPUT_ROLLING_SHA256,
} from "../../../../src/features/countries/materialization";
import type { AgentRunnerContext } from "../../../app-types";
import {
  AgentTaskClaimLostError,
  AgentTaskError,
  type AgentTaskRunRow,
} from "../contracts";
import {
  type CountryTaskCandidateRow,
  type CountryTaskLeaseContext,
  LEASE_SQL_MODIFIER,
  LEGACY_UNHASHED_INPUT,
} from "./model";

export async function readCountryTaskLeaseContext(
  db: D1Database,
  runner: AgentRunnerContext,
  run: AgentTaskRunRow,
  runId: string
): Promise<CountryTaskLeaseContext> {
  const task = await db
    .prepare(
      `SELECT task.sweep_id,output.id output_id
         FROM country_sweep_tasks task
         JOIN country_sweeps sweep ON sweep.id=task.sweep_id
         JOIN country_sweep_outputs output
           ON output.task_id=task.id
          AND output.agent_run_id=?
          AND output.attempt_number=task.attempt_count
          AND output.status='uploading'
        WHERE task.id=? AND sweep.requested_by_user_id=?
          AND task.worker_id=? AND task.status='claimed'
          AND task.attempt_count=? AND task.lease_token=?
          AND task.input_hash=?`
    )
    .bind(
      runId,
      run.source_task_id,
      runner.user.id,
      runner.id,
      run.attempt_number,
      run.lease_token,
      run.source_hash
    )
    .first<{ output_id: string; sweep_id: string }>();
  if (!task) {
    throw new AgentTaskError("Country task lease was not found", 409);
  }
  return {
    attemptNumber: run.attempt_number,
    leaseToken: run.lease_token,
    outputId: task.output_id,
    runId,
    runnerId: runner.id,
    sourceHash: run.source_hash,
    sweepId: task.sweep_id,
    taskId: run.source_task_id,
    taskType: run.task_type,
    userId: runner.user.id,
  };
}

export function readCountryTaskCandidate(db: D1Database, userId: string) {
  return db
    .prepare(
      `SELECT task.id,task.sweep_id,task.phase,task.scope_key,task.input_json,
              task.input_hash,task.attempt_count,task.max_attempts,
              sweep.country_code,sweep.country_name
         FROM country_sweep_tasks task
         JOIN country_sweeps sweep ON sweep.id=task.sweep_id
        WHERE sweep.requested_by_user_id=?
          AND sweep.status IN ('queued','running')
          AND task.status='queued' AND task.attempt_count<task.max_attempts
        ORDER BY CASE task.phase
          WHEN 'discovery' THEN 0 WHEN 'verification' THEN 1 ELSE 2 END,
          task.created_at,task.id LIMIT 1`
    )
    .bind(userId)
    .first<CountryTaskCandidateRow>();
}

export async function pinMigratedCountryTaskInputHash(
  db: D1Database,
  candidate: CountryTaskCandidateRow,
  userId: string,
  sourceHash: string
) {
  const result = await db
    .prepare(
      `UPDATE country_sweep_tasks SET input_hash=?,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND sweep_id=? AND status='queued' AND attempt_count=0
          AND input_hash=? AND input_json=?
          AND EXISTS (
            SELECT 1 FROM country_sweeps sweep
             WHERE sweep.id=country_sweep_tasks.sweep_id
               AND sweep.requested_by_user_id=?
               AND sweep.status IN ('queued','running')
          )`
    )
    .bind(
      sourceHash,
      candidate.id,
      candidate.sweep_id,
      LEGACY_UNHASHED_INPUT,
      candidate.input_json,
      userId
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new AgentTaskClaimLostError(
      "Country task input pin was resolved by another transition"
    );
  }
}

export function claimCountryTaskStatement(
  db: D1Database,
  context: CountryTaskLeaseContext
) {
  return db
    .prepare(
      `UPDATE country_sweep_tasks
          SET status='claimed',worker_id=?,attempt_count=attempt_count+1,
              lease_token=?,claimed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?),
              error_code='',error_detail='',completed_at=NULL,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND sweep_id=? AND status='queued'
          AND attempt_count=? AND attempt_count<max_attempts
          AND input_hash=?
          AND EXISTS (
            SELECT 1 FROM country_sweeps sweep
             WHERE sweep.id=country_sweep_tasks.sweep_id
               AND sweep.requested_by_user_id=?
               AND sweep.status IN ('queued','running')
          )
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
      context.taskId,
      context.sweepId,
      context.attemptNumber - 1,
      context.sourceHash,
      context.userId,
      context.runnerId,
      context.userId
    );
}

export function insertCountryTaskRunStatement(
  db: D1Database,
  context: CountryTaskLeaseContext,
  task: {
    model: string;
    promptHash: string;
    reasoningEffort: string;
  }
) {
  return db
    .prepare(
      `INSERT INTO agent_task_runs
        (id,user_id,runner_id,task_type,source_task_id,prompt_version,model,
         reasoning_effort,source_hash,prompt_hash,status,started_at,
         lease_expires_at,updated_at,attempt_number,lease_token)
       SELECT ?,sweep.requested_by_user_id,task.worker_id,?,task.id,?,?,?,?,?,
              'running',strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              task.lease_expires_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              task.attempt_count,task.lease_token
         FROM country_sweep_tasks task
         JOIN country_sweeps sweep ON sweep.id=task.sweep_id
         JOIN agent_runners claim_runner
           ON claim_runner.id=task.worker_id
          AND claim_runner.user_id=sweep.requested_by_user_id
          AND claim_runner.revoked_at IS NULL
        WHERE task.id=? AND task.sweep_id=? AND task.worker_id=?
          AND sweep.requested_by_user_id=? AND task.status='claimed'
          AND task.attempt_count=? AND task.lease_token=? AND task.input_hash=?`
    )
    .bind(
      context.runId,
      context.taskType,
      COUNTRY_SWEEP_PROMPT_VERSION,
      task.model,
      task.reasoningEffort,
      context.sourceHash,
      task.promptHash,
      context.taskId,
      context.sweepId,
      context.runnerId,
      context.userId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash
    );
}

export function insertCountryTaskOutputStatement(
  db: D1Database,
  context: CountryTaskLeaseContext
) {
  return db
    .prepare(
      `INSERT INTO country_sweep_outputs
        (id,sweep_id,task_id,agent_run_id,attempt_number,schema_version,status,
         rolling_sha256,created_at,updated_at)
       SELECT ?,task.sweep_id,task.id,run.id,task.attempt_count,?,'uploading',?,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
         FROM country_sweep_tasks task
         JOIN country_sweeps sweep ON sweep.id=task.sweep_id
         JOIN agent_task_runs run
           ON run.id=? AND run.user_id=sweep.requested_by_user_id
          AND run.runner_id=task.worker_id
          AND run.task_type='country_sweep.'||task.phase
          AND run.source_task_id=task.id
          AND run.attempt_number=task.attempt_count
          AND run.lease_token=task.lease_token
          AND run.source_hash=task.input_hash
          AND run.status='running'
        WHERE task.id=? AND task.sweep_id=? AND task.worker_id=?
          AND sweep.requested_by_user_id=? AND task.status='claimed'
          AND task.attempt_count=? AND task.lease_token=? AND task.input_hash=?`
    )
    .bind(
      context.outputId,
      COUNTRY_SWEEP_OUTPUT_SCHEMA_VERSION,
      INITIAL_COUNTRY_OUTPUT_ROLLING_SHA256,
      context.runId,
      context.taskId,
      context.sweepId,
      context.runnerId,
      context.userId,
      context.attemptNumber,
      context.leaseToken,
      context.sourceHash
    );
}

export function startCountrySweepStatement(
  db: D1Database,
  context: CountryTaskLeaseContext
) {
  return db
    .prepare(
      `UPDATE country_sweeps
          SET status='running',
              started_at=COALESCE(started_at,
                strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND requested_by_user_id=?
          AND status IN ('queued','running')
          AND EXISTS (
            SELECT 1 FROM country_sweep_tasks task
             WHERE task.id=? AND task.sweep_id=country_sweeps.id
               AND task.worker_id=? AND task.status='claimed'
               AND task.attempt_count=? AND task.lease_token=?
          )`
    )
    .bind(
      context.sweepId,
      context.userId,
      context.taskId,
      context.runnerId,
      context.attemptNumber,
      context.leaseToken
    );
}
