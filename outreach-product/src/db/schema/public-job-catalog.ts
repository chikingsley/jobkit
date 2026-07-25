import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { applicationRoutes } from "./applications";
import { jobSourcePositionMappingVersions, jobSourcePositions } from "./jobs";
import {
  publicJobs,
  publicJobVersions,
  sourcePublicationPolicyVersions,
} from "./public-jobs";

export const publicJobEligibilityDecisions = sqliteTable(
  "public_job_eligibility_decisions",
  {
    applicationRouteId: text("application_route_id").references(
      () => applicationRoutes.id,
      { onDelete: "restrict" }
    ),
    applicationRouteState: text("application_route_state").notNull(),
    browseEligible: integer("browse_eligible").notNull(),
    contentReviewState: text("content_review_state").notNull(),
    decidedAt: text("decided_at").notNull(),
    decisionHash: text("decision_hash").notNull(),
    decisionNote: text("decision_note").notNull(),
    decisionVersion: integer("decision_version").notNull(),
    evaluatorKind: text("evaluator_kind").notNull(),
    evaluatorVersion: text("evaluator_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    jobPostingEligible: integer("job_posting_eligible").notNull(),
    organicIndexEligible: integer("organic_index_eligible").notNull(),
    predecessorVersion: integer("predecessor_version"),
    privacyState: text("privacy_state").notNull(),
    publicationState: text("publication_state").notNull(),
    publicJobId: text("public_job_id")
      .notNull()
      .references(() => publicJobs.id, { onDelete: "restrict" }),
    publicJobVersion: integer("public_job_version").notNull(),
    reasonCodesJson: text("reason_codes_json").notNull(),
    redirectPublicJobId: text("redirect_public_job_id").references(
      () => publicJobs.id,
      { onDelete: "restrict" }
    ),
    routeDisposition: text("route_disposition").notNull(),
    sourceOpenState: text("source_open_state").notNull(),
    verifiedAt: text("verified_at"),
  },
  (table) => [
    index("idx_public_decisions_state").on(
      table.publicationState,
      sql`${table.decidedAt} desc`
    ),
    foreignKey(() => ({
      columns: [table.publicJobId, table.publicJobVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_job_eligibility_decisions_public_job_id_public_job_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.publicJobId, table.predecessorVersion],
      foreignColumns: [table.publicJobId, table.decisionVersion],
      name: "public_job_eligibility_decisions_public_job_id_predecessor_version_public_job_eligibility_decisions_public_job_id_decision_version_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.publicJobId, table.decisionVersion],
      name: "public_job_eligibility_decisions_public_job_id_decision_version_pk",
    }),
    unique().on(table.publicJobId, table.idempotencyKey),
  ]
);

export const publicJobEligibilityHeads = sqliteTable(
  "public_job_eligibility_heads",
  {
    currentDecisionVersion: integer("current_decision_version").notNull(),
    publicJobId: text("public_job_id").primaryKey(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.publicJobId, table.currentDecisionVersion],
      foreignColumns: [
        publicJobEligibilityDecisions.publicJobId,
        publicJobEligibilityDecisions.decisionVersion,
      ],
      name: "public_job_eligibility_heads_public_job_id_current_decision_version_public_job_eligibility_decisions_public_job_id_decision_version_fk",
    })).onDelete("restrict"),
  ]
);

export const publicJobDecisionSources = sqliteTable(
  "public_job_decision_sources",
  {
    contributionKind: text("contribution_kind").notNull(),
    createdAt: text("created_at").notNull(),
    decisionVersion: integer("decision_version").notNull(),
    fieldsUsedJson: text("fields_used_json").notNull(),
    policyVersion: integer("policy_version").notNull(),
    publicJobId: text("public_job_id").notNull(),
    sourceKey: text("source_key").notNull(),
    sourceMappingVersion: integer("source_mapping_version").notNull(),
    sourcePositionId: text("source_position_id").notNull(),
  },
  (table) => [
    index("idx_public_decision_sources_policy").on(
      table.sourceKey,
      table.policyVersion
    ),
    foreignKey(() => ({
      columns: [table.sourceKey, table.policyVersion],
      foreignColumns: [
        sourcePublicationPolicyVersions.sourceKey,
        sourcePublicationPolicyVersions.version,
      ],
      name: "public_job_decision_sources_source_key_policy_version_source_publication_policy_versions_source_key_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.sourcePositionId, table.sourceKey],
      foreignColumns: [jobSourcePositions.id, jobSourcePositions.sourceKey],
      name: "public_job_decision_sources_source_position_id_source_key_job_source_positions_id_source_key_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.sourcePositionId, table.sourceMappingVersion],
      foreignColumns: [
        jobSourcePositionMappingVersions.sourcePositionId,
        jobSourcePositionMappingVersions.version,
      ],
      name: "public_job_decision_sources_source_position_id_source_mapping_version_job_source_position_mapping_versions_source_position_id_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.publicJobId, table.decisionVersion],
      foreignColumns: [
        publicJobEligibilityDecisions.publicJobId,
        publicJobEligibilityDecisions.decisionVersion,
      ],
      name: "public_job_decision_sources_public_job_id_decision_version_public_job_eligibility_decisions_public_job_id_decision_version_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [
        table.publicJobId,
        table.decisionVersion,
        table.sourcePositionId,
        table.sourceMappingVersion,
      ],
      name: "public_job_decision_sources_public_job_id_decision_version_source_position_id_source_mapping_version_pk",
    }),
  ]
);

