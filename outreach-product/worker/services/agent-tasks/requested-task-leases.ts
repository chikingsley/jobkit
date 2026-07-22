import type { AgentTaskFailureCode } from "../../../src/features/agents/schema";
import type { AgentRunnerContext } from "../../app-types";
import type { QueuedAgentTaskRequest } from "../agent-task-requests";
import {
  AGENT_TASK_LEASE_MS,
  AgentTaskClaimLostError,
  AgentTaskError,
  type PreparedAgentTask,
} from "./contracts";
import type {
  AgentTaskCompletionFence,
  AgentTaskCompletionWrite,
} from "./run-store";
import { isConstraintError, sha256 } from "./run-store";

const LEASE_MINUTES = AGENT_TASK_LEASE_MS / 60_000;
const LEASE_SQL_MODIFIER = `+${LEASE_MINUTES.toString()} minutes`;

// A claim request may also prepare and atomically claim one queued task. Reap
// one expired pair per poll so expiry work and the most expensive task-family
// preparation remain inside the Workers Free 50-query invocation limit.
// Scheduled polls and subsequent runner polls drain additional expired pairs.
export const AGENT_TASK_REAPER_LIMIT = 1;

export type RequestedAgentTaskSpecification = Omit<
  PreparedAgentTask,
  "attemptNumber" | "leaseExpiresAt" | "leaseToken" | "runId"
> & {
  sourceHash: string;
};

export interface RequestedAgentTaskClaimContext {
  attemptNumber: number;
  leaseToken: string;
  requestId: string;
  runId: string;
  runnerId: string;
  taskType: string;
  userId: string;
}

export interface RequestedAgentTaskFailureContext
  extends RequestedAgentTaskClaimContext {
  errorCode: AgentTaskFailureCode | "lease_expired" | "runner_revoked";
  errorDetail: string;
  mode: "expiry" | "revocation" | "runner";
}

export interface ActiveRequestedPairRow {
  attempt_count: number;
  error_detail: string;
  id: string;
  input_json: string;
  lease_token: string;
  max_attempts: number;
  run_id: string;
  runner_id: string;
  runner_revoked_at?: string | null;
  subject_id: string;
  task_type: string;
  user_id: string;
}

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

function claimRequestStatement(
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

function insertRequestedRunStatement(
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

function activePairFence(
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

function guardedFailureFence(
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

function failureGuardStatement(
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

function failRunStatement(
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

function transitionRequestAfterFailureStatement(
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

function retryOutboxStatement(
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

function readFailurePair(
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

function appendWrites(
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

function isRetryableFailure(
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
