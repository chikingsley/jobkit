import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { jobListingVersions, jobSourcePositions } from "./jobs";
import {
  publicJobCatalogVersions,
  publicJobEligibilityDecisions,
} from "./public-job-catalog";
import { publicJobs, publicJobVersions } from "./public-jobs";
import { publicProjectionAllocationComponents } from "./public-projection-allocation";
import { publicProjectionOrganizationResolutions } from "./public-projection-resolution";

export const publicProjectionRuns = sqliteTable(
  "public_projection_runs",
  {
    advanceStepCount: integer("advance_step_count").default(0).notNull(),
    completedAt: text("completed_at"),
    contractVersion: integer("contract_version").notNull(),
    errorCode: text("error_code").default("").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    id: text().primaryKey(),
    listingBlocked: integer("listing_blocked").default(0).notNull(),
    listingCompleted: integer("listing_completed").default(0).notNull(),
    listingFailed: integer("listing_failed").default(0).notNull(),
    listingSuperseded: integer("listing_superseded").default(0).notNull(),
    listingTotal: integer("listing_total").default(0).notNull(),
    mode: text().notNull(),
    policyHeadsHash: text("policy_heads_hash").notNull(),
    positionBlocked: integer("position_blocked").default(0).notNull(),
    positionCompleted: integer("position_completed").default(0).notNull(),
    positionFailed: integer("position_failed").default(0).notNull(),
    positionSuperseded: integer("position_superseded").default(0).notNull(),
    positionTotal: integer("position_total").default(0).notNull(),
    projectorVersion: text("projector_version").notNull(),
    requestedAt: text("requested_at").notNull(),
    requestedByUserId: text("requested_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    requestKey: text("request_key").notNull(),
    scopeJson: text("scope_json").notNull(),
    selectionComplete: integer("selection_complete").default(0).notNull(),
    selectionCursor: text("selection_cursor").default("").notNull(),
    sourceWatermarkJson: text("source_watermark_json").notNull(),
    startedAt: text("started_at"),
    status: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_public_projection_runs_status").on(
      table.status,
      table.requestedAt
    ),
    unique().on(table.requestKey),
  ]
);

export const publicProjectionListingItems = sqliteTable(
  "public_projection_listing_items",
  {
    attemptCount: integer("attempt_count").default(0).notNull(),
    checkpointJson: text("checkpoint_json").default("{}").notNull(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    errorCode: text("error_code").default("").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    id: text().primaryKey(),
    inputHash: text("input_hash").notNull(),
    leaseExpiresAt: text("lease_expires_at"),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    listingId: text("listing_id").notNull(),
    materialVersion: integer("material_version").notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    stage: text().notNull(),
    startedAt: text("started_at"),
    status: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_public_projection_listing_claim").on(
      table.status,
      table.stage,
      table.updatedAt
    ),
    foreignKey(() => ({
      columns: [table.listingId, table.materialVersion],
      foreignColumns: [
        jobListingVersions.listingId,
        jobListingVersions.materialVersion,
      ],
      name: "public_projection_listing_items_listing_id_material_version_job_listing_versions_listing_id_material_version_fk",
    })).onDelete("restrict"),
    unique().on(table.id, table.runId),
    unique().on(table.runId, table.listingId, table.materialVersion),
  ]
);

