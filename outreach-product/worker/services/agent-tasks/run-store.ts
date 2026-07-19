import type { AgentRunnerContext } from "../../app-types";
import { releaseExpiredAgentTaskRequests } from "../agent-task-requests";
import {
  AgentTaskError,
  type AgentTaskRunRow,
  type PreparedAgentTask,
} from "./contracts";

export async function createAgentTaskRun(
  db: D1Database,
  runner: AgentRunnerContext,
  task: Omit<PreparedAgentTask, "runId"> & {
    sourceHash: string;
    sourceTaskId: string;
  }
) {
  const runId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO agent_task_runs
        (id,user_id,runner_id,task_type,source_task_id,prompt_version,model,
         reasoning_effort,source_hash,prompt_hash,status,started_at,
         lease_expires_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'running',?,?,?)`
    )
    .bind(
      runId,
      runner.user.id,
      runner.id,
      task.taskType,
      task.sourceTaskId,
      task.promptVersion,
      task.model,
      task.reasoningEffort,
      task.sourceHash,
      await sha256(task.prompt),
      timestamp,
      task.leaseExpiresAt,
      timestamp
    )
    .run();
  return {
    artifacts: task.artifacts ?? [],
    leaseExpiresAt: task.leaseExpiresAt,
    model: task.model,
    outputSchema: task.outputSchema,
    prompt: task.prompt,
    promptVersion: task.promptVersion,
    reasoningEffort: task.reasoningEffort,
    runId,
    taskType: task.taskType,
    webSearch: task.webSearch,
  };
}

export async function completeAgentTaskRun(
  db: D1Database,
  runnerId: string,
  runId: string,
  output: unknown
) {
  const timestamp = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE agent_task_runs
          SET status='completed',result_json=?,completed_at=?,updated_at=?
        WHERE id=? AND runner_id=? AND status='running'`
    )
    .bind(JSON.stringify(output), timestamp, timestamp, runId, runnerId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new AgentTaskError("Agent task run could not be completed", 409);
  }
}

export async function failAgentTaskRun(
  db: D1Database,
  runnerId: string,
  runId: string,
  error: string
) {
  const timestamp = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE agent_task_runs
          SET status='failed',error_detail=?,completed_at=?,updated_at=?
        WHERE id=? AND runner_id=? AND status='running'`
    )
    .bind(error, timestamp, timestamp, runId, runnerId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new AgentTaskError("Agent task run could not be failed", 409);
  }
}

export async function expireStaleAgentTaskRuns(db: D1Database, userId: string) {
  const timestamp = new Date().toISOString();
  await releaseExpiredAgentTaskRequests(db, userId, timestamp);
  await db
    .prepare(
      `UPDATE agent_task_runs
          SET status='failed',error_detail='Runner lease expired',
              completed_at=?,updated_at=?
        WHERE user_id=? AND status='running' AND lease_expires_at<?`
    )
    .bind(timestamp, timestamp, userId, timestamp)
    .run();
}

export async function readLastAgentTaskType(db: D1Database, runnerId: string) {
  const latest = await db
    .prepare(
      `SELECT task_type FROM agent_task_runs
        WHERE runner_id=? ORDER BY started_at DESC LIMIT 1`
    )
    .bind(runnerId)
    .first<{ task_type: string }>();
  return latest?.task_type ?? null;
}

export async function readOwnedRunningAgentTask(
  db: D1Database,
  runner: AgentRunnerContext,
  runId: string
) {
  const run = await db
    .prepare(
      `SELECT task_type,source_task_id,source_hash,model,status
         FROM agent_task_runs
        WHERE id=? AND user_id=? AND runner_id=?`
    )
    .bind(runId, runner.user.id, runner.id)
    .first<AgentTaskRunRow>();
  if (!run) {
    throw new AgentTaskError("Agent task run was not found", 404);
  }
  if (run.status !== "running") {
    throw new AgentTaskError(`Agent task is already ${run.status}`, 409);
  }
  return run;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isConstraintError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.toLocaleLowerCase("en").includes("constraint")
  );
}
