import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { agentTaskRuns } from "./agent-tasks";
import { users } from "./auth";
import { organizationContactPoints, organizations } from "./organizations";

export const countrySweeps = sqliteTable(
  "country_sweeps",
  {
    completedAt: text("completed_at"),
    countryCode: text("country_code").notNull(),
    countryName: text("country_name").notNull(),
    coverageSummaryJson: text("coverage_summary_json").default("{}").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    id: text().primaryKey(),
    missingScopeCount: integer("missing_scope_count").default(0).notNull(),
    requestedAt: text("requested_at").notNull(),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestedScopeJson: text("requested_scope_json").notNull(),
    startedAt: text("started_at"),
    status: text().default("queued").notNull(),
    taskCompleted: integer("task_completed").default(0).notNull(),
    taskFailed: integer("task_failed").default(0).notNull(),
    taskTotal: integer("task_total").default(0).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_country_sweeps_requester").on(
      table.requestedByUserId,
      sql`${table.requestedAt} desc`
    ),
    index("idx_country_sweeps_country_status").on(
      table.countryCode,
      table.status,
      sql`${table.requestedAt} desc`
    ),
  ]
);

export const countrySweepTasks = sqliteTable(
  "country_sweep_tasks",
  {
    acceptedOutputId: text("accepted_output_id"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    claimedAt: text("claimed_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    errorCode: text("error_code").default("").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    id: text().primaryKey(),
    inputHash: text("input_hash").notNull(),
    inputJson: text("input_json").notNull(),
    leaseExpiresAt: text("lease_expires_at"),
    leaseToken: text("lease_token"),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    outputJson: text("output_json"),
    phase: text().notNull(),
    scopeKey: text("scope_key").notNull(),
    status: text().default("queued").notNull(),
    sweepId: text("sweep_id")
      .notNull()
      .references(() => countrySweeps.id, { onDelete: "cascade" }),
    updatedAt: text("updated_at").notNull(),
    workerId: text("worker_id"),
  },
  (table) => [
    index("idx_country_sweep_tasks_active_lease").on(
      table.sweepId,
      table.workerId,
      table.status,
      table.leaseExpiresAt,
      table.leaseToken
    ),
    index("idx_country_sweep_tasks_claim").on(
      table.status,
      table.phase,
      table.createdAt
    ),
    unique().on(table.id, table.sweepId),
    unique().on(table.sweepId, table.phase, table.scopeKey),
  ]
);

export const countrySweepOutputs = sqliteTable(
  "country_sweep_outputs",
  {
    acceptedAt: text("accepted_at"),
    agentRunId: text("agent_run_id")
      .notNull()
      .references(() => agentTaskRuns.id, { onDelete: "restrict" }),
    attemptNumber: integer("attempt_number").notNull(),
    chunkCount: integer("chunk_count").default(0).notNull(),
    contactCount: integer("contact_count").default(0).notNull(),
    coverageSummaryJson: text("coverage_summary_json").default("{}").notNull(),
    createdAt: text("created_at").notNull(),
    errorCode: text("error_code").default("").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    id: text().primaryKey(),
    manifestSha256: text("manifest_sha256"),
    materializedAt: text("materialized_at"),
    nextChunkOrdinal: integer("next_chunk_ordinal").default(0).notNull(),
    organizationCount: integer("organization_count").default(0).notNull(),
    rollingSha256: text("rolling_sha256").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    scopeCount: integer("scope_count").default(0).notNull(),
    status: text().notNull(),
    sweepId: text("sweep_id").notNull(),
    taskId: text("task_id").notNull(),
    totalBytes: integer("total_bytes").default(0).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_country_sweep_outputs_materialization").on(
      table.status,
      table.acceptedAt,
      table.id
    ),
    foreignKey(() => ({
      columns: [table.taskId, table.sweepId],
      foreignColumns: [countrySweepTasks.id, countrySweepTasks.sweepId],
      name: "country_sweep_outputs_task_id_sweep_id_country_sweep_tasks_id_sweep_id_fk",
    })).onDelete("restrict"),
    unique().on(table.agentRunId),
    unique().on(table.taskId, table.attemptNumber),
  ]
);

export const countrySweepOutputChunks = sqliteTable(
  "country_sweep_output_chunks",
  {
    byteLength: integer("byte_length").notNull(),
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    kind: text().notNull(),
    objectKey: text("object_key").notNull(),
    ordinal: integer().notNull(),
    outputId: text("output_id")
      .notNull()
      .references(() => countrySweepOutputs.id, { onDelete: "restrict" }),
    recordCount: integer("record_count").notNull(),
    sha256: text().notNull(),
  },
  (table) => [
    index("idx_country_sweep_output_chunks_output").on(
      table.outputId,
      table.ordinal
    ),
    unique().on(table.outputId, table.ordinal),
    unique().on(table.objectKey),
  ]
);

export const countrySweepMaterializationItems = sqliteTable(
  "country_sweep_materialization_items",
  {
    attemptCount: integer("attempt_count").default(0).notNull(),
    chunkId: text("chunk_id").references(() => countrySweepOutputChunks.id, {
      onDelete: "restrict",
    }),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    cursorPrimary: text("cursor_primary").default("").notNull(),
    cursorSecondary: text("cursor_secondary").default("").notNull(),
    errorCode: text("error_code").default("").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    expectedCount: integer("expected_count").default(0).notNull(),
    id: text().primaryKey(),
    insertedCount: integer("inserted_count").default(0).notNull(),
    kind: text().notNull(),
    leaseExpiresAt: text("lease_expires_at"),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    outputId: text("output_id")
      .notNull()
      .references(() => countrySweepOutputs.id, { onDelete: "restrict" }),
    processedCount: integer("processed_count").default(0).notNull(),
    sequence: integer().notNull(),
    status: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_country_materialization_lease").on(
      table.status,
      table.leaseExpiresAt,
      table.id
    ),
    index("idx_country_materialization_claim").on(
      table.outputId,
      table.status,
      table.sequence,
      table.id
    ),
    unique().on(table.outputId, table.kind, table.sequence),
  ]
);

