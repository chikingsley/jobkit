import type { AgentRunnerContext } from "../../../app-types";
import {
  type QueuedAgentTaskRequest,
  readClaimedAgentTaskRequest,
} from "../../agent-task-requests";
import { AgentTaskError } from "../contracts";
import type { AgentTaskCompletionFence } from "../run-store";

export function buildTestLabFailureWrites(
  db: D1Database,
  userId: string,
  requestId: string,
  testLabRunId: string,
  error: string,
  retry: boolean,
  fence: AgentTaskCompletionFence
) {
  return [
    {
      expectedChanges: 1,
      statement: db
        .prepare(
          `UPDATE test_lab_runs
            SET status=?,error_detail=?,
                started_at=CASE WHEN ?=1 THEN NULL ELSE started_at END,
                completed_at=CASE WHEN ?=1 THEN NULL ELSE
                  strftime('%Y-%m-%dT%H:%M:%fZ','now') END,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND user_id=? AND status='running'
            AND agent_task_request_id=? AND ${fence.clause}`
        )
        .bind(
          retry ? "queued" : "failed",
          retry ? "" : error.slice(0, 4000),
          retry ? 1 : 0,
          retry ? 1 : 0,
          testLabRunId,
          userId,
          requestId,
          ...fence.values
        ),
    },
  ];
}

export function testLabClaimWrites(
  db: D1Database,
  userId: string,
  testLabRunId: string,
  fence: AgentTaskCompletionFence
) {
  return [
    {
      expectedChanges: 1,
      statement: db
        .prepare(
          `UPDATE test_lab_runs
            SET status='running',
                started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND user_id=? AND status='queued'
            AND ${fence.clause}`
        )
        .bind(testLabRunId, userId, ...fence.values),
    },
  ];
}

export async function failQueuedTestLabRequest(
  db: D1Database,
  runner: AgentRunnerContext,
  request: QueuedAgentTaskRequest,
  error: string,
  errorCode: "invalid_input" | "source_changed"
) {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE test_lab_runs
            SET status='failed',error_detail=?,
                completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND user_id=? AND status='queued'
            AND EXISTS (
              SELECT 1 FROM agent_task_requests failure_request
               WHERE failure_request.id=? AND failure_request.user_id=?
                 AND failure_request.status='queued'
            )`
      )
      .bind(
        error.slice(0, 4000),
        request.subjectId,
        runner.user.id,
        request.id,
        runner.user.id
      ),
    db.prepare(
      `INSERT INTO transaction_assertions(must_equal_one)
       SELECT 0 WHERE changes()<>1`
    ),
    db
      .prepare(
        `UPDATE agent_task_requests
          SET status='failed',last_error_code=?,error_detail=?,
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND user_id=? AND status='queued'`
      )
      .bind(errorCode, error.slice(0, 4000), request.id, runner.user.id),
    db.prepare(
      `INSERT INTO transaction_assertions(must_equal_one)
       SELECT 0 WHERE changes()<>1`
    ),
  ];
  try {
    await db.batch(statements);
  } catch (failure) {
    if (
      !(
        failure instanceof Error &&
        failure.message.toLowerCase().includes("constraint")
      )
    ) {
      throw failure;
    }
  }
}

export async function requireClaimedRequest(
  db: D1Database,
  runner: AgentRunnerContext,
  requestId: string
) {
  const request = await readClaimedAgentTaskRequest(db, {
    requestId,
    runnerId: runner.id,
    userId: runner.user.id,
  });
  if (!request) {
    throw new AgentTaskError("Test Lab task request was not found", 404);
  }
  return request;
}

export async function readExistingMetrics(
  db: D1Database,
  userId: string,
  testLabRunId: string
) {
  const row = await db
    .prepare(
      "SELECT metrics_json,started_at FROM test_lab_runs WHERE id=? AND user_id=?"
    )
    .bind(testLabRunId, userId)
    .first<{ metrics_json: string; started_at: string | null }>();
  if (!row) {
    throw new AgentTaskError("Test Lab run was not found", 404);
  }
  return {
    metrics: JSON.parse(row.metrics_json) as Record<string, unknown>,
    startedAt: row.started_at,
  };
}

export async function readDocumentRunContext(
  db: D1Database,
  userId: string,
  testLabRunId: string
) {
  const row = await db
    .prepare(
      `SELECT expected_json,metrics_json,started_at
         FROM test_lab_runs WHERE id=? AND user_id=? AND case_kind='document'`
    )
    .bind(testLabRunId, userId)
    .first<{
      expected_json: string;
      metrics_json: string;
      started_at: string | null;
    }>();
  if (!row) {
    throw new AgentTaskError("Document benchmark run was not found", 404);
  }
  return {
    expected: JSON.parse(row.expected_json) as unknown,
    metrics: JSON.parse(row.metrics_json) as Record<string, unknown>,
    startedAt: row.started_at,
  };
}
