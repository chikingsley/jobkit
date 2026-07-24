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
import { agentTaskRuns } from "./agent-tasks";
import { users } from "./auth";
import { publicJobs, publicJobVersions } from "./public-jobs";
import {
  publicProjectionPositionItems,
  publicProjectionRuns,
} from "./public-projection";

export const publicProjectionDuplicateCandidates = sqliteTable(
  "public_projection_duplicate_candidates",
  {
    agentTaskRunId: text("agent_task_run_id").references(
      () => agentTaskRuns.id,
      { onDelete: "restrict" }
    ),
    candidatePublicJobId: text("candidate_public_job_id").notNull(),
    candidatePublicJobVersion: integer(
      "candidate_public_job_version"
    ).notNull(),
    codexRecommendation: text("codex_recommendation"),
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    operatorDecidedAt: text("operator_decided_at"),
    operatorDecision: text("operator_decision").default("pending").notNull(),
    operatorUserId: text("operator_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    positionItemId: text("position_item_id").notNull(),
    retrievalAlgorithmVersion: text("retrieval_algorithm_version").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    signalsJson: text("signals_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_public_projection_duplicates_review").on(
      table.operatorDecision,
      table.createdAt
    ),
    foreignKey(() => ({
      columns: [table.candidatePublicJobId, table.candidatePublicJobVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_projection_duplicate_candidates_candidate_public_job_id_candidate_public_job_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.positionItemId, table.runId],
      foreignColumns: [
        publicProjectionPositionItems.id,
        publicProjectionPositionItems.runId,
      ],
      name: "public_projection_duplicate_candidates_position_item_id_run_id_public_projection_position_items_id_run_id_fk",
    })).onDelete("restrict"),
    unique().on(table.positionItemId, table.candidatePublicJobId),
  ]
);

export const publicProjectionDuplicateWork = sqliteTable(
  "public_projection_duplicate_work",
  {
    comparisonCount: integer("comparison_count").default(0).notNull(),
    comparisonDigest: text("comparison_digest").notNull(),
    createdAt: text("created_at").notNull(),
    existingPublicCursor: text("existing_public_cursor").default("").notNull(),
    expectedMemberCount: integer("expected_member_count").notNull(),
    leaseExpiresAt: text("lease_expires_at"),
    leaseToken: text("lease_token"),
    memberCount: integer("member_count").default(0).notNull(),
    memberCursor: text("member_cursor").default("").notNull(),
    memberDigest: text("member_digest").notNull(),
    phase: text().notNull(),
    retrievalAlgorithmVersion: text("retrieval_algorithm_version").notNull(),
    runId: text("run_id")
      .primaryKey()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    sameRunOwnerCursor: text("same_run_owner_cursor").default("").notNull(),
    sameRunTargetCursor: text("same_run_target_cursor").default("").notNull(),
    status: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  }
);

export const publicProjectionDuplicateAssertions = sqliteTable(
  "public_projection_duplicate_assertions",
  {
    actualChanges: integer("actual_changes").notNull(),
    expectedChanges: integer("expected_changes").notNull(),
  }
);

export const publicProjectionDuplicateBatchMembers = sqliteTable(
  "public_projection_duplicate_batch_members",
  {
    createdAt: text("created_at").notNull(),
    inputHash: text("input_hash").notNull(),
    listingId: text("listing_id").notNull(),
    materialSignalHash: text("material_signal_hash").notNull(),
    ordinal: integer().notNull(),
    positionItemId: text("position_item_id").notNull(),
    positionKey: text("position_key").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    sourceKey: text("source_key").notNull(),
    sourcePositionId: text("source_position_id").notNull(),
    sourceReference: text("source_reference").notNull(),
    sourceReferenceSignalHash: text("source_reference_signal_hash"),
  },
  (table) => [
    index("idx_projection_final_member_snapshot_page").on(
      table.runId,
      table.sourcePositionId,
      table.inputHash,
      table.positionItemId
    ),
    index("idx_projection_duplicate_member_material").on(
      table.runId,
      table.materialSignalHash,
      table.positionKey,
      table.positionItemId
    ),
    index("idx_projection_duplicate_member_source_reference").on(
      table.runId,
      table.sourceKey,
      table.positionKey,
      table.sourceReference,
      table.positionItemId
    ),
    index("idx_projection_duplicate_member_listing").on(
      table.runId,
      table.listingId,
      table.positionItemId
    ),
    foreignKey(() => ({
      columns: [table.positionItemId, table.runId],
      foreignColumns: [
        publicProjectionPositionItems.id,
        publicProjectionPositionItems.runId,
      ],
      name: "public_projection_duplicate_batch_members_position_item_id_run_id_public_projection_position_items_id_run_id_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.positionItemId],
      name: "public_projection_duplicate_batch_members_run_id_position_item_id_pk",
    }),
    unique().on(table.runId, table.ordinal),
  ]
);

export const publicProjectionDuplicateComparisons = sqliteTable(
  "public_projection_duplicate_comparisons",
  {
    conflictingSignalsJson: text("conflicting_signals_json").notNull(),
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    matchingSignalsJson: text("matching_signals_json").notNull(),
    ownerInputHash: text("owner_input_hash").notNull(),
    ownerPositionItemId: text("owner_position_item_id").notNull(),
    ownerSourcePositionId: text("owner_source_position_id").notNull(),
    reasonCode: text("reason_code").notNull(),
    relation: text().notNull(),
    retrievalAlgorithmVersion: text("retrieval_algorithm_version").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    targetInputHash: text("target_input_hash"),
    targetKind: text("target_kind").notNull(),
    targetPositionItemId: text("target_position_item_id"),
    targetPublicJobId: text("target_public_job_id"),
    targetPublicJobVersion: integer("target_public_job_version"),
    targetRedirectRootId: text("target_redirect_root_id").references(
      () => publicJobs.id,
      { onDelete: "restrict" }
    ),
    targetSourcePositionId: text("target_source_position_id"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_projection_final_d2_public_page")
      .on(table.runId, table.targetKind, table.targetPublicJobId)
      .where(sql`target_kind='existing_public'`),
    index("idx_projection_duplicate_owner").on(
      table.runId,
      table.ownerPositionItemId,
      table.targetKind,
      table.id
    ),
    uniqueIndex("idx_projection_duplicate_public_target")
      .on(
        table.runId,
        table.ownerPositionItemId,
        table.targetRedirectRootId,
        table.targetPublicJobVersion
      )
      .where(sql`target_kind='existing_public'`),
    uniqueIndex("idx_projection_duplicate_same_run_target")
      .on(table.runId, table.ownerPositionItemId, table.targetPositionItemId)
      .where(sql`target_kind='same_run'`),
    foreignKey(() => ({
      columns: [table.targetPublicJobId, table.targetPublicJobVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_projection_duplicate_comparisons_target_public_job_id_target_public_job_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.targetPositionItemId, table.runId],
      foreignColumns: [
        publicProjectionPositionItems.id,
        publicProjectionPositionItems.runId,
      ],
      name: "public_projection_duplicate_comparisons_target_position_item_id_run_id_public_projection_position_items_id_run_id_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.ownerPositionItemId, table.runId],
      foreignColumns: [
        publicProjectionPositionItems.id,
        publicProjectionPositionItems.runId,
      ],
      name: "public_projection_duplicate_comparisons_owner_position_item_id_run_id_public_projection_position_items_id_run_id_fk",
    })).onDelete("restrict"),
  ]
);

export const publicProjectionDuplicateBatches = sqliteTable(
  "public_projection_duplicate_batches",
  {
    canonicalIdentityState: text("canonical_identity_state").notNull(),
    comparisonCount: integer("comparison_count").notNull(),
    comparisonDigest: text("comparison_digest").notNull(),
    createdAt: text("created_at").notNull(),
    inputHash: text("input_hash").notNull(),
    memberDigest: text("member_digest").notNull(),
    positionMemberCount: integer("position_member_count").notNull(),
    retrievalAlgorithmVersion: text("retrieval_algorithm_version").notNull(),
    runId: text("run_id")
      .primaryKey()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
  }
);

export const publicProjectionDuplicateOperatorDecisions = sqliteTable(
  "public_projection_duplicate_operator_decisions",
  {
    createdAt: text("created_at").notNull(),
    decidedAt: text("decided_at").notNull(),
    decision: text().notNull(),
    decisionHash: text("decision_hash").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    id: text().primaryKey(),
    leftMemberKey: text("left_member_key").notNull(),
    operatorUserId: text("operator_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reasonCode: text("reason_code").notNull(),
    rightMemberKey: text("right_member_key").notNull(),
    supersedesDecisionId: text("supersedes_decision_id"),
  },
  (table) => [
    uniqueIndex("idx_projection_operator_decision_successor")
      .on(table.supersedesDecisionId)
      .where(sql`supersedes_decision_id IS NOT NULL`),
    uniqueIndex("idx_projection_operator_decision_first")
      .on(table.leftMemberKey, table.rightMemberKey)
      .where(sql`supersedes_decision_id IS NULL`),
    foreignKey(() => ({
      columns: [table.supersedesDecisionId],
      foreignColumns: [table.id],
      name: "public_projection_duplicate_operator_decisions_supersedes_decision_id_public_projection_duplicate_operator_decisions_id_fk",
    })).onDelete("restrict"),
    unique().on(table.decisionHash),
  ]
);
