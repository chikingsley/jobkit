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

export const userProfiles = sqliteTable(
  "user_profiles",
  {
    id: text().primaryKey(),
    profileJson: text("profile_json").notNull(),
    schemaVersion: integer("schema_version").default(3).notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [unique().on(table.userId)]
);

export const userPreferences = sqliteTable(
  "user_preferences",
  {
    id: text().primaryKey(),
    preferencesJson: text("preferences_json").notNull(),
    schemaVersion: integer("schema_version").default(2).notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [unique().on(table.userId)]
);

export const userDocuments = sqliteTable(
  "user_documents",
  {
    archivedAt: text("archived_at"),
    category: text().notNull(),
    contentType: text("content_type").notNull(),
    createdAt: text("created_at").notNull(),
    etag: text().default("").notNull(),
    filename: text().notNull(),
    id: text().primaryKey(),
    isDefault: integer("is_default").default(0).notNull(),
    objectKey: text("object_key").notNull(),
    r2Version: text("r2_version").default("").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_user_documents_user").on(
      table.userId,
      table.category,
      sql`${table.createdAt} desc`
    ),
    unique().on(table.objectKey),
  ]
);

export const profileImports = sqliteTable(
  "profile_imports",
  {
    appliedAt: text("applied_at"),
    createdAt: text("created_at").notNull(),
    documentId: text("document_id")
      .notNull()
      .references(() => userDocuments.id, { onDelete: "cascade" }),
    errorMessage: text("error_message"),
    id: text().primaryKey(),
    modelId: text("model_id"),
    modelProvider: text("model_provider"),
    proposalJson: text("proposal_json"),
    proposalSchemaVersion: integer("proposal_schema_version")
      .default(1)
      .notNull(),
    sourceTextDetail: text("source_text_detail").default("").notNull(),
    sourceTextKey: text("source_text_key"),
    sourceTextProvider: text("source_text_provider").default("").notNull(),
    status: text().notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_profile_imports_user_created").on(
      table.userId,
      sql`${table.createdAt} desc`
    ),
  ]
);

export const userOnboarding = sqliteTable("user_onboarding", {
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull(),
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
});

export const userDocumentPackets = sqliteTable(
  "user_document_packets",
  {
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    isDefault: integer("is_default").default(0).notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("idx_user_document_packets_one_default")
      .on(table.userId)
      .where(sql`is_default=1`),
    unique().on(table.userId, table.slug),
  ]
);

export const userDocumentPacketItems = sqliteTable(
  "user_document_packet_items",
  {
    category: text().notNull(),
    createdAt: text("created_at").notNull(),
    documentId: text("document_id")
      .notNull()
      .references(() => userDocuments.id, { onDelete: "restrict" }),
    packetId: text("packet_id")
      .notNull()
      .references(() => userDocumentPackets.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_user_document_packet_items_document").on(table.documentId),
    primaryKey({
      columns: [table.packetId, table.category],
      name: "user_document_packet_items_packet_id_category_pk",
    }),
    unique().on(table.packetId, table.position),
    unique().on(table.packetId, table.documentId),
  ]
);

export const userQualificationClaims = sqliteTable(
  "user_qualification_claims",
  {
    answer: text().notNull(),
    claimKey: text("claim_key").notNull(),
    createdAt: text("created_at").notNull(),
    kind: text().notNull(),
    label: text().notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.claimKey],
      name: "user_qualification_claims_user_id_claim_key_pk",
    }),
  ]
);

export const aiModelSettings = sqliteTable("ai_model_settings", {
  modelId: text("model_id").notNull(),
  modelProvider: text("model_provider").notNull(),
  purpose: text().primaryKey(),
  updatedAt: text("updated_at").notNull(),
});

export const userTimeZones = sqliteTable("user_time_zones", {
  timeZone: text("time_zone").notNull(),
  updatedAt: text("updated_at").notNull(),
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
});

export const userAutomationPolicies = sqliteTable("user_automation_policies", {
  allowedBoardsJson: text("allowed_boards_json").default("[]").notNull(),
  boardFormDailyLimit: integer("board_form_daily_limit").default(10).notNull(),
  boardFormMode: text("board_form_mode").default("review").notNull(),
  createdAt: text("created_at").notNull(),
  emailDailyLimit: integer("email_daily_limit").default(20).notNull(),
  emailMode: text("email_mode").default("review").notNull(),
  excludedMarketSegmentsJson: text("excluded_market_segments_json")
    .default('["language_center","training_center"]')
    .notNull(),
  followUpDelaysJson: text("follow_up_delays_json").default("[]").notNull(),
  minimumFit: text("minimum_fit").default("strong").notNull(),
  paused: integer().default(0).notNull(),
  requireKnownCompensation: integer("require_known_compensation")
    .default(0)
    .notNull(),
  routeFreshnessDays: integer("route_freshness_days").default(30).notNull(),
  updatedAt: text("updated_at").notNull(),
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
});