export const publicProjectionPositionItems = sqliteTable(
  "public_projection_position_items",
  {
    attemptCount: integer("attempt_count").default(0).notNull(),
    checkpointJson: text("checkpoint_json").default("{}").notNull(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    errorCode: text("error_code").default("").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    id: text().primaryKey(),
    inputHash: text("input_hash").notNull(),
    leaseExpiresAt: text("lease_expires_at"),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    listingItemId: text("listing_item_id").notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    publicJobId: text("public_job_id").references(() => publicJobs.id, {
      onDelete: "restrict",
    }),
    readinessJson: text("readiness_json").default("{}").notNull(),
    reasonCodesJson: text("reason_codes_json")
      .default('["shadow_mode"]')
      .notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    simulatedBrowseEligible: integer("simulated_browse_eligible")
      .default(0)
      .notNull(),
    simulatedJobPostingEligible: integer("simulated_job_posting_eligible")
      .default(0)
      .notNull(),
    simulatedOrganicEligible: integer("simulated_organic_eligible")
      .default(0)
      .notNull(),
    sourcePositionId: text("source_position_id")
      .notNull()
      .references(() => jobSourcePositions.id, { onDelete: "restrict" }),
    stage: text().notNull(),
    startedAt: text("started_at"),
    status: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_public_projection_position_claim").on(
      table.status,
      table.stage,
      table.updatedAt
    ),
    foreignKey(() => ({
      columns: [table.listingItemId, table.runId],
      foreignColumns: [
        publicProjectionListingItems.id,
        publicProjectionListingItems.runId,
      ],
      name: "public_projection_position_items_listing_item_id_run_id_public_projection_listing_items_id_run_id_fk",
    })).onDelete("restrict"),
    unique().on(table.id, table.runId),
    unique().on(table.runId, table.sourcePositionId),
  ]
);

export const publicProjectionCanonicalIdentitySignals = sqliteTable(
  "public_projection_canonical_identity_signals",
  {
    createdAt: text("created_at").notNull(),
    locationIdsJson: text("location_ids_json").notNull(),
    locationSetHash: text("location_set_hash").notNull(),
    normalizedSubjectsJson: text("normalized_subjects_json").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    organizationResolutionHash: text("organization_resolution_hash").notNull(),
    organizationResolutionId: text("organization_resolution_id").notNull(),
    positionItemId: text("position_item_id").notNull(),
    roleFamily: text("role_family").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    signalHash: text("signal_hash"),
    signalPayloadHash: text("signal_payload_hash").notNull(),
    state: text().notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.organizationResolutionId, table.runId],
      foreignColumns: [
        publicProjectionOrganizationResolutions.id,
        publicProjectionOrganizationResolutions.runId,
      ],
      name: "public_projection_canonical_identity_signals_organization_resolution_id_run_id_public_projection_organization_resolutions_id_run_id_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.positionItemId, table.runId],
      foreignColumns: [
        publicProjectionPositionItems.id,
        publicProjectionPositionItems.runId,
      ],
      name: "public_projection_canonical_identity_signals_position_item_id_run_id_public_projection_position_items_id_run_id_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.positionItemId],
      name: "public_projection_canonical_identity_signals_run_id_position_item_id_pk",
    }),
  ]
);

export const publicProjectionResolutionSeals = sqliteTable(
  "public_projection_resolution_seals",
  {
    canonicalSignalHash: text("canonical_signal_hash"),
    claimLeaseToken: text("claim_lease_token").notNull(),
    createdAt: text("created_at").notNull(),
    duplicateBatchInputHash: text("duplicate_batch_input_hash").notNull(),
    locationCount: integer("location_count").notNull(),
    locationSetHash: text("location_set_hash").notNull(),
    organizationResolutionHash: text("organization_resolution_hash").notNull(),
    organizationResolutionId: text("organization_resolution_id").notNull(),
    positionInputHash: text("position_input_hash").notNull(),
    positionItemId: text("position_item_id").notNull(),
    reasonCode: text("reason_code").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    sealHash: text("seal_hash").notNull(),
    sourcePositionId: text("source_position_id").notNull(),
    state: text().notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.organizationResolutionId, table.runId],
      foreignColumns: [
        publicProjectionOrganizationResolutions.id,
        publicProjectionOrganizationResolutions.runId,
      ],
      name: "public_projection_resolution_seals_organization_resolution_id_run_id_public_projection_organization_resolutions_id_run_id_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.positionItemId, table.runId],
      foreignColumns: [
        publicProjectionPositionItems.id,
        publicProjectionPositionItems.runId,
      ],
      name: "public_projection_resolution_seals_position_item_id_run_id_public_projection_position_items_id_run_id_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.positionItemId],
      name: "public_projection_resolution_seals_run_id_position_item_id_pk",
    }),
  ]
);

