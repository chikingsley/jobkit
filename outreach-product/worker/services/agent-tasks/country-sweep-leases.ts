import {
  COUNTRY_SWEEP_OUTPUT_JSON_SCHEMA,
  COUNTRY_SWEEP_PROMPT_VERSION,
  countrySweepModel,
  countrySweepPrompt,
  countrySweepTaskType,
} from "../../../src/agent-tasks/country-sweep";
import type { AgentTaskFailureCode } from "../../../src/features/agents/schema";
import {
  COUNTRY_SWEEP_OUTPUT_SCHEMA_VERSION,
  INITIAL_COUNTRY_OUTPUT_ROLLING_SHA256,
} from "../../../src/features/countries/materialization";
import type { AgentRunnerContext } from "../../app-types";
import {
  AGENT_TASK_LEASE_MS,
  AgentTaskClaimLostError,
  AgentTaskError,
  type AgentTaskRunRow,
  type PreparedAgentTask,
} from "./contracts";
import { isConstraintError, sha256 } from "./run-store";

const LEASE_MINUTES = AGENT_TASK_LEASE_MS / 60_000;
const LEASE_SQL_MODIFIER = `+${LEASE_MINUTES.toString()} minutes`;
const LEGACY_UNHASHED_INPUT = "0".repeat(64);
const COUNTRY_TASK_REAPER_LIMIT = 1;

interface CountryTaskCandidateRow {
  attempt_count: number;
  country_code: string;
  country_name: string;
  id: string;
  input_hash: string;
  input_json: string;
  max_attempts: number;
  phase: "coverage_audit" | "discovery" | "verification";
  scope_key: string;
  sweep_id: string;
}

export interface CountryTaskLeaseContext {
  attemptNumber: number;
  leaseToken: string;
  outputId: string;
  runId: string;
  runnerId: string;
  sourceHash: string;
  sweepId: string;
  taskId: string;
  taskType: string;
  userId: string;
}

interface CountryTaskFailureContext extends CountryTaskLeaseContext {
  errorCode: AgentTaskFailureCode | "lease_expired" | "runner_revoked";
  errorDetail: string;
  mode: "expiry" | "revocation" | "runner";
}

const RETRYABLE_COUNTRY_FAILURES = new Set<
  CountryTaskFailureContext["errorCode"]
>([
  "d1_unavailable",
  "provider_transport",
  "provider_unavailable",
  "r2_unavailable",
  "runner_failure",
]);

interface ActiveCountryTaskPairRow {
  attempt_count: number;
  country_code: string;
  country_name: string;
  input_hash: string;
  lease_token: string;
  max_attempts: number;
  output_id: string;
  phase: "coverage_audit" | "discovery" | "verification";
  run_id: string;
  runner_id: string;
  runner_revoked_at: string | null;
  sweep_id: string;
  task_id: string;
  user_id: string;
}

