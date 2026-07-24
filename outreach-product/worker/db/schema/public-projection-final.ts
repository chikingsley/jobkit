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
import { jobSourcePositionMappingVersions, jobSourcePositions } from "./jobs";
import { publicJobEligibilityDecisions } from "./public-job-catalog";
import { publicJobs, publicJobVersions } from "./public-jobs";
import { publicProjectionRuns } from "./public-projection";
import {
  publicProjectionDuplicateComparisons,
  publicProjectionDuplicateOperatorDecisions,
} from "./public-projection-duplicates";
import {
  publicProjectionFinalWork,
  publicProjectionFinalWorkPublicRoots,
} from "./public-projection-final-work";

export const publicProjectionFinalDuplicateRelations = sqliteTable(
  "public_projection_final_duplicate_relations",
  {
    conflictingSignalsJson: text("conflicting_signals_json").notNull(),
    createdAt: text("created_at").notNull(),
    d2ComparisonId: text("d2_comparison_id").references(
      () => publicProjectionDuplicateComparisons.id,
      { onDelete: "restrict" }
    ),
    finalizationAlgorithmVersion: text(
      "finalization_algorithm_version"
    ).notNull(),
    id: text().notNull(),
    leftEligibilityDecisionVersion: integer(
      "left_eligibility_decision_version"
    ),
    leftInputHash: text("left_input_hash"),
    leftMemberKey: text("left_member_key").notNull(),
    leftMemberKind: text("left_member_kind").notNull(),
    leftPublicJobId: text("left_public_job_id").references(
      () => publicJobs.id,
      { onDelete: "restrict" }
    ),
    leftPublicJobVersion: integer("left_public_job_version"),
    leftSourcePositionId: text("left_source_position_id").references(
      () => jobSourcePositions.id,
      { onDelete: "restrict" }
    ),
    matchingSignalsJson: text("matching_signals_json").notNull(),
    operatorDecisionId: text("operator_decision_id").references(
      () => publicProjectionDuplicateOperatorDecisions.id,
      { onDelete: "restrict" }
    ),
    reasonCode: text("reason_code").notNull(),
    relation: text().notNull(),
    relationHash: text("relation_hash").notNull(),
    rightEligibilityDecisionVersion: integer(
      "right_eligibility_decision_version"
    ),
    rightInputHash: text("right_input_hash"),
    rightMemberKey: text("right_member_key").notNull(),
    rightMemberKind: text("right_member_kind").notNull(),
    rightPublicJobId: text("right_public_job_id").references(
      () => publicJobs.id,
      { onDelete: "restrict" }
    ),
    rightPublicJobVersion: integer("right_public_job_version"),
    rightSourcePositionId: text("right_source_position_id").references(
      () => jobSourcePositions.id,
      { onDelete: "restrict" }
    ),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
  },
  (table) => [
    index("idx_projection_final_relation_right").on(
      table.runId,
      table.rightMemberKey,
      table.id
    ),
    index("idx_projection_final_relation_left").on(
      table.runId,
      table.leftMemberKey,
      table.id
    ),
    foreignKey(() => ({
      columns: [table.rightPublicJobId, table.rightEligibilityDecisionVersion],
      foreignColumns: [
        publicJobEligibilityDecisions.publicJobId,
        publicJobEligibilityDecisions.decisionVersion,
      ],
      name: "public_projection_final_duplicate_relations_right_public_job_id_right_eligibility_decision_version_public_job_eligibility_decisions_public_job_id_decision_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.rightPublicJobId, table.rightPublicJobVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_projection_final_duplicate_relations_right_public_job_id_right_public_job_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.leftPublicJobId, table.leftEligibilityDecisionVersion],
      foreignColumns: [
        publicJobEligibilityDecisions.publicJobId,
        publicJobEligibilityDecisions.decisionVersion,
      ],
      name: "public_projection_final_duplicate_relations_left_public_job_id_left_eligibility_decision_version_public_job_eligibility_decisions_public_job_id_decision_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.leftPublicJobId, table.leftPublicJobVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_projection_final_duplicate_relations_left_public_job_id_left_public_job_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.id],
      name: "public_projection_final_duplicate_relations_run_id_id_pk",
    }),
    unique().on(table.runId, table.leftMemberKey, table.rightMemberKey),
  ]
);

export const publicProjectionFinalCanonicalLiveInputs = sqliteTable(
  "public_projection_final_canonical_live_inputs",
  {
    createdAt: text("created_at").notNull(),
    inputHash: text("input_hash").notNull(),
    publicJobId: text("public_job_id")
      .notNull()
      .references(() => publicJobs.id, { onDelete: "restrict" }),
    publicJobVersion: integer("public_job_version").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    signalHash: text("signal_hash").notNull(),
    signalKind: text("signal_kind").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.publicJobId, table.publicJobVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_projection_final_canonical_live_inputs_public_job_id_public_job_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [
        table.runId,
        table.publicJobId,
        table.publicJobVersion,
        table.signalKind,
        table.signalHash,
      ],
      name: "public_projection_final_canonical_live_inputs_run_id_public_job_id_public_job_version_signal_kind_signal_hash_pk",
    }),
  ]
);