export const publicProjectionCandidateResults = sqliteTable(
  "public_projection_candidate_results",
  {
    allocationId: text("allocation_id").notNull(),
    candidateHash: text("candidate_hash"),
    candidateId: text("candidate_id"),
    candidateJson: text("candidate_json"),
    createdAt: text("created_at").notNull(),
    publicJobId: text("public_job_id"),
    reasonCode: text("reason_code").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    sourcePositionId: text("source_position_id").references(
      () => jobSourcePositions.id,
      { onDelete: "restrict" }
    ),
    state: text().notNull(),
  },
  (table) => [
    index("idx_projection_candidate_results_state").on(
      table.runId,
      table.state,
      table.allocationId
    ),
    foreignKey(() => ({
      columns: [table.runId, table.allocationId],
      foreignColumns: [
        publicProjectionAllocationComponents.runId,
        publicProjectionAllocationComponents.id,
      ],
      name: "public_projection_candidate_results_run_id_allocation_id_public_projection_allocation_components_run_id_id_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.allocationId],
      name: "public_projection_candidate_results_run_id_allocation_id_pk",
    }),
    unique().on(table.candidateId),
  ]
);

export const publicProjectionCandidateSeals = sqliteTable(
  "public_projection_candidate_seals",
  {
    blockedCount: integer("blocked_count").notNull(),
    createdAt: text("created_at").notNull(),
    finalDuplicateSealHash: text("final_duplicate_seal_hash").notNull(),
    preparedCount: integer("prepared_count").notNull(),
    resultCount: integer("result_count").notNull(),
    resultDigest: text("result_digest").notNull(),
    runId: text("run_id")
      .primaryKey()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
  }
);

export const publicProjectionPromotionManifests = sqliteTable(
  "public_projection_promotion_manifests",
  {
    activatedCatalogVersion: text("activated_catalog_version")
      .notNull()
      .references(() => publicJobCatalogVersions.version, {
        onDelete: "restrict",
      }),
    allocationId: text("allocation_id").notNull(),
    authorizedAt: text("authorized_at").notNull(),
    authorizedByUserId: text("authorized_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    candidateHash: text("candidate_hash").notNull(),
    candidateId: text("candidate_id").notNull(),
    candidateSealDigest: text("candidate_seal_digest").notNull(),
    completedAt: text("completed_at").notNull(),
    eligibilityDecisionVersion: integer(
      "eligibility_decision_version"
    ).notNull(),
    id: text().primaryKey(),
    manifestHash: text("manifest_hash").notNull(),
    predecessorCatalogVersion: text("predecessor_catalog_version")
      .notNull()
      .references(() => publicJobCatalogVersions.version, {
        onDelete: "restrict",
      }),
    publicJobId: text("public_job_id")
      .notNull()
      .references(() => publicJobs.id, { onDelete: "restrict" }),
    publicJobVersion: integer("public_job_version").notNull(),
    runId: text("run_id").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.publicJobId, table.eligibilityDecisionVersion],
      foreignColumns: [
        publicJobEligibilityDecisions.publicJobId,
        publicJobEligibilityDecisions.decisionVersion,
      ],
      name: "public_projection_promotion_manifests_public_job_id_eligibility_decision_version_public_job_eligibility_decisions_public_job_id_decision_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.publicJobId, table.publicJobVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_projection_promotion_manifests_public_job_id_public_job_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.runId, table.allocationId],
      foreignColumns: [
        publicProjectionCandidateResults.runId,
        publicProjectionCandidateResults.allocationId,
      ],
      name: "public_projection_promotion_manifests_run_id_allocation_id_public_projection_candidate_results_run_id_allocation_id_fk",
    })).onDelete("restrict"),
    unique().on(table.candidateId),
    unique().on(table.runId, table.allocationId),
    unique().on(table.manifestHash),
  ]
);
