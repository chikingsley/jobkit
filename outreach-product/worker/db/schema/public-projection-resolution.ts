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
import { organizations } from "./organizations";
import {
  publicProjectionPositionItems,
  publicProjectionRuns,
} from "./public-projection";

export const publicProjectionOrganizationResolutions = sqliteTable(
  "public_projection_organization_resolutions",
  {
    assertedCountryCode: text("asserted_country_code"),
    candidateCount: integer("candidate_count").notNull(),
    candidateDigest: text("candidate_digest").notNull(),
    claimLeaseToken: text("claim_lease_token").notNull(),
    contentAnalysisHash: text("content_analysis_hash").notNull(),
    createdAt: text("created_at").notNull(),
    duplicateBatchInputHash: text("duplicate_batch_input_hash").notNull(),
    evidenceCount: integer("evidence_count").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    id: text().primaryKey(),
    listingId: text("listing_id").notNull(),
    matchFactsAnalysisHash: text("match_facts_analysis_hash").notNull(),
    materialHash: text("material_hash").notNull(),
    materialVersion: integer("material_version").notNull(),
    normalizedCompanyName: text("normalized_company_name").notNull(),
    positionAnalysisHash: text("position_analysis_hash").notNull(),
    positionInputHash: text("position_input_hash").notNull(),
    positionItemId: text("position_item_id").notNull(),
    positionPayloadHash: text("position_payload_hash").notNull(),
    reasonCode: text("reason_code").notNull(),
    resolutionGuardToken: text("resolution_guard_token").notNull(),
    resolutionHash: text("resolution_hash").notNull(),
    resolvedLocality: text("resolved_locality").default("").notNull(),
    resolverVersion: text("resolver_version").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    selectedDisplayName: text("selected_display_name").default("").notNull(),
    selectedOrganizationId: text("selected_organization_id").references(
      () => organizations.id,
      { onDelete: "restrict" }
    ),
    sourcePositionId: text("source_position_id").notNull(),
    state: text().notNull(),
  },
  (table) => [
    index("idx_projection_org_resolution_run").on(
      table.runId,
      table.positionItemId
    ),
    foreignKey(() => ({
      columns: [table.positionItemId, table.runId],
      foreignColumns: [
        publicProjectionPositionItems.id,
        publicProjectionPositionItems.runId,
      ],
      name: "public_projection_organization_resolutions_position_item_id_run_id_public_projection_position_items_id_run_id_fk",
    })).onDelete("restrict"),
    unique().on(table.id, table.runId),
    unique().on(table.positionItemId),
  ]
);

export const publicProjectionOrganizationCandidates = sqliteTable(
  "public_projection_organization_candidates",
  {
    candidateHash: text("candidate_hash").notNull(),
    countryCode: text("country_code").notNull(),
    createdAt: text("created_at").notNull(),
    evidenceTier: integer("evidence_tier").notNull(),
    normalizedDomain: text("normalized_domain").notNull(),
    normalizedLocality: text("normalized_locality").notNull(),
    normalizedName: text("normalized_name").notNull(),
    ordinal: integer().notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    organizationStatus: text("organization_status").notNull(),
    resolutionId: text("resolution_id").notNull(),
    runId: text("run_id").notNull(),
    selected: integer().notNull(),
  },
  (table) => [
    index("idx_projection_org_candidate_identity").on(
      table.runId,
      table.organizationId,
      table.evidenceTier,
      table.resolutionId
    ),
    foreignKey(() => ({
      columns: [table.resolutionId, table.runId],
      foreignColumns: [
        publicProjectionOrganizationResolutions.id,
        publicProjectionOrganizationResolutions.runId,
      ],
      name: "public_projection_organization_candidates_resolution_id_run_id_public_projection_organization_resolutions_id_run_id_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.resolutionId, table.ordinal],
      name: "public_projection_organization_candidates_resolution_id_ordinal_pk",
    }),
    unique().on(table.resolutionId, table.organizationId),
  ]
);

export const publicProjectionOrganizationEvidence = sqliteTable(
  "public_projection_organization_evidence",
  {
    createdAt: text("created_at").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    evidenceKind: text("evidence_kind").notNull(),
    evidenceTier: integer("evidence_tier").notNull(),
    observedAt: text("observed_at").notNull(),
    ordinal: integer().notNull(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    polarity: text().notNull(),
    resolutionId: text("resolution_id").notNull(),
    runId: text("run_id").notNull(),
    sourceKey: text("source_key").notNull(),
    sourceReference: text("source_reference").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.resolutionId, table.runId],
      foreignColumns: [
        publicProjectionOrganizationResolutions.id,
        publicProjectionOrganizationResolutions.runId,
      ],
      name: "public_projection_organization_evidence_resolution_id_run_id_public_projection_organization_resolutions_id_run_id_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.resolutionId, table.ordinal],
      name: "public_projection_organization_evidence_resolution_id_ordinal_pk",
    }),
  ]
);