export const publicProjectionFinalSourceMappingInputs = sqliteTable(
  "public_projection_final_source_mapping_inputs",
  {
    createdAt: text("created_at").notNull(),
    inputHash: text("input_hash").notNull(),
    mappingHash: text("mapping_hash").notNull(),
    mappingVersion: integer("mapping_version").notNull(),
    publicJobId: text("public_job_id")
      .notNull()
      .references(() => publicJobs.id, { onDelete: "restrict" }),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    sourcePositionId: text("source_position_id")
      .notNull()
      .references(() => jobSourcePositions.id, { onDelete: "restrict" }),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.sourcePositionId, table.mappingVersion],
      foreignColumns: [
        jobSourcePositionMappingVersions.sourcePositionId,
        jobSourcePositionMappingVersions.version,
      ],
      name: "public_projection_final_source_mapping_inputs_source_position_id_mapping_version_job_source_position_mapping_versions_source_position_id_version_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.sourcePositionId],
      name: "public_projection_final_source_mapping_inputs_run_id_source_position_id_pk",
    }),
  ]
);

export const publicProjectionFinalComponentWork = sqliteTable(
  "public_projection_final_component_work",
  {
    allocationHash: text("allocation_hash"),
    allocationId: text("allocation_id"),
    allocationState: text("allocation_state"),
    ambiguous: integer().default(0).notNull(),
    artifactHash: text("artifact_hash"),
    childCursor: text("child_cursor").default("").notNull(),
    createdAt: text("created_at").notNull(),
    encodedBytes: integer("encoded_bytes").default(0).notNull(),
    foundingSourcePositionId: text("founding_source_position_id"),
    losingRootCount: integer("losing_root_count"),
    memberCount: integer("member_count").default(0).notNull(),
    memberDigest: text("member_digest"),
    memberLastCursor: text("member_last_cursor").default("").notNull(),
    oversized: integer().default(0).notNull(),
    proposedPublicJobId: text("proposed_public_job_id"),
    reasonCode: text("reason_code"),
    relationCount: integer("relation_count").default(0).notNull(),
    relationDigest: text("relation_digest"),
    relationLastCursor: text("relation_last_cursor").default("").notNull(),
    rootCandidateCount: integer("root_candidate_count").default(0).notNull(),
    rootCount: integer("root_count").default(0).notNull(),
    rootDigest: text("root_digest"),
    rootExpectedCount: integer("root_expected_count"),
    rootLastCursor: text("root_last_cursor").default("").notNull(),
    rootSummaryReady: integer("root_summary_ready").default(0).notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionFinalWork.runId, {
        onDelete: "restrict",
      }),
    seedMemberKey: text("seed_member_key").notNull(),
    sourceMappedWinner: integer("source_mapped_winner").default(0).notNull(),
    state: text().notNull(),
    updatedAt: text("updated_at").notNull(),
    updateLastCursor: text("update_last_cursor").default("").notNull(),
    winningPublicJobId: text("winning_public_job_id"),
  },
  (table) => [
    primaryKey({
      columns: [table.runId, table.seedMemberKey],
      name: "public_projection_final_component_work_run_id_seed_member_key_pk",
    }),
  ]
);

