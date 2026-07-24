import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { jobSourcePositions } from "./jobs";
import { canonicalLocations, organizations } from "./organizations";
import { publicJobCatalogMembers } from "./public-job-catalog";
import { publicProjectionAllocationComponents } from "./public-projection-allocation";

export const sourcePublicationPolicyVersions = sqliteTable(
  "source_publication_policy_versions",
  {
    allowedFieldsJson: text("allowed_fields_json").notNull(),
    approvalState: text("approval_state").notNull(),
    attributionMode: text("attribution_mode").notNull(),
    createdAt: text("created_at").notNull(),
    decisionNote: text("decision_note").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    maxVerbatimChars: integer("max_verbatim_chars").notNull(),
    policyHash: text("policy_hash").notNull(),
    predecessorVersion: integer("predecessor_version"),
    publicationEnabled: integer("publication_enabled").notNull(),
    publicationScope: text("publication_scope").notNull(),
    robotsCheckedAt: text("robots_checked_at"),
    robotsUrl: text("robots_url").default("").notNull(),
    sourceKey: text("source_key").notNull(),
    sourceOriginUrl: text("source_origin_url").default("").notNull(),
    termsCheckedAt: text("terms_checked_at"),
    termsUrl: text("terms_url").default("").notNull(),
    version: integer().notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.sourceKey, table.predecessorVersion],
      foreignColumns: [table.sourceKey, table.version],
      name: "source_publication_policy_versions_source_key_predecessor_version_source_publication_policy_versions_source_key_version_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.sourceKey, table.version],
      name: "source_publication_policy_versions_source_key_version_pk",
    }),
    unique().on(table.sourceKey, table.idempotencyKey),
  ]
);

export const sourcePublicationPolicyHeads = sqliteTable(
  "source_publication_policy_heads",
  {
    currentVersion: integer("current_version").notNull(),
    sourceKey: text("source_key").primaryKey(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.sourceKey, table.currentVersion],
      foreignColumns: [
        sourcePublicationPolicyVersions.sourceKey,
        sourcePublicationPolicyVersions.version,
      ],
      name: "source_publication_policy_heads_source_key_current_version_source_publication_policy_versions_source_key_version_fk",
    })).onDelete("restrict"),
  ]
);

export const publicJobs = sqliteTable("public_jobs", {
  createdAt: text("created_at").notNull(),
  id: text().primaryKey(),
});

export const publicJobAliases = sqliteTable(
  "public_job_aliases",
  {
    createdAt: text("created_at").notNull(),
    publicJobId: text("public_job_id")
      .notNull()
      .references(() => publicJobs.id, { onDelete: "restrict" }),
    slug: text().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.publicJobId, table.slug],
      name: "public_job_aliases_public_job_id_slug_pk",
    }),
  ]
);