export async function claimCountrySweepAgentTask(
  db: D1Database,
  runner: AgentRunnerContext
): Promise<PreparedAgentTask | null> {
  const candidate = await readCountryTaskCandidate(db, runner.user.id);
  if (!candidate) {
    return null;
  }
  const sourceHash = await sha256(candidate.input_json);
  if (candidate.input_hash !== sourceHash) {
    if (
      candidate.input_hash === LEGACY_UNHASHED_INPUT &&
      candidate.attempt_count === 0
    ) {
      await pinMigratedCountryTaskInputHash(
        db,
        candidate,
        runner.user.id,
        sourceHash
      );
      return null;
    }
    throw new AgentTaskError("Country task input hash changed", 409);
  }
  const input = JSON.parse(candidate.input_json) as unknown;
  const { model, reasoningEffort } = countrySweepModel(candidate.phase);
  const prompt = countrySweepPrompt({
    countryCode: candidate.country_code,
    countryName: candidate.country_name,
    input,
    phase: candidate.phase,
    scopeKey: candidate.scope_key,
  });
  const taskType = countrySweepTaskType(candidate.phase);
  const runId = crypto.randomUUID();
  const outputId = crypto.randomUUID();
  const leaseToken = crypto.randomUUID();
  const context: CountryTaskLeaseContext = {
    attemptNumber: candidate.attempt_count + 1,
    leaseToken,
    outputId,
    runId,
    runnerId: runner.id,
    sourceHash,
    sweepId: candidate.sweep_id,
    taskId: candidate.id,
    taskType,
    userId: runner.user.id,
  };
  const statements = [
    claimCountryTaskStatement(db, context),
    requiredChangesAssertionStatement(db, 1),
    insertCountryTaskRunStatement(db, context, {
      model,
      promptHash: await sha256(prompt),
      reasoningEffort,
    }),
    requiredChangesAssertionStatement(db, 1),
    insertCountryTaskOutputStatement(db, context),
    requiredChangesAssertionStatement(db, 1),
    startCountrySweepStatement(db, context),
    requiredChangesAssertionStatement(db, 1),
  ];
  try {
    const results = await db.batch(statements);
    const claim = results[0]?.results?.[0] as
      | { attempt_count?: number; lease_expires_at?: string }
      | undefined;
    const attemptNumber = Number(claim?.attempt_count ?? 0);
    const leaseExpiresAt = String(claim?.lease_expires_at ?? "");
    if (!(attemptNumber > 0 && leaseExpiresAt)) {
      throw new AgentTaskError("Country task claim returned no lease", 409);
    }
    return {
      artifacts: [],
      attemptNumber,
      leaseExpiresAt,
      leaseToken,
      model,
      outputSchema: COUNTRY_SWEEP_OUTPUT_JSON_SCHEMA,
      prompt,
      promptVersion: COUNTRY_SWEEP_PROMPT_VERSION,
      reasoningEffort,
      runId,
      taskType,
      webSearch: "live",
    };
  } catch (error) {
    if (isConstraintError(error)) {
      const [current, revokedAt] = await Promise.all([
        db
          .prepare(
            `SELECT status,attempt_count FROM country_sweep_tasks
              WHERE id=? AND sweep_id=?`
          )
          .bind(context.taskId, context.sweepId)
          .first<{ attempt_count: number; status: string }>(),
        db
          .prepare(
            "SELECT revoked_at FROM agent_runners WHERE id=? AND user_id=?"
          )
          .bind(context.runnerId, context.userId)
          .first<string>("revoked_at"),
      ]);
      if (
        current?.status !== "queued" ||
        current?.attempt_count !== candidate.attempt_count ||
        revokedAt
      ) {
        throw new AgentTaskClaimLostError(
          "Country task claim was resolved by another transition",
          { cause: error }
        );
      }
      const claimError = new AgentTaskError(
        "Country task claim transaction violated an invariant",
        409
      );
      claimError.cause = error;
      throw claimError;
    }
    throw error;
  }
}

export async function heartbeatCountrySweepAgentTask(
  db: D1Database,
  context: CountryTaskLeaseContext
) {
  const statements = [
    db
      .prepare(
        `UPDATE country_sweep_tasks
            SET lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?),
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND sweep_id=? AND worker_id=? AND status='claimed'
            AND attempt_count=? AND lease_token=? AND input_hash=?
            AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
            AND EXISTS (
              SELECT 1 FROM country_sweeps sweep
               WHERE sweep.id=country_sweep_tasks.sweep_id
                 AND sweep.requested_by_user_id=? AND sweep.status='running'
            )
            AND EXISTS (
              SELECT 1 FROM agent_task_runs heartbeat_run
               WHERE heartbeat_run.id=?
                 AND heartbeat_run.user_id=?
                 AND heartbeat_run.runner_id=country_sweep_tasks.worker_id
                 AND heartbeat_run.task_type=?
                 AND heartbeat_run.source_task_id=country_sweep_tasks.id
                 AND heartbeat_run.attempt_number=country_sweep_tasks.attempt_count
                 AND heartbeat_run.lease_token=country_sweep_tasks.lease_token
                 AND heartbeat_run.source_hash=country_sweep_tasks.input_hash
                 AND heartbeat_run.status='running'
                 AND heartbeat_run.lease_expires_at>
                     strftime('%Y-%m-%dT%H:%M:%fZ','now')
            )
            AND EXISTS (
              SELECT 1 FROM agent_runners heartbeat_runner
               WHERE heartbeat_runner.id=country_sweep_tasks.worker_id
                 AND heartbeat_runner.user_id=?
                 AND heartbeat_runner.revoked_at IS NULL
            )
        RETURNING lease_expires_at`
      )
      .bind(
        LEASE_SQL_MODIFIER,
        context.taskId,
        context.sweepId,
        context.runnerId,
        context.attemptNumber,
        context.leaseToken,
        context.sourceHash,
        context.userId,
        context.runId,
        context.userId,
        context.taskType,
        context.userId
      ),
    requiredChangesAssertionStatement(db, 1),
    db
      .prepare(
        `UPDATE agent_task_runs
            SET lease_expires_at=(
                  SELECT lease_expires_at FROM country_sweep_tasks
                   WHERE id=? AND sweep_id=? AND worker_id=?
                     AND status='claimed' AND attempt_count=? AND lease_token=?
                ),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND user_id=? AND runner_id=? AND task_type=?
            AND source_task_id=? AND status='running'
            AND attempt_number=? AND lease_token=? AND source_hash=?`
      )
      .bind(
        context.taskId,
        context.sweepId,
        context.runnerId,
        context.attemptNumber,
        context.leaseToken,
        context.runId,
        context.userId,
        context.runnerId,
        context.taskType,
        context.taskId,
        context.attemptNumber,
        context.leaseToken,
        context.sourceHash
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
        "Country task lease changed before heartbeat",
        409
      );
      heartbeatError.cause = error;
      throw heartbeatError;
    }
    throw error;
  }
}