export const publicProjectionLocationResolutions = sqliteTable(
  "public_projection_location_resolutions",
  {
    assertedCountryCode: text("asserted_country_code"),
    boundsJson: text("bounds_json"),
    candidateCount: integer("candidate_count").notNull(),
    candidateDigest: text("candidate_digest").notNull(),
    claimLeaseToken: text("claim_lease_token").notNull(),
    coordinateKind: text("coordinate_kind").default("").notNull(),
    countryCode: text("country_code"),
    createdAt: text("created_at").notNull(),
    displayName: text("display_name").default("").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    featureType: text("feature_type").default("").notNull(),
    id: text().primaryKey(),
    latitude: real(),
    literalEvidence: text("literal_evidence").notNull(),
    literalLabel: text("literal_label").notNull(),
    locality: text().default("").notNull(),
    locationRole: text("location_role").notNull(),
    longitude: real(),
    normalizedLabel: text("normalized_label").notNull(),
    ordinal: integer().notNull(),
    positionInputHash: text("position_input_hash").notNull(),
    positionItemId: text("position_item_id").notNull(),
    postalCode: text("postal_code").default("").notNull(),
    proposedCanonicalLocationId: text("proposed_canonical_location_id")
      .default("")
      .notNull(),
    provider: text().default("").notNull(),
    queriedAt: text("queried_at"),
    reasonCode: text("reason_code").notNull(),
    region: text().default("").notNull(),
    requestHash: text("request_hash"),
    resolutionGuardToken: text("resolution_guard_token").notNull(),
    resolutionHash: text("resolution_hash").notNull(),
    resolverVersion: text("resolver_version").notNull(),
    responseHash: text("response_hash"),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    scope: text().notNull(),
    selectedProviderPlaceId: text("selected_provider_place_id")
      .default("")
      .notNull(),
    semanticKind: text("semantic_kind").notNull(),
    state: text().notNull(),
    viableCandidateCount: integer("viable_candidate_count").notNull(),
    workplaceType: text("workplace_type").notNull(),
  },
  (table) => [
    index("idx_projection_location_resolution_run").on(
      table.runId,
      table.positionItemId,
      table.ordinal
    ),
    foreignKey(() => ({
      columns: [table.positionItemId, table.runId],
      foreignColumns: [
        publicProjectionPositionItems.id,
        publicProjectionPositionItems.runId,
      ],
      name: "public_projection_location_resolutions_position_item_id_run_id_public_projection_position_items_id_run_id_fk",
    })).onDelete("restrict"),
    unique().on(table.id, table.runId),
    unique().on(table.runId, table.positionItemId, table.ordinal),
  ]
);

export const publicProjectionLocationProviderEvidence = sqliteTable(
  "public_projection_location_provider_evidence",
  {
    createdAt: text("created_at").notNull(),
    orderedCandidateIdsJson: text("ordered_candidate_ids_json").notNull(),
    permanent: integer().notNull(),
    provider: text().notNull(),
    queriedAt: text("queried_at").notNull(),
    requestHash: text("request_hash").notNull(),
    requestJson: text("request_json").notNull(),
    resolutionId: text("resolution_id").primaryKey(),
    responseHash: text("response_hash").notNull(),
    responseJson: text("response_json").notNull(),
    runId: text("run_id").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.resolutionId, table.runId],
      foreignColumns: [
        publicProjectionLocationResolutions.id,
        publicProjectionLocationResolutions.runId,
      ],
      name: "public_projection_location_provider_evidence_resolution_id_run_id_public_projection_location_resolutions_id_run_id_fk",
    })).onDelete("restrict"),
  ]
);

export const publicProjectionLocationCandidates = sqliteTable(
  "public_projection_location_candidates",
  {
    boundsJson: text("bounds_json"),
    candidateHash: text("candidate_hash").notNull(),
    contextJson: text("context_json").notNull(),
    coordinateAccuracy: text("coordinate_accuracy").notNull(),
    countryCode: text("country_code"),
    createdAt: text("created_at").notNull(),
    featureType: text("feature_type").notNull(),
    fullName: text("full_name").notNull(),
    latitude: real().notNull(),
    locality: text().notNull(),
    longitude: real().notNull(),
    matchCodeJson: text("match_code_json").notNull(),
    ordinal: integer().notNull(),
    postalCode: text("postal_code").notNull(),
    preferredName: text("preferred_name").notNull(),
    providerOrder: integer("provider_order").notNull(),
    providerPlaceId: text("provider_place_id").notNull(),
    region: text().notNull(),
    resolutionId: text("resolution_id").notNull(),
    runId: text("run_id").notNull(),
    viable: integer().notNull(),
  },
  (table) => [
    index("idx_projection_location_candidate_identity").on(
      table.providerPlaceId,
      table.resolutionId
    ),
    foreignKey(() => ({
      columns: [table.resolutionId, table.runId],
      foreignColumns: [
        publicProjectionLocationResolutions.id,
        publicProjectionLocationResolutions.runId,
      ],
      name: "public_projection_location_candidates_resolution_id_run_id_public_projection_location_resolutions_id_run_id_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.resolutionId, table.ordinal],
      name: "public_projection_location_candidates_resolution_id_ordinal_pk",
    }),
    unique().on(table.resolutionId, table.providerPlaceId),
  ]
);

export const publicProjectionLocationEvidence = sqliteTable(
  "public_projection_location_evidence",
  {
    createdAt: text("created_at").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    evidenceKind: text("evidence_kind").notNull(),
    ordinal: integer().notNull(),
    resolutionId: text("resolution_id").notNull(),
    runId: text("run_id").notNull(),
    sourceReference: text("source_reference").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.resolutionId, table.runId],
      foreignColumns: [
        publicProjectionLocationResolutions.id,
        publicProjectionLocationResolutions.runId,
      ],
      name: "public_projection_location_evidence_resolution_id_run_id_public_projection_location_resolutions_id_run_id_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.resolutionId, table.ordinal],
      name: "public_projection_location_evidence_resolution_id_ordinal_pk",
    }),
  ]
);
