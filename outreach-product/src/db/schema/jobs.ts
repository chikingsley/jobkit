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
import { applicationDrafts } from "./applications";
import { users } from "./auth";
import { inventoryRuns, inventorySources } from "./inventory";
import { publicJobs } from "./public-jobs";

export const jobListings = sqliteTable(
  "job_listings",
  {
    applyUrl: text("apply_url").notNull(),
    board: text().default("seriousteachers").notNull(),
    company: text().default("").notNull(),
    compensationAmountMax: integer("compensation_amount_max"),
    compensationAmountMin: integer("compensation_amount_min"),
    compensationConfidence: text("compensation_confidence")
      .default("unknown")
      .notNull(),
    compensationCurrency: text("compensation_currency"),
    compensationDisplay: text("compensation_display")
      .default("Salary not listed")
      .notNull(),
    compensationNotesJson: text("compensation_notes_json")
      .default("[]")
      .notNull(),
    compensationPeriod: text("compensation_period"),
    compensationQualifier: text("compensation_qualifier"),
    compensationSource: text("compensation_source")
      .default("unknown")
      .notNull(),
    contactName: text("contact_name").default("").notNull(),
    country: text().default("").notNull(),
    description: text().default("").notNull(),
    employerId: text("employer_id").default("").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    id: text().primaryKey(),
    inventoryRunId: text("inventory_run_id").references(
      () => inventoryRuns.id,
      { onDelete: "set null" }
    ),
    inventorySourceId: text("inventory_source_id").references(
      () => inventorySources.id,
      { onDelete: "set null" }
    ),
    inventoryStatus: text("inventory_status").default("active").notNull(),
    location: text().default("").notNull(),
    marketSegmentsJson: text("market_segments_json").default("[]").notNull(),
    materialChangedAt: text("material_changed_at").default("").notNull(),
    materialHash: text("material_hash").default("").notNull(),
    materialHashVersion: integer("material_hash_version").default(0).notNull(),
    materialVersion: integer("material_version").default(1).notNull(),
    messageRoute: text("message_route")
      .default("advertised_position")
      .notNull(),
    opportunityScope: text("opportunity_scope").default("unknown").notNull(),
    salary: text().default("").notNull(),
    sourceContentHash: text("source_content_hash").default("").notNull(),
    sourceExpiryDate: text("source_expiry_date"),
    sourceExpiryDateProvenance: text("source_expiry_date_provenance")
      .default("unknown")
      .notNull(),
    sourceExpiryDateRaw: text("source_expiry_date_raw").default("").notNull(),
    sourceFieldsJson: text("source_fields_json").default("").notNull(),
    sourceLastSeenAt: text("source_last_seen_at"),
    sourcePostedDate: text("source_posted_date"),
    sourcePostedDateProvenance: text("source_posted_date_provenance")
      .default("unknown")
      .notNull(),
    sourcePostedDateRaw: text("source_posted_date_raw").default("").notNull(),
    sourceReference: text("source_reference").default("").notNull(),
    sourceUrl: text("source_url").default("").notNull(),
    title: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_job_listings_source_posted_date").on(
      sql`${table.sourcePostedDate} desc`
    ),
    index("idx_job_listings_inventory_source_status").on(
      table.inventorySourceId,
      table.inventoryStatus,
      sql`${table.sourceLastSeenAt} desc`
    ),
  ]
);

export const userListingStates = sqliteTable(
  "user_listing_states",
  {
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobListings.id, { onDelete: "cascade" }),
    priority: integer().default(0).notNull(),
    status: text().default("new").notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_user_listing_states_listing").on(table.jobId),
    index("idx_user_listing_states_user_status_priority").on(
      table.userId,
      table.status,
      sql`${table.priority} desc`,
      sql`${table.updatedAt} desc`
    ),
    unique().on(table.userId, table.jobId),
  ]
);

export const jobEvents = sqliteTable(
  "job_events",
  {
    createdAt: text("created_at").notNull(),
    detail: text().default("").notNull(),
    draftId: text("draft_id").references(() => applicationDrafts.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    id: text().primaryKey(),
    metadataJson: text("metadata_json").default("{}").notNull(),
    userJobId: text("user_job_id")
      .notNull()
      .references(() => userListingStates.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_events_user_job_created").on(
      table.userJobId,
      sql`${table.createdAt} desc`
    ),
  ]
);

export const jobMatchFacts = sqliteTable("job_match_facts", {
  factsJson: text("facts_json").notNull(),
  jobId: text("job_id")
    .primaryKey()
    .references(() => jobListings.id, { onDelete: "cascade" }),
  modelId: text("model_id"),
  modelProvider: text("model_provider"),
  schemaVersion: integer("schema_version").notNull(),
  sourceHash: text("source_hash").default("").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const jobFeedback = sqliteTable(
  "job_feedback",
  {
    createdAt: text("created_at").notNull(),
    eventType: text("event_type").notNull(),
    id: text().primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobListings.id, { onDelete: "cascade" }),
    metadataJson: text("metadata_json").default("{}").notNull(),
    reason: text(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_job_feedback_user_job").on(
      table.userId,
      table.jobId,
      sql`${table.createdAt} desc`
    ),
    index("idx_job_feedback_user_created").on(
      table.userId,
      sql`${table.createdAt} desc`
    ),
  ]
);

export const jobPositionAnalyses = sqliteTable(
  "job_position_analyses",
  {
    jobId: text("job_id")
      .primaryKey()
      .references(() => jobListings.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    modelProvider: text("model_provider").notNull(),
    reviewNotesJson: text("review_notes_json").default("[]").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    scope: text().notNull(),
    sourceHash: text("source_hash").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_job_position_analyses_version").on(
      table.schemaVersion,
      sql`${table.updatedAt} desc`
    ),
  ]
);

export const jobPositionVariants = sqliteTable(
  "job_position_variants",
  {
    audiencesJson: text("audiences_json").default("[]").notNull(),
    certainty: text().notNull(),
    compensationEvidenceJson: text("compensation_evidence_json")
      .default("[]")
      .notNull(),
    createdAt: text("created_at").notNull(),
    employmentTypesJson: text("employment_types_json").default("[]").notNull(),
    evidenceJson: text("evidence_json").default("[]").notNull(),
    id: text().primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobListings.id, { onDelete: "cascade" }),
    locationsJson: text("locations_json").default("[]").notNull(),
    ordinal: integer().notNull(),
    requirementsJson: text("requirements_json").default("[]").notNull(),
    roleFamily: text("role_family").notNull(),
    subjectsJson: text("subjects_json").default("[]").notNull(),
    title: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_job_position_variants_job_role").on(
      table.jobId,
      table.roleFamily,
      table.ordinal
    ),
    unique().on(table.jobId, table.ordinal),
  ]
);

