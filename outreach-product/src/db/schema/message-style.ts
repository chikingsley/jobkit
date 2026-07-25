import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { jobListings } from "./jobs";

export const userMessageStyleChoices = sqliteTable(
  "user_message_style_choices",
  {
    choice: text().notNull(),
    comparisonId: text("comparison_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.comparisonId],
      name: "user_message_style_choices_user_id_comparison_id_pk",
    }),
  ]
);

export const messageExemplars = sqliteTable(
  "message_exemplars",
  {
    body: text().notNull(),
    country: text().default("").notNull(),
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    outcome: text().default("none").notNull(),
    outcomeGrade: integer("outcome_grade").default(0).notNull(),
    sentAt: text("sent_at").default("").notNull(),
    source: text().default("corpus").notNull(),
    subject: text().default("").notNull(),
    templateVariant: text("template_variant").default("").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_message_exemplars_user_grade").on(
      table.userId,
      sql`${table.outcomeGrade} desc`,
      sql`${table.sentAt} desc`
    ),
  ]
);

export const userMessageFoundations = sqliteTable(
  "user_message_foundations",
  {
    activatedAt: text("activated_at"),
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    name: text().notNull(),
    status: text().notNull(),
    templatesJson: text("templates_json").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    voiceRulesJson: text("voice_rules_json").notNull(),
  },
  (table) => [
    uniqueIndex("idx_message_foundations_active_user")
      .on(table.userId)
      .where(sql`status='active'`),
    unique().on(table.userId, table.version),
  ]
);

export const userMessageCalibrationDecisions = sqliteTable(
  "user_message_calibration_decisions",
  {
    decidedAt: text("decided_at").notNull(),
    foundationId: text("foundation_id")
      .notNull()
      .references(() => userMessageFoundations.id, { onDelete: "cascade" }),
    id: text().primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobListings.id, { onDelete: "cascade" }),
    note: text().default("").notNull(),
    renderedMessage: text("rendered_message").notNull(),
    route: text().notNull(),
    source: text().default("product").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verdict: text().notNull(),
  },
  (table) => [
    index("idx_message_calibration_user_foundation").on(
      table.userId,
      table.foundationId,
      table.decidedAt
    ),
  ]
);

export const messageThreadOutcomes = sqliteTable(
  "message_thread_outcomes",
  {
    gmailThreadId: text("gmail_thread_id").notNull(),
    id: text().primaryKey(),
    note: text().default("").notNull(),
    outcome: text().notNull(),
    recordedAt: text("recorded_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_message_thread_outcomes_user").on(
      table.userId,
      table.outcome,
      sql`${table.updatedAt} desc`
    ),
    unique().on(table.userId, table.gmailThreadId),
  ]
);
