import { PROFILE_IMPORT_TASK_TYPE } from "../../src/agent-tasks/profile-import";
import {
  TEST_LAB_DOCUMENT_OCR_TASK_TYPE,
  TEST_LAB_TASK_TYPE,
} from "../../src/agent-tasks/test-lab";
import { AgentTaskError } from "./agent-tasks/contracts";

export interface ClaimedAgentTaskRequest {
  attemptCount: number;
  id: string;
  input: unknown;
  leaseToken: string;
  maxAttempts: number;
  subjectId: string;
  subjectType: string;
  taskType: string;
}

export interface QueuedAgentTaskRequest {
  attemptCount: number;
  id: string;
  input: unknown;
  maxAttempts: number;
  subjectId: string;
  subjectType: string;
  taskType: string;
}

interface AgentTaskRequestRow {
  attempt_count: number;
  error_detail: string;
  id: string;
  input_json: string;
  lease_token: string | null;
  max_attempts: number;
  result_json: string | null;
  status: "cancelled" | "claimed" | "completed" | "failed" | "queued";
  subject_id: string;
  subject_type: string;
  task_type: string;
  updated_at: string;
}

interface AgentTaskRequestCreation {
  maxAttempts?: number;
  payload: unknown;
  retryOfRequestId?: string;
  subjectId: string;
  subjectType: string;
  taskType: string;
  userId: string;
}

export function buildAgentTaskRequestCreation(
  db: D1Database,
  input: AgentTaskRequestCreation
) {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  return {
    request: { id, status: "queued" as const },
    statement: db
      .prepare(
        `INSERT INTO agent_task_requests
          (id,user_id,task_type,subject_type,subject_id,input_json,status,
           max_attempts,retry_of_request_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,'queued',?,?,?,?)`
      )
      .bind(
        id,
        input.userId,
        input.taskType,
        input.subjectType,
        input.subjectId,
        JSON.stringify(input.payload),
        input.maxAttempts ?? 3,
        input.retryOfRequestId ?? null,
        timestamp,
        timestamp
      ),
  };
}

export async function readNextAgentTaskRequest(
  db: D1Database,
  input: { taskType: string; userId: string }
): Promise<QueuedAgentTaskRequest | null> {
  const row = await db
    .prepare(
      `SELECT id,task_type,subject_type,subject_id,input_json,attempt_count,
              max_attempts
         FROM agent_task_requests
        WHERE user_id=? AND task_type=? AND status='queued'
          AND attempt_count<max_attempts
          AND (next_attempt_at IS NULL OR next_attempt_at<=
               strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ORDER BY created_at,id LIMIT 1`
    )
    .bind(input.userId, input.taskType)
    .first<AgentTaskRequestRow>();
  return row ? toQueuedRequest(row) : null;
}

export async function createAgentTaskRequest(
  db: D1Database,
  input: AgentTaskRequestCreation
) {
  const creation = buildAgentTaskRequestCreation(db, input);
  await creation.statement.run();
  return creation.request;
}

