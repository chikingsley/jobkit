import {
  COUNTRY_SWEEP_OUTPUT_JSON_SCHEMA,
  COUNTRY_SWEEP_PROMPT_VERSION,
  countrySweepModel,
  countrySweepPrompt,
  countrySweepTaskType,
} from "../../../src/agent-tasks/country-sweep";
import type { AgentTaskFailureCode } from "../../../src/features/agents/schema";
import type { AgentRunnerContext } from "../../app-types";
import {
  AgentTaskClaimLostError,
  AgentTaskError,
  type PreparedAgentTask,
} from "./contracts";
import {
  claimCountryTaskStatement,
  insertCountryTaskOutputStatement,
  insertCountryTaskRunStatement,
  pinMigratedCountryTaskInputHash,
  readCountryTaskCandidate,
  startCountrySweepStatement,
} from "./country-sweep-leases/claims";
import {
  failCountryTaskAttempt,
  requiredChangesAssertionStatement,
} from "./country-sweep-leases/failure";
import {
  type ActiveCountryTaskPairRow,
  COUNTRY_TASK_REAPER_LIMIT,
  type CountryTaskLeaseContext,
  LEASE_SQL_MODIFIER,
  LEGACY_UNHASHED_INPUT,
} from "./country-sweep-leases/model";
import { isConstraintError, sha256 } from "./run-store";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export { readCountryTaskLeaseContext } from "./country-sweep-leases/claims";
export type { CountryTaskLeaseContext } from "./country-sweep-leases/model";

async function prepareCountryTaskInputHash(
  db: D1Database,
  candidate: NonNullable<Awaited<ReturnType<typeof readCountryTaskCandidate>>>,
  userId: string,
  sourceHash: string
) {
  if (candidate.input_hash === sourceHash) {
    return true;
  }
  if (
    candidate.input_hash === LEGACY_UNHASHED_INPUT &&
    candidate.attempt_count === 0
  ) {
    await pinMigratedCountryTaskInputHash(db, candidate, userId, sourceHash);
    return false;
  }
  throw new AgentTaskError("Country task input hash changed", 409);
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
  if (
    !(await prepareCountryTaskInputHash(
      db,
      candidate,
      runner.user.id,
      sourceHash
    ))
  ) {
    return null;
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
