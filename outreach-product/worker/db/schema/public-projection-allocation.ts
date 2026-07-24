import {
  foreignKey,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { jobSourcePositions } from "./jobs";
import { publicJobEligibilityDecisions } from "./public-job-catalog";
import { publicJobs, publicJobVersions } from "./public-jobs";
import {
  publicProjectionPositionItems,
  publicProjectionRuns,
} from "./public-projection";
import { publicProjectionFinalDuplicateRelations } from "./public-projection-final";

export const publicProjectionAllocationComponents = sqliteTable(
  "public_projection_allocation_components",
  {
    allocationAlgorithmVersion: text("allocation_algorithm_version").notNull(),
    allocationHash: text("allocation_hash").notNull(),
    artifactHash: text("artifact_hash").notNull(),
    candidateRootCount: integer("candidate_root_count").notNull(),
    createdAt: text("created_at").notNull(),
    finalizationAlgorithmVersion: text(
      "finalization_algorithm_version"
    ).notNull(),
    foundingSourcePositionId: text("founding_source_position_id").references(
      () => jobSourcePositions.id,
      { onDelete: "restrict" }
    ),
    id: text().notNull(),
    losingRootCount: integer("losing_root_count").notNull(),
    memberCount: integer("member_count").notNull(),
    proposedPublicJobId: text("proposed_public_job_id"),
    reasonCode: text("reason_code").notNull(),
    relationCount: integer("relation_count").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    state: text().notNull(),
    winningPublicJobId: text("winning_public_job_id").references(
      () => publicJobs.id,
      { onDelete: "restrict" }
    ),
  },
  (table) => [
    primaryKey({
      columns: [table.runId, table.id],
      name: "public_projection_allocation_components_run_id_id_pk",
    }),
  ]
);

export const publicProjectionAllocationMembers = sqliteTable(
  "public_projection_allocation_members",
  {
    allocationId: text("allocation_id").notNull(),
    createdAt: text("created_at").notNull(),
    eligibilityDecisionVersion: integer("eligibility_decision_version"),
    inputHash: text("input_hash"),
    memberHash: text("member_hash").notNull(),
    memberKey: text("member_key").notNull(),
    memberKind: text("member_kind").notNull(),
    ordinal: integer().notNull(),
    positionItemId: text("position_item_id"),
    publicJobId: text("public_job_id").references(() => publicJobs.id, {
      onDelete: "restrict",
    }),
    publicJobVersion: integer("public_job_version"),
    runId: text("run_id").notNull(),
    sourcePositionId: text("source_position_id").references(
      () => jobSourcePositions.id,
      { onDelete: "restrict" }
    ),
  },
  (table) => [
    uniqueIndex("idx_projection_allocation_member_key").on(
      table.runId,
      table.memberKey
    ),
    foreignKey(() => ({
      columns: [table.publicJobId, table.eligibilityDecisionVersion],
      foreignColumns: [
        publicJobEligibilityDecisions.publicJobId,
        publicJobEligibilityDecisions.decisionVersion,
      ],
      name: "public_projection_allocation_members_public_job_id_eligibility_decision_version_public_job_eligibility_decisions_public_job_id_decision_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.publicJobId, table.publicJobVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_projection_allocation_members_public_job_id_public_job_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.positionItemId, table.runId],
      foreignColumns: [
        publicProjectionPositionItems.id,
        publicProjectionPositionItems.runId,
      ],
      name: "public_projection_allocation_members_position_item_id_run_id_public_projection_position_items_id_run_id_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.runId, table.allocationId],
      foreignColumns: [
        publicProjectionAllocationComponents.runId,
        publicProjectionAllocationComponents.id,
      ],
      name: "public_projection_allocation_members_run_id_allocation_id_public_projection_allocation_components_run_id_id_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.allocationId, table.ordinal],
      name: "public_projection_allocation_members_run_id_allocation_id_ordinal_pk",
    }),
    unique().on(table.runId, table.allocationId, table.memberKey),
  ]
);

export const publicProjectionAllocationRoots = sqliteTable(
  "public_projection_allocation_roots",
  {
    allocationId: text("allocation_id").notNull(),
    createdAt: text("created_at").notNull(),
    eligibilityDecisionVersion: integer(
      "eligibility_decision_version"
    ).notNull(),
    firstPublishedAt: text("first_published_at"),
    foundingSourcePositionId: text("founding_source_position_id").references(
      () => jobSourcePositions.id,
      { onDelete: "restrict" }
    ),
    memberKey: text("member_key").notNull(),
    ordinal: integer().notNull(),
    publicJobCreatedAt: text("public_job_created_at").notNull(),
    publicJobId: text("public_job_id")
      .notNull()
      .references(() => publicJobs.id, { onDelete: "restrict" }),
    publicJobVersion: integer("public_job_version").notNull(),
    reasonCode: text("reason_code").notNull(),
    rootHash: text("root_hash").notNull(),
    runId: text("run_id").notNull(),
    selected: integer().notNull(),
    servedPublicly: integer("served_publicly").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.publicJobId, table.eligibilityDecisionVersion],
      foreignColumns: [
        publicJobEligibilityDecisions.publicJobId,
        publicJobEligibilityDecisions.decisionVersion,
      ],
      name: "public_projection_allocation_roots_public_job_id_eligibility_decision_version_public_job_eligibility_decisions_public_job_id_decision_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.publicJobId, table.publicJobVersion],
      foreignColumns: [
        publicJobVersions.publicJobId,
        publicJobVersions.version,
      ],
      name: "public_projection_allocation_roots_public_job_id_public_job_version_public_job_versions_public_job_id_version_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.runId, table.allocationId],
      foreignColumns: [
        publicProjectionAllocationComponents.runId,
        publicProjectionAllocationComponents.id,
      ],
      name: "public_projection_allocation_roots_run_id_allocation_id_public_projection_allocation_components_run_id_id_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.allocationId, table.ordinal],
      name: "public_projection_allocation_roots_run_id_allocation_id_ordinal_pk",
    }),
    unique().on(table.runId, table.allocationId, table.publicJobId),
    unique().on(table.runId, table.allocationId, table.memberKey),
  ]
);

export const publicProjectionAllocationRelations = sqliteTable(
  "public_projection_allocation_relations",
  {
    allocationId: text("allocation_id").notNull(),
    createdAt: text("created_at").notNull(),
    ordinal: integer().notNull(),
    relationHash: text("relation_hash").notNull(),
    relationId: text("relation_id").notNull(),
    runId: text("run_id").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.runId, table.relationId],
      foreignColumns: [
        publicProjectionFinalDuplicateRelations.runId,
        publicProjectionFinalDuplicateRelations.id,
      ],
      name: "public_projection_allocation_relations_run_id_relation_id_public_projection_final_duplicate_relations_run_id_id_fk",
    })).onDelete("restrict"),
    foreignKey(() => ({
      columns: [table.runId, table.allocationId],
      foreignColumns: [
        publicProjectionAllocationComponents.runId,
        publicProjectionAllocationComponents.id,
      ],
      name: "public_projection_allocation_relations_run_id_allocation_id_public_projection_allocation_components_run_id_id_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.allocationId, table.ordinal],
      name: "public_projection_allocation_relations_run_id_allocation_id_ordinal_pk",
    }),
    unique().on(table.runId, table.allocationId, table.relationId),
  ]
);
