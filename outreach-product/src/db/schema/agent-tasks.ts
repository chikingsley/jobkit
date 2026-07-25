import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";

export const agentRunnerPairings = sqliteTable(
  "agent_runner_pairings",
  {
    capabilitiesJson: text("capabilities_json").notNull(),
    codeHash: text("code_hash").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    id: text().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_agent_runner_pairings_user").on(
      table.userId,
      sql`${table.createdAt} desc`
    ),
    unique().on(table.codeHash),
  ]
);

export const agentRunners = sqliteTable(
  "agent_runners",
  {
    capabilitiesJson: text("capabilities_json").notNull(),
    codexVersion: text("codex_version").default("").notNull(),
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    lastSeenAt: text("last_seen_at"),
    name: text().notNull(),
    revokedAt: text("revoked_at"),
    tokenHash: text("token_hash").notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_agent_runners_user").on(
      table.userId,
      sql`${table.createdAt} desc`
    ),
    unique().on(table.tokenHash),
  ]
);

export const agentTaskRuns = sqliteTable(
  "agent_task_runs",
  {
    attemptNumber: integer("attempt_number").default(1).notNull(),
    completedAt: text("completed_at"),
    errorCode: text("error_code").default("").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    id: text().primaryKey(),
    leaseExpiresAt: text("lease_expires_at").notNull(),
    leaseToken: text("lease_token").default("historical").notNull(),
    model: text().notNull(),
    promptHash: text("prompt_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    reasoningEffort: text("reasoning_effort").notNull(),
    resultJson: text("result_json"),
    runnerId: text("runner_id")
      .notNull()
      .references(() => agentRunners.id, { onDelete: "restrict" }),
    sourceHash: text("source_hash").notNull(),
    sourceTaskId: text("source_task_id").notNull(),
    startedAt: text("started_at").notNull(),
    status: text().default("running").notNull(),
    taskType: text("task_type").notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("idx_agent_task_runs_source_attempt").on(
      table.userId,
      table.taskType,
      table.sourceTaskId,
      table.attemptNumber
    ),
    uniqueIndex("idx_agent_task_runs_active_global_job_analysis")
      .on(table.taskType, table.sourceTaskId)
      .where(
        sql`status='running' AND task_type IN ( 'job.match_facts', 'job.position_analysis', 'job.content_analysis' )`
      ),
    uniqueIndex("idx_agent_task_runs_active_source")
      .on(table.userId, table.taskType, table.sourceTaskId)
      .where(sql`status='running'`),
    index("idx_agent_task_runs_source").on(
      table.taskType,
      table.sourceTaskId,
      sql`${table.startedAt} desc`
    ),
    index("idx_agent_task_runs_user_status").on(
      table.userId,
      table.status,
      sql`${table.startedAt} desc`
    ),
  ]
);

export const agentTaskRequests = sqliteTable(
  "agent_task_requests",
  {
    attemptCount: integer("attempt_count").default(0).notNull(),
    claimedAt: text("claimed_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    id: text().primaryKey(),
    inputJson: text("input_json").default("{}").notNull(),
    lastErrorCode: text("last_error_code").default("").notNull(),
    leaseExpiresAt: text("lease_expires_at"),
    leaseToken: text("lease_token"),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    nextAttemptAt: text("next_attempt_at"),
    resultJson: text("result_json"),
    retryOfRequestId: text("retry_of_request_id"),
    runnerId: text("runner_id").references(() => agentRunners.id, {
      onDelete: "set null",
    }),
    status: text().default("queued").notNull(),
    subjectId: text("subject_id").notNull(),
    subjectType: text("subject_type").notNull(),
    taskType: text("task_type").notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_agent_task_requests_active_lease").on(
      table.userId,
      table.runnerId,
      table.status,
      table.leaseExpiresAt,
      table.leaseToken
    ),
    index("idx_agent_task_requests_ready").on(
      table.userId,
      table.taskType,
      table.status,
      table.nextAttemptAt,
      table.createdAt
    ),
    index("idx_agent_task_requests_runner").on(
      table.runnerId,
      table.status,
      table.leaseExpiresAt
    ),
    index("idx_agent_task_requests_claim").on(
      table.userId,
      table.taskType,
      table.status,
      table.createdAt
    ),
    uniqueIndex("idx_agent_task_requests_active_subject")
      .on(table.userId, table.taskType, table.subjectType, table.subjectId)
      .where(sql`status IN ('queued','claimed')`),
    foreignKey(() => ({
      columns: [table.retryOfRequestId],
      foreignColumns: [table.id],
      name: "agent_task_requests_retry_of_request_id_agent_task_requests_id_fk",
    })).onDelete("set null"),
  ]
);

export const agentTaskArtifacts = sqliteTable(
  "agent_task_artifacts",
  {
    contentType: text("content_type").notNull(),
    createdAt: text("created_at").notNull(),
    filename: text().notNull(),
    id: text().primaryKey(),
    objectKey: text("object_key").notNull(),
    purpose: text().notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => agentTaskRuns.id, { onDelete: "cascade" }),
    sha256: text().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_agent_task_artifacts_run").on(table.runId, table.userId),
    unique().on(table.runId, table.objectKey),
  ]
);
