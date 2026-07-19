export interface ClaimedAgentTaskRequest {
  id: string;
  input: unknown;
  subjectId: string;
  subjectType: string;
  taskType: string;
}

interface AgentTaskRequestRow {
  error_detail: string;
  id: string;
  input_json: string;
  result_json: string | null;
  status: "cancelled" | "claimed" | "completed" | "failed" | "queued";
  subject_id: string;
  subject_type: string;
  task_type: string;
  updated_at: string;
}

interface AgentTaskRequestCreation {
  payload: unknown;
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
           created_at,updated_at)
         VALUES (?,?,?,?,?,?,'queued',?,?)`
      )
      .bind(
        id,
        input.userId,
        input.taskType,
        input.subjectType,
        input.subjectId,
        JSON.stringify(input.payload),
        timestamp,
        timestamp
      ),
  };
}

export async function createAgentTaskRequest(
  db: D1Database,
  input: AgentTaskRequestCreation
) {
  const creation = buildAgentTaskRequestCreation(db, input);
  await creation.statement.run();
  return creation.request;
}

export async function claimAgentTaskRequest(
  db: D1Database,
  input: {
    leaseExpiresAt: string;
    runnerId: string;
    taskType: string;
    userId: string;
  }
): Promise<ClaimedAgentTaskRequest | null> {
  const timestamp = new Date().toISOString();
  const row = await db
    .prepare(
      `UPDATE agent_task_requests
          SET status='claimed',runner_id=?,claimed_at=?,lease_expires_at=?,
              updated_at=?
        WHERE id=(
          SELECT id FROM agent_task_requests
           WHERE user_id=? AND task_type=? AND status='queued'
           ORDER BY created_at LIMIT 1
        ) AND status='queued'
      RETURNING id,task_type,subject_type,subject_id,input_json`
    )
    .bind(
      input.runnerId,
      timestamp,
      input.leaseExpiresAt,
      timestamp,
      input.userId,
      input.taskType
    )
    .first<AgentTaskRequestRow>();
  return row ? toClaimedRequest(row) : null;
}

export async function completeAgentTaskRequest(
  db: D1Database,
  input: {
    requestId: string;
    result: unknown;
    runnerId: string;
    userId: string;
  }
) {
  const timestamp = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE agent_task_requests
          SET status='completed',result_json=?,error_detail='',completed_at=?,
              updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='claimed'`
    )
    .bind(
      JSON.stringify(input.result),
      timestamp,
      timestamp,
      input.requestId,
      input.userId,
      input.runnerId
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new Error("Agent task request could not be completed");
  }
}

export async function failAgentTaskRequest(
  db: D1Database,
  input: {
    error: string;
    requestId: string;
    runnerId: string;
    userId: string;
  }
) {
  const timestamp = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE agent_task_requests
          SET status='failed',error_detail=?,completed_at=?,updated_at=?
        WHERE id=? AND user_id=? AND runner_id=? AND status='claimed'`
    )
    .bind(
      input.error.slice(0, 4000),
      timestamp,
      timestamp,
      input.requestId,
      input.userId,
      input.runnerId
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new Error("Agent task request could not be failed");
  }
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
              result_json,error_detail,updated_at
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
              result_json,error_detail,updated_at
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
              result_json,error_detail,updated_at
         FROM agent_task_requests
        WHERE user_id=? AND task_type=? AND subject_type=? AND subject_id=?
          AND status IN ('queued','claimed')
        ORDER BY created_at DESC LIMIT 1`
    )
    .bind(input.userId, input.taskType, input.subjectType, input.subjectId)
    .first<AgentTaskRequestRow>();
  return row ? toStoredRequest(row) : null;
}

export async function releaseExpiredAgentTaskRequests(
  db: D1Database,
  userId: string,
  timestamp: string
) {
  await db
    .prepare(
      `UPDATE agent_task_requests
          SET status='queued',runner_id=NULL,claimed_at=NULL,
              lease_expires_at=NULL,error_detail='Runner lease expired',
              updated_at=?
        WHERE user_id=? AND status='claimed' AND lease_expires_at<?`
    )
    .bind(timestamp, userId, timestamp)
    .run();
}

function toClaimedRequest(row: AgentTaskRequestRow): ClaimedAgentTaskRequest {
  return {
    id: row.id,
    input: JSON.parse(row.input_json) as unknown,
    subjectId: row.subject_id,
    subjectType: row.subject_type,
    taskType: row.task_type,
  };
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