export async function failQueuedAgentTaskRequest(
  db: D1Database,
  input: {
    error: string;
    errorCode: string;
    requestId: string;
    userId: string;
  }
) {
  const result = await db
    .prepare(
      `UPDATE agent_task_requests
          SET status='failed',last_error_code=?,error_detail=?,
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND user_id=? AND status='queued'`
    )
    .bind(
      input.errorCode,
      input.error.slice(0, 4000),
      input.requestId,
      input.userId
    )
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function readClaimedAgentTaskRequest(
  db: D1Database,
  input: {
    requestId: string;
    runnerId: string;
    userId: string;
  }
) {
  const row = await db
    .prepare(
      `SELECT id,task_type,subject_type,subject_id,input_json,status,
              result_json,error_detail,updated_at,attempt_count,max_attempts,
              lease_token
         FROM agent_task_requests
        WHERE id=? AND user_id=? AND runner_id=? AND status='claimed'`
    )
    .bind(input.requestId, input.userId, input.runnerId)
    .first<AgentTaskRequestRow>();
  return row ? toClaimedRequest(row) : null;
}

export async function readAgentTaskRequest(
  db: D1Database,
  input: { requestId: string; userId: string }
) {
  const row = await db
    .prepare(
      `SELECT id,task_type,subject_type,subject_id,input_json,status,
              result_json,error_detail,updated_at,attempt_count,max_attempts,
              lease_token
         FROM agent_task_requests
        WHERE id=? AND user_id=?`
    )
    .bind(input.requestId, input.userId)
    .first<AgentTaskRequestRow>();
  return row ? toStoredRequest(row) : null;
}

export async function readActiveAgentTaskRequest(
  db: D1Database,
  input: {
    subjectId: string;
    subjectType: string;
    taskType: string;
    userId: string;
  }
) {
  const row = await db
    .prepare(
      `SELECT id,task_type,subject_type,subject_id,input_json,status,
              result_json,error_detail,updated_at,attempt_count,max_attempts,
              lease_token
         FROM agent_task_requests
        WHERE user_id=? AND task_type=? AND subject_type=? AND subject_id=?
          AND status IN ('queued','claimed')
        ORDER BY created_at DESC LIMIT 1`
    )
    .bind(input.userId, input.taskType, input.subjectType, input.subjectId)
    .first<AgentTaskRequestRow>();
  return row ? toStoredRequest(row) : null;
}

export async function listRecentAgentTasks(db: D1Database, userId: string) {
  const [requests, autonomousRuns] = await Promise.all([
    db
      .prepare(
        `SELECT atr.id,atr.task_type,atr.subject_type,atr.subject_id,
                atr.status,atr.error_detail,atr.created_at,atr.updated_at,
                atr.completed_at,r.name runner_name,
                run.id run_id,run.status run_status,run.model,
                run.reasoning_effort,run.prompt_version,run.started_at,
                run.completed_at run_completed_at
           FROM agent_task_requests atr
           LEFT JOIN agent_runners r ON r.id=atr.runner_id
           LEFT JOIN agent_task_runs run ON run.id=(
             SELECT latest.id FROM agent_task_runs latest
              WHERE latest.source_task_id=atr.id
              ORDER BY latest.started_at DESC LIMIT 1
           )
          WHERE atr.user_id=?
          ORDER BY atr.created_at DESC LIMIT 50`
      )
      .bind(userId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT run.id run_id,run.task_type,run.source_task_id,
                run.status run_status,run.error_detail,run.model,
                run.reasoning_effort,run.prompt_version,run.started_at,
                run.completed_at,r.name runner_name
           FROM agent_task_runs run
           JOIN agent_runners r ON r.id=run.runner_id
          WHERE run.user_id=?
            AND NOT EXISTS (
              SELECT 1 FROM agent_task_requests atr WHERE atr.id=run.source_task_id
            )
          ORDER BY run.started_at DESC LIMIT 25`
      )
      .bind(userId)
      .all<Record<string, unknown>>(),
  ]);
  return {
    autonomousRuns: autonomousRuns.results.map(toAutonomousTaskSummary),
    requests: requests.results.map(toTaskRequestSummary),
  };
}

export async function cancelAgentTaskRequest(
  db: D1Database,
  userId: string,
  requestId: string
) {
  const request = await readMutableTaskRequest(db, userId, requestId);
  if (!request) {
    throw new AgentTaskError("Agent task request was not found", 404);
  }
  if (request.status !== "queued") {
    throw new AgentTaskError(
      `Only a queued task can be cancelled; this task is ${request.status}`,
      409
    );
  }
  const timestamp = new Date().toISOString();
  const statements = [
    db
      .prepare(
        `UPDATE agent_task_requests
            SET status='cancelled',error_detail='Cancelled by user',
                completed_at=?,updated_at=?
          WHERE id=? AND user_id=? AND status='queued'`
      )
      .bind(timestamp, timestamp, requestId, userId),
  ];
  if (request.task_type === PROFILE_IMPORT_TASK_TYPE) {
    statements.push(
      db
        .prepare(
          `UPDATE profile_imports SET status='failed',
                  error_message='Cancelled by user',updated_at=?
            WHERE id=? AND user_id=? AND status='processing'`
        )
        .bind(timestamp, request.subject_id, userId)
    );
  }
  if (isTestLabTaskType(request.task_type)) {
    statements.push(
      db
        .prepare(
          `UPDATE test_lab_runs
              SET status='cancelled',error_detail='Cancelled by user',
                  completed_at=?,updated_at=?
            WHERE id=? AND user_id=? AND status='queued'`
        )
        .bind(timestamp, timestamp, request.subject_id, userId)
    );
  }
  const [result] = await db.batch(statements);
  if ((result?.meta.changes ?? 0) !== 1) {
    throw new AgentTaskError("Agent task could not be cancelled", 409);
  }
  return { id: requestId, status: "cancelled" as const };
}

export async function retryAgentTaskRequest(
  db: D1Database,
  userId: string,
  requestId: string
) {
  const request = await readMutableTaskRequest(db, userId, requestId);
  if (!request) {
    throw new AgentTaskError("Agent task request was not found", 404);
  }
  if (request.status !== "failed" && request.status !== "cancelled") {
    throw new AgentTaskError(
      `Only a failed or cancelled task can be retried; this task is ${request.status}`,
      409
    );
  }
  const creation = buildAgentTaskRequestCreation(db, {
    maxAttempts: request.max_attempts,
    payload: JSON.parse(request.input_json) as unknown,
    retryOfRequestId: request.id,
    subjectId: request.subject_id,
    subjectType: request.subject_type,
    taskType: request.task_type,
    userId,
  });
  const statements = [creation.statement];
  if (request.task_type === PROFILE_IMPORT_TASK_TYPE) {
    statements.push(
      db
        .prepare(
          `UPDATE profile_imports SET status='processing',error_message=NULL,
                  updated_at=?
            WHERE id=? AND user_id=? AND status='failed'`
        )
        .bind(new Date().toISOString(), request.subject_id, userId)
    );
  }
  if (isTestLabTaskType(request.task_type)) {
    statements.push(
      db
        .prepare(
          `UPDATE test_lab_runs
              SET status='queued',agent_task_request_id=?,error_detail='',
                  completed_at=NULL,started_at=NULL,updated_at=?
            WHERE id=? AND user_id=? AND status IN ('failed','cancelled')`
        )
        .bind(
          creation.request.id,
          new Date().toISOString(),
          request.subject_id,
          userId
        )
    );
  }
  await db.batch(statements);
  return creation.request;
}

function toClaimedRequest(row: AgentTaskRequestRow): ClaimedAgentTaskRequest {
  if (!row.lease_token) {
    throw new AgentTaskError("Agent task request lease is missing", 409);
  }
  return {
    attemptCount: row.attempt_count,
    id: row.id,
    input: JSON.parse(row.input_json) as unknown,
    leaseToken: row.lease_token,
    maxAttempts: row.max_attempts,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    taskType: row.task_type,
  };
}

function toQueuedRequest(row: AgentTaskRequestRow): QueuedAgentTaskRequest {
  return {
    attemptCount: row.attempt_count,
    id: row.id,
    input: JSON.parse(row.input_json) as unknown,
    maxAttempts: row.max_attempts,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    taskType: row.task_type,
  };
}

function isTestLabTaskType(taskType: string) {
  return (
    taskType === TEST_LAB_TASK_TYPE ||
    taskType === TEST_LAB_DOCUMENT_OCR_TASK_TYPE
  );
}

function toStoredRequest(row: AgentTaskRequestRow) {
  return {
    error: row.error_detail,
    id: row.id,
    result: row.result_json ? (JSON.parse(row.result_json) as unknown) : null,
    status: row.status,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    taskType: row.task_type,
    updatedAt: row.updated_at,
  };
}

function readMutableTaskRequest(
  db: D1Database,
  userId: string,
  requestId: string
) {
  return db
    .prepare(
      `SELECT id,task_type,subject_type,subject_id,input_json,status,
              attempt_count,max_attempts
         FROM agent_task_requests WHERE id=? AND user_id=?`
    )
    .bind(requestId, userId)
    .first<
      Pick<
        AgentTaskRequestRow,
        | "id"
        | "attempt_count"
        | "input_json"
        | "max_attempts"
        | "status"
        | "subject_id"
        | "subject_type"
        | "task_type"
      >
    >();
}

function toTaskRequestSummary(row: Record<string, unknown>) {
  return {
    completedAt: row.completed_at ? String(row.completed_at) : null,
    createdAt: String(row.created_at),
    error: String(row.error_detail ?? ""),
    id: String(row.id),
    run: row.run_id
      ? {
          completedAt: row.run_completed_at
            ? String(row.run_completed_at)
            : null,
          id: String(row.run_id),
          model: String(row.model),
          promptVersion: String(row.prompt_version),
          reasoningEffort: String(row.reasoning_effort),
          runnerName: String(row.runner_name ?? ""),
          startedAt: String(row.started_at),
          status: String(row.run_status),
        }
      : null,
    status: String(row.status),
    subjectId: String(row.subject_id),
    subjectType: String(row.subject_type),
    taskType: String(row.task_type),
    updatedAt: String(row.updated_at),
  };
}

function toAutonomousTaskSummary(row: Record<string, unknown>) {
  return {
    completedAt: row.completed_at ? String(row.completed_at) : null,
    error: String(row.error_detail ?? ""),
    id: String(row.run_id),
    model: String(row.model),
    promptVersion: String(row.prompt_version),
    reasoningEffort: String(row.reasoning_effort),
    runnerName: String(row.runner_name ?? ""),
    sourceTaskId: String(row.source_task_id),
    startedAt: String(row.started_at),
    status: String(row.run_status),
    taskType: String(row.task_type),
  };
}
