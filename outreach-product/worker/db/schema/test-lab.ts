import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { agentTaskRequests } from "./agent-tasks";
import { users } from "./auth";

export const testLabRuns = sqliteTable(
  "test_lab_runs",
  {
    agentTaskRequestId: text("agent_task_request_id").references(
      () => agentTaskRequests.id,
      { onDelete: "set null" }
    ),
    capability: text().notNull(),
    caseId: text("case_id").notNull(),
    caseKind: text("case_kind").notNull(),
    completedAt: text("completed_at"),
    corpusVersion: text("corpus_version").notNull(),
    createdAt: text("created_at").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    expectedJson: text("expected_json").notNull(),
    id: text().primaryKey(),
    inputJson: text("input_json").notNull(),
    intermediateJson: text("intermediate_json"),
    metricsJson: text("metrics_json").default("{}").notNull(),
    model: text().default("").notNull(),
    outputJson: text("output_json"),
    promptVersion: text("prompt_version").default("").notNull(),
    provenanceJson: text("provenance_json").default("{}").notNull(),
    provider: text().notNull(),
    startedAt: text("started_at"),
    status: text().notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    variant: text().notNull(),
  },
  (table) => [
    index("idx_test_lab_runs_status").on(
      table.userId,
      table.status,
      table.updatedAt
    ),
    index("idx_test_lab_runs_case_variant").on(
      table.userId,
      table.caseId,
      table.variant,
      sql`${table.createdAt} desc`
    ),
    index("idx_test_lab_runs_user_created").on(
      table.userId,
      sql`${table.createdAt} desc`
    ),
  ]
);

export const testLabPreferences = sqliteTable(
  "test_lab_preferences",
  {
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    leftRunId: text("left_run_id")
      .notNull()
      .references(() => testLabRuns.id, { onDelete: "cascade" }),
    notes: text().default("").notNull(),
    preference: text().notNull(),
    rightRunId: text("right_run_id")
      .notNull()
      .references(() => testLabRuns.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [unique().on(table.userId, table.leftRunId, table.rightRunId)]
);

export const testDeliveryAllowlist = sqliteTable(
  "test_delivery_allowlist",
  {
    createdAt: text("created_at").notNull(),
    email: text().notNull(),
    ownershipBasis: text("ownership_basis").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.email],
      name: "test_delivery_allowlist_user_id_email_pk",
    }),
  ]
);

export const testDeliveryCaptures = sqliteTable(
  "test_delivery_captures",
  {
    attachmentsJson: text("attachments_json").default("[]").notNull(),
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    message: text().notNull(),
    mimeSha256: text("mime_sha256").notNull(),
    objectKey: text("object_key").notNull(),
    recipient: text().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    subject: text().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_test_delivery_captures_user_created").on(
      table.userId,
      sql`${table.createdAt} desc`
    ),
    unique().on(table.objectKey),
  ]
);

export const testDeliveryEvents = sqliteTable(
  "test_delivery_events",
  {
    captureId: text("capture_id")
      .notNull()
      .references(() => testDeliveryCaptures.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    detail: text().default("").notNull(),
    eventType: text("event_type").notNull(),
    id: text().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_test_delivery_events_capture").on(
      table.captureId,
      table.createdAt
    ),
  ]
);

export const testLabClassificationAdjudications = sqliteTable(
  "test_lab_classification_adjudications",
  {
    corpusVersion: text("corpus_version").notNull(),
    createdAt: text("created_at").notNull(),
    itemId: text("item_id").notNull(),
    label: text().notNull(),
    notes: text().default("").notNull(),
    sourceHash: text("source_hash").notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_test_lab_classification_adjudications_user_updated").on(
      table.userId,
      sql`${table.updatedAt} desc`
    ),
    primaryKey({
      columns: [table.userId, table.corpusVersion, table.itemId],
      name: "test_lab_classification_adjudications_user_id_corpus_version_item_id_pk",
    }),
  ]
);