export const countrySweepOutputCleanup = sqliteTable(
  "country_sweep_output_cleanup",
  {
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    deletedObjectCount: integer("deleted_object_count").default(0).notNull(),
    outputId: text("output_id")
      .primaryKey()
      .references(() => countrySweepOutputs.id, { onDelete: "restrict" }),
    status: text().default("pending").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_country_sweep_output_cleanup_pending").on(
      table.status,
      table.updatedAt,
      table.outputId
    ),
  ]
);

export const countrySweepOutputOrganizations = sqliteTable(
  "country_sweep_output_organizations",
  {
    chunkId: text("chunk_id")
      .notNull()
      .references(() => countrySweepOutputChunks.id, { onDelete: "restrict" }),
    identityKey: text("identity_key").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    outputId: text("output_id")
      .notNull()
      .references(() => countrySweepOutputs.id, { onDelete: "restrict" }),
  },
  (table) => [
    index("idx_country_output_organizations_organization").on(
      table.organizationId,
      table.outputId
    ),
    primaryKey({
      columns: [table.outputId, table.identityKey],
      name: "country_sweep_output_organizations_output_id_identity_key_pk",
    }),
  ]
);

export const countrySweepOutputContacts = sqliteTable(
  "country_sweep_output_contacts",
  {
    chunkId: text("chunk_id")
      .notNull()
      .references(() => countrySweepOutputChunks.id, { onDelete: "restrict" }),
    contactKey: text("contact_key").notNull(),
    contactPointId: text("contact_point_id")
      .notNull()
      .references(() => organizationContactPoints.id, { onDelete: "restrict" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    outputId: text("output_id")
      .notNull()
      .references(() => countrySweepOutputs.id, { onDelete: "restrict" }),
  },
  (table) => [
    index("idx_country_output_contacts_organization").on(
      table.organizationId,
      table.outputId
    ),
    primaryKey({
      columns: [table.outputId, table.contactKey],
      name: "country_sweep_output_contacts_output_id_contact_key_pk",
    }),
  ]
);

export const countrySweepOutputScopes = sqliteTable(
  "country_sweep_output_scopes",
  {
    chunkId: text("chunk_id")
      .notNull()
      .references(() => countrySweepOutputChunks.id, { onDelete: "restrict" }),
    outputId: text("output_id")
      .notNull()
      .references(() => countrySweepOutputs.id, { onDelete: "restrict" }),
    scopeKey: text("scope_key").notNull(),
    taskId: text("task_id")
      .notNull()
      .references(() => countrySweepTasks.id, { onDelete: "restrict" }),
  },
  (table) => [
    index("idx_country_output_scopes_task").on(table.taskId, table.outputId),
    primaryKey({
      columns: [table.outputId, table.scopeKey],
      name: "country_sweep_output_scopes_output_id_scope_key_pk",
    }),
  ]
);