export function failCountrySweepAgentTask(
  db: D1Database,
  context: CountryTaskLeaseContext,
  errorDetail: string,
  errorCode: AgentTaskFailureCode
) {
  return failCountryTaskAttempt(db, {
    ...context,
    errorCode,
    errorDetail,
    mode: "runner",
  });
}

export async function expireCountrySweepAgentTasks(
  db: D1Database,
  userId: string | null
) {
  const rows = await db
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
           ON run.source_task_id=task.id
          AND run.user_id=sweep.requested_by_user_id
          AND run.runner_id=task.worker_id
          AND run.task_type='country_sweep.'||task.phase
          AND run.attempt_number=task.attempt_count
          AND run.lease_token=task.lease_token
          AND run.source_hash=task.input_hash
          AND run.status='running'
         LEFT JOIN agent_runners runner
           ON runner.id=task.worker_id
          AND runner.user_id=sweep.requested_by_user_id
         JOIN country_sweep_outputs output
           ON output.task_id=task.id AND output.agent_run_id=run.id
          AND output.attempt_number=task.attempt_count
          AND output.status='uploading'
        WHERE (? IS NULL OR sweep.requested_by_user_id=?)
          AND task.status='claimed'
          AND (
            task.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            OR run.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            OR runner.revoked_at IS NOT NULL
          )
        ORDER BY task.claimed_at,task.id LIMIT ?`
    )
    .bind(userId, userId, COUNTRY_TASK_REAPER_LIMIT)
    .all<ActiveCountryTaskPairRow>();
  let processed = 0;
  for (const pair of rows.results) {
    const revoked = Boolean(pair.runner_revoked_at);
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Each selected lease owns one bounded atomic transition.
      await failCountryTaskAttempt(db, {
        attemptNumber: pair.attempt_count,
        errorCode: revoked ? "runner_revoked" : "lease_expired",
        errorDetail: revoked ? "Runner revoked" : "Runner lease expired",
        leaseToken: pair.lease_token,
        mode: revoked ? "revocation" : "expiry",
        outputId: pair.output_id,
        runId: pair.run_id,
        runnerId: pair.runner_id,
        sourceHash: pair.input_hash,
        sweepId: pair.sweep_id,
        taskId: pair.task_id,
        taskType: countrySweepTaskType(pair.phase),
        userId: pair.user_id,
      });
      processed += 1;
    } catch (error) {
      if (!(error instanceof AgentTaskError && error.status === 409)) {
        throw error;
      }
    }
  }
  return { processed, selected: rows.results.length };
}

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

function readCountryTaskCandidate(db: D1Database, userId: string) {
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

async function pinMigratedCountryTaskInputHash(
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

function claimCountryTaskStatement(
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

function insertCountryTaskRunStatement(
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

function insertCountryTaskOutputStatement(
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

function startCountrySweepStatement(
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

async function failCountryTaskAttempt(
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

function requiredChangesAssertionStatement(
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