export const publicJobCatalogVersions = sqliteTable(
  "public_job_catalog_versions",
  {
    createdAt: text("created_at").notNull(),
    locationFacetCount: integer("location_facet_count").notNull(),
    materialChangedAt: text("material_changed_at").notNull(),
    memberCount: integer("member_count").notNull(),
    membershipHash: text("membership_hash").notNull(),
    ordinal: integer(),
    predecessorVersion: text("predecessor_version"),
    representationUpdatedAt: text("representation_updated_at").notNull(),
    searchContentHash: text("search_content_hash").notNull(),
    searchDocumentCount: integer("search_document_count").notNull(),
    searchIndexVersion: text("search_index_version").notNull(),
    searchTermCount: integer("search_term_count").notNull(),
    version: text().primaryKey(),
  },
  (table) => [
    uniqueIndex("idx_public_job_catalog_versions_ordinal").on(table.ordinal),
    foreignKey(() => ({
      columns: [table.predecessorVersion],
      foreignColumns: [table.version],
      name: "public_job_catalog_versions_predecessor_version_public_job_catalog_versions_version_fk",
    })).onDelete("restrict"),
    unique().on(table.searchIndexVersion),
  ]
);

export const publicJobCatalogHeadPointer = sqliteTable(
  "public_job_catalog_head_pointer",
  {
    currentVersion: text("current_version")
      .notNull()
      .references(() => publicJobCatalogVersions.version, {
        onDelete: "restrict",
      }),
    singleton: integer().primaryKey(),
    updatedAt: text("updated_at").notNull(),
  }
);

export const publicJobCatalogSeals = sqliteTable("public_job_catalog_seals", {
  catalogVersion: text("catalog_version")
    .primaryKey()
    .references(() => publicJobCatalogVersions.version, {
      onDelete: "restrict",
    }),
  locationFacetCount: integer("location_facet_count").notNull(),
  memberCount: integer("member_count").notNull(),
  membershipHash: text("membership_hash").notNull(),
  sealedAt: text("sealed_at").notNull(),
  searchContentHash: text("search_content_hash").notNull(),
  searchDocumentCount: integer("search_document_count").notNull(),
  searchTermCount: integer("search_term_count").notNull(),
});

export const publicJobCatalogHeadHistory = sqliteTable(
  "public_job_catalog_head_history",
  {
    activatedAt: text("activated_at").notNull(),
    catalogVersion: text("catalog_version")
      .primaryKey()
      .references(() => publicJobCatalogVersions.version, {
        onDelete: "restrict",
      }),
  }
);

export const publicJobCatalogMembers = sqliteTable(
  "public_job_catalog_members",
  {
    createdAt: text("created_at").notNull(),
    detailJson: text("detail_json").notNull(),
    eligibilityDecisionHash: text("eligibility_decision_hash").notNull(),
    eligibilityDecisionVersion: integer(
      "eligibility_decision_version"
    ).notNull(),
    itemJson: text("item_json").notNull(),
    locationFacetsJson: text("location_facets_json").notNull(),
    publicContentHash: text("public_content_hash").notNull(),
    publicJobId: text("public_job_id").notNull(),
    publicJobVersion: integer("public_job_version").notNull(),
    representationUpdatedAt: text("representation_updated_at").notNull(),
    validFromOrdinal: integer("valid_from_ordinal")
      .notNull()
      .references(() => publicJobCatalogVersions.ordinal, {
        onDelete: "restrict",
      }),
    validToOrdinal: integer("valid_to_ordinal").references(
      () => publicJobCatalogVersions.ordinal,
      { onDelete: "restrict" }
    ),
  },
  (table) => [
    index("idx_public_job_catalog_members_from").on(table.validFromOrdinal),
    index("idx_public_job_catalog_members_closed")
      .on(table.validToOrdinal)
      .where(sql`valid_to_ordinal IS NOT NULL`),
    index("idx_public_job_catalog_members_open")
      .on(table.publicJobId)
      .where(sql`valid_to_ordinal IS NULL`),
    foreignKey(() => ({
      columns: [table.publicJobId, table.eligibilityDecisionVersion],
      foreignColumns: [
        publicJobEligibilityDecisions.publicJobId,
        publicJobEligibilityDecisions.decisionVersion,
      ],
      name: "public_job_catalog_members_public_job_id_eligibility_decision_version_public_job_eligibility_decisions_public_job_id_decision_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.publicJobId, table.publicJobVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_job_catalog_members_public_job_id_public_job_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.publicJobId, table.validFromOrdinal],
      name: "public_job_catalog_members_public_job_id_valid_from_ordinal_pk",
    }),
  ]
);