export const publicJobVersions = sqliteTable(
  "public_job_versions",
  {
    canonicalSlug: text("canonical_slug").notNull(),
    compensationJson: text("compensation_json").notNull(),
    contentSchemaVersion: integer("content_schema_version").notNull(),
    createdAt: text("created_at").notNull(),
    datePosted: text("date_posted"),
    datePostedProvenance: text("date_posted_provenance").notNull(),
    descriptionHtml: text("description_html").notNull(),
    employmentTypesJson: text("employment_types_json").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    materialChangedAt: text("material_changed_at").notNull(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    organizationName: text("organization_name").notNull(),
    organizationResolutionState: text(
      "organization_resolution_state"
    ).notNull(),
    predecessorVersion: integer("predecessor_version"),
    producerId: text("producer_id").notNull(),
    producerKind: text("producer_kind").notNull(),
    publicContentHash: text("public_content_hash").notNull(),
    publicContentHashVersion: integer("public_content_hash_version").notNull(),
    publicJobId: text("public_job_id")
      .notNull()
      .references(() => publicJobs.id, { onDelete: "restrict" }),
    title: text().notNull(),
    validThrough: text("valid_through"),
    validThroughProvenance: text("valid_through_provenance").notNull(),
    version: integer().notNull(),
    workplaceType: text("workplace_type").notNull(),
  },
  (table) => [
    index("idx_public_job_versions_slug").on(table.canonicalSlug),
    foreignKey(() => ({
      columns: [table.publicJobId, table.canonicalSlug],
      foreignColumns: [publicJobAliases.publicJobId, publicJobAliases.slug],
      name: "public_job_versions_public_job_id_canonical_slug_public_job_aliases_public_job_id_slug_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.publicJobId, table.predecessorVersion],
      foreignColumns: [table.publicJobId, table.version],
      name: "public_job_versions_public_job_id_predecessor_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.publicJobId, table.version],
      name: "public_job_versions_public_job_id_version_pk",
    }),
    unique().on(table.publicJobId, table.idempotencyKey),
  ]
);

export const publicJobHeads = sqliteTable(
  "public_job_heads",
  {
    currentVersion: integer("current_version").notNull(),
    publicJobId: text("public_job_id").primaryKey(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.publicJobId, table.currentVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_job_heads_public_job_id_current_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
  ]
);

export const publicJobVersionLocations = sqliteTable(
  "public_job_version_locations",
  {
    countryCode: text("country_code"),
    createdAt: text("created_at").notNull(),
    displayName: text("display_name").notNull(),
    locality: text().default("").notNull(),
    locationId: text("location_id").references(() => canonicalLocations.id, {
      onDelete: "restrict",
    }),
    locationJson: text("location_json").notNull(),
    locationRole: text("location_role").notNull(),
    ordinal: integer().notNull(),
    postalCode: text("postal_code").default("").notNull(),
    publicJobId: text("public_job_id").notNull(),
    publicJobVersion: integer("public_job_version").notNull(),
    region: text().default("").notNull(),
    resolutionState: text("resolution_state").notNull(),
  },
  (table) => [
    index("idx_public_job_locations_resolved").on(
      table.publicJobId,
      table.publicJobVersion,
      table.locationRole,
      table.resolutionState
    ),
    foreignKey(() => ({
      columns: [table.publicJobId, table.publicJobVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_job_version_locations_public_job_id_public_job_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.publicJobId, table.publicJobVersion, table.ordinal],
      name: "public_job_version_locations_public_job_id_public_job_version_ordinal_pk",
    }),
  ]
);

export const publicJobIdentitySignals = sqliteTable(
  "public_job_identity_signals",
  {
    createdAt: text("created_at").notNull(),
    publicJobId: text("public_job_id").notNull(),
    publicJobVersion: integer("public_job_version").notNull(),
    signalHash: text("signal_hash").notNull(),
    signalKind: text("signal_kind").notNull(),
  },
  (table) => [
    index("idx_public_job_canonical_signal_page").on(
      table.signalKind,
      table.signalHash,
      table.publicJobId,
      table.publicJobVersion
    ),
    index("idx_public_job_identity_signal_lookup").on(
      table.signalKind,
      table.signalHash
    ),
    foreignKey(() => ({
      columns: [table.publicJobId, table.publicJobVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_job_identity_signals_public_job_id_public_job_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [
        table.publicJobId,
        table.publicJobVersion,
        table.signalKind,
        table.signalHash,
      ],
      name: "public_job_identity_signals_public_job_id_public_job_version_signal_kind_signal_hash_pk",
    }),
  ]
);

export const publicSourceDisplayLabelVersions = sqliteTable(
  "public_source_display_label_versions",
  {
    createdAt: text("created_at").notNull(),
    displayLabel: text("display_label").notNull(),
    predecessorVersion: integer("predecessor_version"),
    sourceKey: text("source_key").notNull(),
    version: integer().notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.sourceKey, table.predecessorVersion],
      foreignColumns: [table.sourceKey, table.version],
      name: "public_source_display_label_versions_source_key_predecessor_version_public_source_display_label_versions_source_key_version_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.sourceKey, table.version],
      name: "public_source_display_label_versions_source_key_version_pk",
    }),
  ]
);

export const publicSourceDisplayLabelHeads = sqliteTable(
  "public_source_display_label_heads",
  {
    currentVersion: integer("current_version").notNull(),
    sourceKey: text("source_key").primaryKey(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.sourceKey, table.currentVersion],
      foreignColumns: [
        publicSourceDisplayLabelVersions.sourceKey,
        publicSourceDisplayLabelVersions.version,
      ],
      name: "public_source_display_label_heads_source_key_current_version_public_source_display_label_versions_source_key_version_fk",
    })).onDelete("restrict"),
  ]
);

export const sourcePublicationPolicyLabelVersions = sqliteTable(
  "source_publication_policy_label_versions",
  {
    createdAt: text("created_at").notNull(),
    labelVersion: integer("label_version").notNull(),
    policyVersion: integer("policy_version").notNull(),
    sourceKey: text("source_key").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.sourceKey, table.labelVersion],
      foreignColumns: [
        publicSourceDisplayLabelVersions.sourceKey,
        publicSourceDisplayLabelVersions.version,
      ],
      name: "source_publication_policy_label_versions_source_key_label_version_public_source_display_label_versions_source_key_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.sourceKey, table.policyVersion],
      foreignColumns: [
        sourcePublicationPolicyVersions.sourceKey,
        sourcePublicationPolicyVersions.version,
      ],
      name: "source_publication_policy_label_versions_source_key_policy_version_source_publication_policy_versions_source_key_version_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.sourceKey, table.policyVersion],
      name: "source_publication_policy_label_versions_source_key_policy_version_pk",
    }),
  ]
);