export const publicProjectionFinalComponentFrontier = sqliteTable(
  "public_projection_final_component_frontier",
  {
    createdAt: text("created_at").notNull(),
    expanded: integer().default(0).notNull(),
    leftEdgeCursor: text("left_edge_cursor").default("").notNull(),
    memberKey: text("member_key").notNull(),
    ordinal: integer(),
    rightEdgeCursor: text("right_edge_cursor").default("").notNull(),
    runId: text("run_id").notNull(),
    seedMemberKey: text("seed_member_key").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.runId, table.seedMemberKey],
      foreignColumns: [
        publicProjectionFinalComponentWork.runId,
        publicProjectionFinalComponentWork.seedMemberKey,
      ],
      name: "public_projection_final_component_frontier_run_id_seed_member_key_public_projection_final_component_work_run_id_seed_member_key_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.seedMemberKey, table.memberKey],
      name: "public_projection_final_component_frontier_run_id_seed_member_key_member_key_pk",
    }),
    unique().on(table.runId, table.memberKey),
  ]
);

export const publicProjectionFinalComponentRootCandidates = sqliteTable(
  "public_projection_final_component_root_candidates",
  {
    createdAt: text("created_at").notNull(),
    firstPublishedSort: text("first_published_sort").notNull(),
    memberKey: text("member_key").notNull(),
    originatingPublicJobId: text("originating_public_job_id").notNull(),
    publicJobCreatedAt: text("public_job_created_at").notNull(),
    publishedMissingRank: integer("published_missing_rank").notNull(),
    redirectRootId: text("redirect_root_id").notNull(),
    runId: text("run_id").notNull(),
    seedMemberKey: text("seed_member_key").notNull(),
    servedPublicly: integer("served_publicly").notNull(),
  },
  (table) => [
    index("idx_projection_final_component_root_winner").on(
      table.runId,
      table.seedMemberKey,
      sql`${table.servedPublicly} desc`,
      table.publishedMissingRank,
      table.firstPublishedSort,
      table.publicJobCreatedAt,
      table.redirectRootId,
      table.memberKey
    ),
    foreignKey(() => ({
      columns: [table.runId, table.originatingPublicJobId],
      foreignColumns: [
        publicProjectionFinalWorkPublicRoots.runId,
        publicProjectionFinalWorkPublicRoots.originatingPublicJobId,
      ],
      name: "public_projection_final_component_root_candidates_run_id_originating_public_job_id_public_projection_final_work_public_roots_run_id_originating_public_job_id_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.runId, table.seedMemberKey],
      foreignColumns: [
        publicProjectionFinalComponentWork.runId,
        publicProjectionFinalComponentWork.seedMemberKey,
      ],
      name: "public_projection_final_component_root_candidates_run_id_seed_member_key_public_projection_final_component_work_run_id_seed_member_key_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.seedMemberKey, table.memberKey],
      name: "public_projection_final_component_root_candidates_run_id_seed_member_key_member_key_pk",
    }),
  ]
);

export const publicProjectionFinalDuplicateSeals = sqliteTable(
  "public_projection_final_duplicate_seals",
  {
    allocationAlgorithmVersion: text("allocation_algorithm_version").notNull(),
    allocationCount: integer("allocation_count").notNull(),
    allocationDigest: text("allocation_digest").notNull(),
    blockedAllocationCount: integer("blocked_allocation_count").notNull(),
    blockedResolutionCount: integer("blocked_resolution_count").notNull(),
    canonicalLiveInputCount: integer("canonical_live_input_count").notNull(),
    canonicalLiveInputDigest: text("canonical_live_input_digest").notNull(),
    createdAt: text("created_at").notNull(),
    duplicateBatchInputHash: text("duplicate_batch_input_hash").notNull(),
    finalizationAlgorithmVersion: text(
      "finalization_algorithm_version"
    ).notNull(),
    promotableCount: integer("promotable_count").notNull(),
    relationCount: integer("relation_count").notNull(),
    relationDigest: text("relation_digest").notNull(),
    resolutionCount: integer("resolution_count").notNull(),
    resolutionDigest: text("resolution_digest").notNull(),
    resolvedPositionCount: integer("resolved_position_count").notNull(),
    runId: text("run_id")
      .primaryKey()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    sealHash: text("seal_hash").notNull(),
    sourceMappingInputCount: integer("source_mapping_input_count").notNull(),
    sourceMappingInputDigest: text("source_mapping_input_digest").notNull(),
  }
);

export const publicProjectionFinalAssertions = sqliteTable(
  "public_projection_final_assertions",
  {
    actualChanges: integer("actual_changes").notNull(),
    expectedChanges: integer("expected_changes").notNull(),
  }
);
