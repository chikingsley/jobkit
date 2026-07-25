import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { agentRunners } from "./agent-tasks";
import { users } from "./auth";

export const inventorySources = sqliteTable("inventory_sources", {
  completenessPolicy: text("completeness_policy").notNull(),
  createdAt: text("created_at").notNull(),
  id: text().primaryKey(),
  lastCompletedAt: text("last_completed_at"),
  lastError: text("last_error").default("").notNull(),
  lastStartedAt: text("last_started_at"),
  lastSuccessAt: text("last_success_at"),
  name: text().notNull(),
  nextRefreshAt: text("next_refresh_at"),
  refreshIntervalMinutes: integer("refresh_interval_minutes"),
  status: text().default("active").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const inventoryRuns = sqliteTable(
  "inventory_runs",
  {
    checkpointJson: text("checkpoint_json").default("{}").notNull(),
    closedCount: integer("closed_count").default(0).notNull(),
    completedAt: text("completed_at"),
    errorDetail: text("error_detail").default("").notNull(),
    failedCount: integer("failed_count").default(0).notNull(),
    id: text().primaryKey(),
    processedCount: integer("processed_count").default(0).notNull(),
    refreshRequestId: text("refresh_request_id").references(
      (): AnySQLiteColumn => inventoryRefreshRequests.id,
      { onDelete: "set null" }
    ),
    runnerId: text("runner_id").references(() => agentRunners.id, {
      onDelete: "set null",
    }),
    snapshotKey: text("snapshot_key").notNull(),
    sourceActiveCount: integer("source_active_count").notNull(),
    sourceClosedCount: integer("source_closed_count").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => inventorySources.id, { onDelete: "restrict" }),
    sourceTotalCount: integer("source_total_count").notNull(),
    startedAt: text("started_at").notNull(),
    startedByUserId: text("started_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text().notNull(),
    unchangedCount: integer("unchanged_count").default(0).notNull(),
    updatedAt: text("updated_at").notNull(),
    upsertedCount: integer("upserted_count").default(0).notNull(),
  },
  (table) => [
    uniqueIndex("idx_inventory_runs_refresh_request")
      .on(table.refreshRequestId)
      .where(sql`refresh_request_id IS NOT NULL`),
    index("idx_inventory_runs_source_status").on(
      table.sourceId,
      table.status,
      sql`${table.startedAt} desc`
    ),
    unique().on(table.sourceId, table.snapshotKey),
  ]
);

export const inventoryRunBatches = sqliteTable(
  "inventory_run_batches",
  {
    batchKey: text("batch_key").notNull(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    id: text().primaryKey(),
    itemCount: integer("item_count").notNull(),
    ordinal: integer().notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => inventoryRuns.id, { onDelete: "cascade" }),
    status: text().notNull(),
  },
  (table) => [
    index("idx_inventory_run_batches_run").on(table.runId, table.ordinal),
    unique().on(table.runId, table.ordinal),
    unique().on(table.runId, table.batchKey),
  ]
);

export const inventoryRunItems = sqliteTable(
  "inventory_run_items",
  {
    batchId: text("batch_id")
      .notNull()
      .references(() => inventoryRunBatches.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    jobId: text("job_id").notNull(),
    processedAt: text("processed_at").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => inventoryRuns.id, { onDelete: "cascade" }),
    sourceJobId: text("source_job_id").notNull(),
    status: text().notNull(),
  },
  (table) => [
    index("idx_inventory_run_items_batch").on(
      table.batchId,
      table.status,
      sql`${table.processedAt} desc`
    ),
    index("idx_inventory_run_items_job").on(
      table.jobId,
      sql`${table.processedAt} desc`
    ),
    primaryKey({
      columns: [table.runId, table.sourceJobId],
      name: "inventory_run_items_run_id_source_job_id_pk",
    }),
  ]
);

export const inventorySourceOperators = sqliteTable(
  "inventory_source_operators",
  {
    createdAt: text("created_at").notNull(),
    role: text().default("operator").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => inventorySources.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.sourceId, table.userId],
      name: "inventory_source_operators_source_id_user_id_pk",
    }),
  ]
);

export const inventoryRefreshRequests = sqliteTable(
  "inventory_refresh_requests",
  {
    boardsJson: text("boards_json").default("[]").notNull(),
    claimedAt: text("claimed_at"),
    completedAt: text("completed_at"),
    errorDetail: text("error_detail").default("").notNull(),
    id: text().primaryKey(),
    inventoryRunId: text("inventory_run_id").references(
      (): AnySQLiteColumn => inventoryRuns.id,
      { onDelete: "set null" }
    ),
    leaseExpiresAt: text("lease_expires_at"),
    mode: text().notNull(),
    requestedAt: text("requested_at").notNull(),
    requestedByUserId: text("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    requestKey: text("request_key").notNull(),
    runnerId: text("runner_id").references(() => agentRunners.id, {
      onDelete: "set null",
    }),
    sourceId: text("source_id")
      .notNull()
      .references(() => inventorySources.id, { onDelete: "restrict" }),
    startedAt: text("started_at"),
    status: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_inventory_refresh_requests_active_key")
      .on(table.requestKey)
      .where(sql`status IN ('queued','claimed','crawling','publishing')`),
    index("idx_inventory_refresh_requests_source").on(
      table.sourceId,
      table.status,
      sql`${table.requestedAt} desc`
    ),
    index("idx_inventory_refresh_requests_claim").on(
      table.status,
      table.requestedAt
    ),
  ]
);