export const publicJobAllocations = sqliteTable(
  "public_job_allocations",
  {
    allocationAlgorithmVersion: text("allocation_algorithm_version").notNull(),
    allocationHash: text("allocation_hash").notNull(),
    createdAt: text("created_at").notNull(),
    foundingSourcePositionId: text("founding_source_position_id")
      .notNull()
      .references(() => jobSourcePositions.id, { onDelete: "restrict" }),
    originatingAllocationId: text("originating_allocation_id").notNull(),
    originatingRunId: text("originating_run_id").notNull(),
    publicJobId: text("public_job_id")
      .primaryKey()
      .references(() => publicJobs.id, { onDelete: "restrict" }),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.originatingRunId, table.originatingAllocationId],
      foreignColumns: [
        publicProjectionAllocationComponents.runId,
        publicProjectionAllocationComponents.id,
      ],
      name: "public_job_allocations_originating_run_id_originating_allocation_id_public_projection_allocation_components_run_id_id_fk",
    })).onDelete("restrict"),
  ]
);

export const publicJobSearchIndex = sqliteTable(
  "public_job_search_index",
  {
    conservativeHourlyUsd: real("conservative_hourly_usd"),
    createdAt: text("created_at").notNull(),
    effectiveRecency: text("effective_recency").notNull(),
    publicJobId: text("public_job_id").notNull(),
    publicJobVersion: integer("public_job_version").notNull(),
    searchDocument: text("search_document").notNull(),
    searchTermsJson: text("search_terms_json").notNull(),
    titleSortKey: text("title_sort_key").notNull(),
    validFromOrdinal: integer("valid_from_ordinal").notNull(),
  },
  (table) => [
    index("idx_public_job_search_title").on(
      table.titleSortKey,
      table.publicJobId
    ),
    index("idx_public_job_search_hourly").on(
      sql`${table.conservativeHourlyUsd} desc`,
      sql`${table.effectiveRecency} desc`,
      table.publicJobId
    ),
    index("idx_public_job_search_recent").on(
      sql`${table.effectiveRecency} desc`,
      table.publicJobId
    ),
    foreignKey(() => ({
      columns: [table.publicJobId, table.publicJobVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_job_search_index_public_job_id_public_job_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.publicJobId, table.validFromOrdinal],
      foreignColumns: [
        publicJobCatalogMembers.publicJobId,
        publicJobCatalogMembers.validFromOrdinal,
      ],
      name: "public_job_search_index_public_job_id_valid_from_ordinal_public_job_catalog_members_public_job_id_valid_from_ordinal_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.publicJobId, table.validFromOrdinal],
      name: "public_job_search_index_public_job_id_valid_from_ordinal_pk",
    }),
  ]
);

export const publicJobSearchTerms = sqliteTable(
  "public_job_search_terms",
  {
    createdAt: text("created_at").notNull(),
    publicJobId: text("public_job_id").notNull(),
    publicJobVersion: integer("public_job_version").notNull(),
    score: integer().notNull(),
    term: text().notNull(),
    validFromOrdinal: integer("valid_from_ordinal").notNull(),
  },
  (table) => [
    index("idx_public_job_search_terms_lookup").on(
      table.term,
      table.publicJobId,
      table.validFromOrdinal
    ),
    foreignKey(() => ({
      columns: [table.publicJobId, table.validFromOrdinal],
      foreignColumns: [
        publicJobSearchIndex.publicJobId,
        publicJobSearchIndex.validFromOrdinal,
      ],
      name: "public_job_search_terms_public_job_id_valid_from_ordinal_public_job_search_index_public_job_id_valid_from_ordinal_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.publicJobId, table.validFromOrdinal, table.term],
      name: "public_job_search_terms_public_job_id_valid_from_ordinal_term_pk",
    }),
  ]
);

export const publicBrowseJobLocations = sqliteTable(
  "public_browse_job_locations",
  {
    citySlug: text("city_slug"),
    countryCode: text("country_code").notNull(),
    countrySlug: text("country_slug").notNull(),
    createdAt: text("created_at").notNull(),
    displayName: text("display_name").notNull(),
    locationRole: text("location_role").notNull(),
    ordinal: integer().notNull(),
    publicJobId: text("public_job_id").notNull(),
    publicJobVersion: integer("public_job_version").notNull(),
    validFromOrdinal: integer("valid_from_ordinal").notNull(),
  },
  (table) => [
    index("idx_public_browse_locations_country_slug").on(
      table.countrySlug,
      table.publicJobId,
      table.validFromOrdinal
    ),
    index("idx_public_browse_locations_city")
      .on(
        table.countryCode,
        table.citySlug,
        table.locationRole,
        table.publicJobId,
        table.validFromOrdinal
      )
      .where(sql`city_slug IS NOT NULL`),
    index("idx_public_browse_locations_country").on(
      table.countryCode,
      table.locationRole,
      table.publicJobId,
      table.validFromOrdinal
    ),
    foreignKey(() => ({
      columns: [table.publicJobId, table.validFromOrdinal],
      foreignColumns: [
        publicJobCatalogMembers.publicJobId,
        publicJobCatalogMembers.validFromOrdinal,
      ],
      name: "public_browse_job_locations_public_job_id_valid_from_ordinal_public_job_catalog_members_public_job_id_valid_from_ordinal_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.publicJobId, table.validFromOrdinal, table.ordinal],
      name: "public_browse_job_locations_public_job_id_valid_from_ordinal_ordinal_pk",
    }),
  ]
);