export const jobContentAnalyses = sqliteTable(
  "job_content_analyses",
  {
    contentJson: text("content_json").notNull(),
    jobId: text("job_id")
      .primaryKey()
      .references(() => jobListings.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    modelProvider: text("model_provider").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    sourceHash: text("source_hash").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_job_content_analyses_version").on(
      table.schemaVersion,
      sql`${table.updatedAt} desc`
    ),
  ]
);

export const jobListingVersions = sqliteTable(
  "job_listing_versions",
  {
    createdAt: text("created_at").notNull(),
    inventoryRunId: text("inventory_run_id").references(
      () => inventoryRuns.id,
      { onDelete: "set null" }
    ),
    listingId: text("listing_id")
      .notNull()
      .references(() => jobListings.id, { onDelete: "restrict" }),
    materialHash: text("material_hash").notNull(),
    materialHashVersion: integer("material_hash_version").notNull(),
    materialJson: text("material_json"),
    materialVersion: integer("material_version").notNull(),
    sourceExpiryDate: text("source_expiry_date"),
    sourceExpiryDateProvenance: text("source_expiry_date_provenance")
      .default("unknown")
      .notNull(),
    sourceExpiryDateRaw: text("source_expiry_date_raw").default("").notNull(),
    sourcePostedDate: text("source_posted_date"),
    sourcePostedDateProvenance: text("source_posted_date_provenance")
      .default("unknown")
      .notNull(),
    sourcePostedDateRaw: text("source_posted_date_raw").default("").notNull(),
  },
  (table) => [
    index("idx_job_listing_versions_material_hash").on(
      table.materialHashVersion,
      table.materialHash
    ),
    primaryKey({
      columns: [table.listingId, table.materialVersion],
      name: "job_listing_versions_listing_id_material_version_pk",
    }),
  ]
);

export const jobSourcePositions = sqliteTable(
  "job_source_positions",
  {
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => jobListings.id, { onDelete: "restrict" }),
    positionKey: text("position_key").notNull(),
    positionKind: text("position_kind").notNull(),
    sourceKey: text("source_key").notNull(),
  },
  (table) => [
    unique().on(table.id, table.sourceKey),
    unique().on(table.id, table.listingId),
    unique().on(table.listingId, table.positionKey),
  ]
);

export const jobSourcePositionMappingVersions = sqliteTable(
  "job_source_position_mapping_versions",
  {
    createdAt: text("created_at").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    listingId: text("listing_id").notNull(),
    listingMaterialVersion: integer("listing_material_version").notNull(),
    mappingHash: text("mapping_hash").notNull(),
    mappingState: text("mapping_state").notNull(),
    predecessorVersion: integer("predecessor_version"),
    publicJobId: text("public_job_id").references(() => publicJobs.id, {
      onDelete: "restrict",
    }),
    reasonCode: text("reason_code").notNull(),
    sourcePositionId: text("source_position_id").notNull(),
    version: integer().notNull(),
  },
  (table) => [
    index("idx_source_position_mappings_public_job").on(
      table.publicJobId,
      table.mappingState
    ),
    foreignKey(() => ({
      columns: [table.listingId, table.listingMaterialVersion],
      foreignColumns: [
        jobListingVersions.listingId,
        jobListingVersions.materialVersion,
      ],
      name: "job_source_position_mapping_versions_listing_id_listing_material_version_job_listing_versions_listing_id_material_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.sourcePositionId, table.listingId],
      foreignColumns: [jobSourcePositions.id, jobSourcePositions.listingId],
      name: "job_source_position_mapping_versions_source_position_id_listing_id_job_source_positions_id_listing_id_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.sourcePositionId, table.predecessorVersion],
      foreignColumns: [table.sourcePositionId, table.version],
      name: "job_source_position_mapping_versions_source_position_id_predecessor_version_job_source_position_mapping_versions_source_position_id_version_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.sourcePositionId, table.version],
      name: "job_source_position_mapping_versions_source_position_id_version_pk",
    }),
    unique().on(table.sourcePositionId, table.idempotencyKey),
  ]
);

export const jobSourcePositionMappingHeads = sqliteTable(
  "job_source_position_mapping_heads",
  {
    currentVersion: integer("current_version").notNull(),
    sourcePositionId: text("source_position_id").primaryKey(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.sourcePositionId, table.currentVersion],
      foreignColumns: [
        jobSourcePositionMappingVersions.sourcePositionId,
        jobSourcePositionMappingVersions.version,
      ],
      name: "job_source_position_mapping_heads_source_position_id_current_version_job_source_position_mapping_versions_source_position_id_version_fk",
    })).onDelete("restrict"),
  ]
);
