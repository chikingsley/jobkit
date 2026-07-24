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
import { publicProjectionRuns } from "./public-projection";
import { publicProjectionFinalComponentWork } from "./public-projection-final";

export const publicProjectionFinalWork = sqliteTable(
  "public_projection_final_work",
  {
    activeComponentSeed: text("active_component_seed"),
    allocationBytes: integer("allocation_bytes").default(0).notNull(),
    allocationDigest: text("allocation_digest"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    canonicalMatchBytes: integer("canonical_match_bytes").default(0).notNull(),
    canonicalMatchCount: integer("canonical_match_count").default(0).notNull(),
    canonicalMatchDigest: text("canonical_match_digest"),
    canonicalMatchLastCursor: text("canonical_match_last_cursor")
      .default("")
      .notNull(),
    canonicalRequestBytes: integer("canonical_request_bytes")
      .default(0)
      .notNull(),
    canonicalRequestCount: integer("canonical_request_count")
      .default(0)
      .notNull(),
    canonicalRequestDigest: text("canonical_request_digest"),
    canonicalRequestLastCursor: text("canonical_request_last_cursor")
      .default("")
      .notNull(),
    componentBytes: integer("component_bytes").default(0).notNull(),
    componentCount: integer("component_count").default(0).notNull(),
    componentDigest: text("component_digest"),
    componentLastCursor: text("component_last_cursor").default("").notNull(),
    createdAt: text("created_at").notNull(),
    frozenAt: text("frozen_at").notNull(),
    inputDigest: text("input_digest").notNull(),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    leaseEpoch: integer("lease_epoch").default(0).notNull(),
    leaseExpiresAt: text("lease_expires_at"),
    leaseToken: text("lease_token"),
    mappingBytes: integer("mapping_bytes").default(0).notNull(),
    mappingCount: integer("mapping_count").default(0).notNull(),
    mappingDigest: text("mapping_digest"),
    mappingLastCursor: text("mapping_last_cursor").default("").notNull(),
    phase: text().notNull(),
    phaseCursor: text("phase_cursor").default("").notNull(),
    phaseOrdinal: integer("phase_ordinal").default(0).notNull(),
    publicRootBytes: integer("public_root_bytes").default(0).notNull(),
    publicRootCount: integer("public_root_count").default(0).notNull(),
    publicRootDigest: text("public_root_digest"),
    publicRootLastCursor: text("public_root_last_cursor").default("").notNull(),
    relationBytes: integer("relation_bytes").default(0).notNull(),
    relationCount: integer("relation_count").default(0).notNull(),
    relationDigest: text("relation_digest"),
    relationLastCursor: text("relation_last_cursor").default("").notNull(),
    resolutionBytes: integer("resolution_bytes").default(0).notNull(),
    resolutionCount: integer("resolution_count").default(0).notNull(),
    resolutionDigest: text("resolution_digest"),
    resolutionLastCursor: text("resolution_last_cursor").default("").notNull(),
    runId: text("run_id")
      .primaryKey()
      .references(() => publicProjectionRuns.id, { onDelete: "restrict" }),
    sourceMappingCount: integer("source_mapping_count").default(0).notNull(),
    sourceMappingDigest: text("source_mapping_digest"),
    sourceMappingLastCursor: text("source_mapping_last_cursor")
      .default("")
      .notNull(),
    status: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  }
);

export const publicProjectionFinalWorkResolutionInputs = sqliteTable(
  "public_projection_final_work_resolution_inputs",
  {
    canonicalSignalHash: text("canonical_signal_hash"),
    checkpointJson: text("checkpoint_json").notNull(),
    createdAt: text("created_at").notNull(),
    encodedBytes: integer("encoded_bytes").notNull(),
    inputHash: text("input_hash").notNull(),
    memberHash: text("member_hash"),
    memberKey: text("member_key"),
    ordinal: integer().notNull(),
    positionItemId: text("position_item_id").notNull(),
    resolutionReasonCode: text("resolution_reason_code").notNull(),
    resolutionSealHash: text("resolution_seal_hash").notNull(),
    resolutionState: text("resolution_state").notNull(),
    rowHash: text("row_hash").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionFinalWork.runId, {
        onDelete: "restrict",
      }),
    sourcePositionId: text("source_position_id").notNull(),
  },
  (table) => [
    index("idx_projection_final_resolution_source_page")
      .on(table.runId, table.sourcePositionId)
      .where(sql`resolution_state='resolved'`),
    index("idx_projection_final_resolution_relation_lookup").on(
      table.runId,
      table.resolutionState,
      table.canonicalSignalHash,
      table.memberKey,
      table.positionItemId
    ),
    primaryKey({
      columns: [table.runId, table.positionItemId],
      name: "public_projection_final_work_resolution_inputs_run_id_position_item_id_pk",
    }),
    unique().on(table.runId, table.sourcePositionId, table.inputHash),
    unique().on(table.runId, table.ordinal),
  ]
);

export const publicProjectionFinalWorkMappingInputs = sqliteTable(
  "public_projection_final_work_mapping_inputs",
  {
    createdAt: text("created_at").notNull(),
    encodedBytes: integer("encoded_bytes").notNull(),
    headPresent: integer("head_present").notNull(),
    inputHash: text("input_hash").notNull(),
    mappingHash: text("mapping_hash"),
    mappingState: text("mapping_state").notNull(),
    mappingVersion: integer("mapping_version"),
    ordinal: integer().notNull(),
    publicJobId: text("public_job_id"),
    rowHash: text("row_hash").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionFinalWork.runId, {
        onDelete: "restrict",
      }),
    sourcePositionId: text("source_position_id").notNull(),
  },
  (table) => [
    index("idx_projection_final_mapping_public_page").on(
      table.runId,
      table.mappingState,
      table.publicJobId
    ),
    primaryKey({
      columns: [table.runId, table.sourcePositionId],
      name: "public_projection_final_work_mapping_inputs_run_id_source_position_id_pk",
    }),
    unique().on(table.runId, table.ordinal),
  ]
);

export const publicProjectionFinalWorkCanonicalRequests = sqliteTable(
  "public_projection_final_work_canonical_requests",
  {
    createdAt: text("created_at").notNull(),
    encodedBytes: integer("encoded_bytes").notNull(),
    matchComplete: integer("match_complete").default(0).notNull(),
    matchCount: integer("match_count").default(0).notNull(),
    matchCursor: text("match_cursor").default("").notNull(),
    matchDigest: text("match_digest"),
    ordinal: integer().notNull(),
    requestHash: text("request_hash").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionFinalWork.runId, {
        onDelete: "restrict",
      }),
    signalHash: text("signal_hash").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.runId, table.signalHash],
      name: "public_projection_final_work_canonical_requests_run_id_signal_hash_pk",
    }),
    unique().on(table.runId, table.ordinal),
  ]
);

export const publicProjectionFinalWorkCanonicalMatches = sqliteTable(
  "public_projection_final_work_canonical_matches",
  {
    createdAt: text("created_at").notNull(),
    encodedBytes: integer("encoded_bytes").notNull(),
    inputHash: text("input_hash").notNull(),
    ordinal: integer().notNull(),
    publicJobId: text("public_job_id").notNull(),
    publicJobVersion: integer("public_job_version").notNull(),
    publicMemberKey: text("public_member_key").notNull(),
    rowHash: text("row_hash").notNull(),
    runId: text("run_id").notNull(),
    signalHash: text("signal_hash").notNull(),
    signalKind: text("signal_kind").notNull(),
  },
  (table) => [
    index("idx_projection_final_canonical_match_public_page").on(
      table.runId,
      table.publicJobId,
      table.publicJobVersion,
      table.signalHash
    ),
    index("idx_projection_final_canonical_match_member_page").on(
      table.runId,
      table.publicMemberKey,
      table.signalHash,
      table.publicJobId,
      table.publicJobVersion
    ),
    foreignKey(() => ({
      columns: [table.runId, table.signalHash],
      foreignColumns: [
        publicProjectionFinalWorkCanonicalRequests.runId,
        publicProjectionFinalWorkCanonicalRequests.signalHash,
      ],
      name: "public_projection_final_work_canonical_matches_run_id_signal_hash_public_projection_final_work_canonical_requests_run_id_signal_hash_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [
        table.runId,
        table.signalHash,
        table.publicJobId,
        table.publicJobVersion,
      ],
      name: "public_projection_final_work_canonical_matches_run_id_signal_hash_public_job_id_public_job_version_pk",
    }),
    unique().on(table.runId, table.ordinal),
  ]
);

export const publicProjectionFinalWorkCanonicalMembers = sqliteTable(
  "public_projection_final_work_canonical_members",
  {
    createdAt: text("created_at").notNull(),
    publicMemberKey: text("public_member_key").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionFinalWork.runId, {
        onDelete: "restrict",
      }),
    signalHash: text("signal_hash").notNull(),
  },
  (table) => [
    index("idx_projection_final_canonical_member_page").on(
      table.runId,
      table.publicMemberKey,
      table.signalHash
    ),
    primaryKey({
      columns: [table.runId, table.publicMemberKey, table.signalHash],
      name: "public_projection_final_work_canonical_members_run_id_public_member_key_signal_hash_pk",
    }),
  ]
);

export const publicProjectionFinalWorkPublicRoots = sqliteTable(
  "public_projection_final_work_public_roots",
  {
    allocationHash: text("allocation_hash"),
    allocationInputHash: text("allocation_input_hash").notNull(),
    contentHeadHash: text("content_head_hash").notNull(),
    createdAt: text("created_at").notNull(),
    eligibilityDecisionVersion: integer(
      "eligibility_decision_version"
    ).notNull(),
    encodedBytes: integer("encoded_bytes").notNull(),
    firstPublishedAt: text("first_published_at"),
    foundingSourcePositionId: text("founding_source_position_id"),
    historyHash: text("history_hash").notNull(),
    ordinal: integer().notNull(),
    originatingPublicJobId: text("originating_public_job_id").notNull(),
    publicJobCreatedAt: text("public_job_created_at").notNull(),
    publicJobVersion: integer("public_job_version").notNull(),
    publicMemberKey: text("public_member_key").notNull(),
    redirectPathHash: text("redirect_path_hash").notNull(),
    redirectPathJson: text("redirect_path_json").notNull(),
    redirectRootId: text("redirect_root_id").notNull(),
    rowHash: text("row_hash").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionFinalWork.runId, {
        onDelete: "restrict",
      }),
    servedPublicly: integer("served_publicly").notNull(),
  },
  (table) => [
    index("idx_projection_final_public_root_member_page").on(
      table.runId,
      table.publicMemberKey,
      table.originatingPublicJobId
    ),
    primaryKey({
      columns: [table.runId, table.originatingPublicJobId],
      name: "public_projection_final_work_public_roots_run_id_originating_public_job_id_pk",
    }),
    unique().on(table.runId, table.ordinal),
  ]
);

export const publicProjectionFinalWorkRelations = sqliteTable(
  "public_projection_final_work_relations",
  {
    createdAt: text("created_at").notNull(),
    encodedBytes: integer("encoded_bytes").notNull(),
    id: text().notNull(),
    leftMemberKey: text("left_member_key").notNull(),
    operatorDecisionHash: text("operator_decision_hash"),
    operatorDecisionId: text("operator_decision_id"),
    operatorTerminal: integer("operator_terminal").notNull(),
    ordinal: integer().notNull(),
    payloadJson: text("payload_json").notNull(),
    relation: text().notNull(),
    relationHash: text("relation_hash").notNull(),
    rightMemberKey: text("right_member_key").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => publicProjectionFinalWork.runId, {
        onDelete: "restrict",
      }),
  },
  (table) => [
    index("idx_projection_final_relations_right_component_page").on(
      table.runId,
      table.rightMemberKey,
      table.id
    ),
    index("idx_projection_final_relations_left_component_page").on(
      table.runId,
      table.leftMemberKey,
      table.id
    ),
    index("idx_projection_final_relations_run_id_page").on(
      table.runId,
      table.id
    ),
    index("idx_projection_final_relations_right_page").on(
      table.runId,
      table.relation,
      table.rightMemberKey,
      table.leftMemberKey,
      table.id
    ),
    index("idx_projection_final_relations_left_page").on(
      table.runId,
      table.relation,
      table.leftMemberKey,
      table.rightMemberKey,
      table.id
    ),
    primaryKey({
      columns: [table.runId, table.id],
      name: "public_projection_final_work_relations_run_id_id_pk",
    }),
    unique().on(table.runId, table.leftMemberKey, table.rightMemberKey),
    unique().on(table.runId, table.ordinal),
  ]
);

export const publicProjectionFinalWorkComponentMembers = sqliteTable(
  "public_projection_final_work_component_members",
  {
    createdAt: text("created_at").notNull(),
    encodedBytes: integer("encoded_bytes").notNull(),
    memberHash: text("member_hash").notNull(),
    ordinal: integer().notNull(),
    payloadJson: text("payload_json").notNull(),
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
      name: "public_projection_final_work_component_members_run_id_seed_member_key_public_projection_final_component_work_run_id_seed_member_key_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.seedMemberKey, table.ordinal],
      name: "public_projection_final_work_component_members_run_id_seed_member_key_ordinal_pk",
    }),
    unique().on(table.runId, table.seedMemberKey, table.memberHash),
  ]
);

export const publicProjectionFinalWorkComponentRoots = sqliteTable(
  "public_projection_final_work_component_roots",
  {
    createdAt: text("created_at").notNull(),
    encodedBytes: integer("encoded_bytes").notNull(),
    ordinal: integer().notNull(),
    payloadJson: text("payload_json").notNull(),
    rootHash: text("root_hash").notNull(),
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
      name: "public_projection_final_work_component_roots_run_id_seed_member_key_public_projection_final_component_work_run_id_seed_member_key_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.seedMemberKey, table.ordinal],
      name: "public_projection_final_work_component_roots_run_id_seed_member_key_ordinal_pk",
    }),
  ]
);

export const publicProjectionFinalWorkComponentRelations = sqliteTable(
  "public_projection_final_work_component_relations",
  {
    createdAt: text("created_at").notNull(),
    encodedBytes: integer("encoded_bytes").notNull(),
    ordinal: integer().notNull(),
    relationHash: text("relation_hash").notNull(),
    relationId: text("relation_id").notNull(),
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
      name: "public_projection_final_work_component_relations_run_id_seed_member_key_public_projection_final_component_work_run_id_seed_member_key_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.seedMemberKey, table.ordinal],
      name: "public_projection_final_work_component_relations_run_id_seed_member_key_ordinal_pk",
    }),
    unique().on(table.runId, table.seedMemberKey, table.relationId),
  ]
);

export const publicProjectionFinalWorkPositionUpdates = sqliteTable(
  "public_projection_final_work_position_updates",
  {
    checkpointJson: text("checkpoint_json").notNull(),
    createdAt: text("created_at").notNull(),
    encodedBytes: integer("encoded_bytes").notNull(),
    inputHash: text("input_hash").notNull(),
    ordinal: integer().notNull(),
    positionItemId: text("position_item_id").notNull(),
    rowHash: text("row_hash").notNull(),
    runId: text("run_id").notNull(),
    seedMemberKey: text("seed_member_key").notNull(),
    sourcePositionId: text("source_position_id").notNull(),
  },
  (table) => [
    foreignKey(() => ({
      columns: [table.runId, table.seedMemberKey],
      foreignColumns: [
        publicProjectionFinalComponentWork.runId,
        publicProjectionFinalComponentWork.seedMemberKey,
      ],
      name: "public_projection_final_work_position_updates_run_id_seed_member_key_public_projection_final_component_work_run_id_seed_member_key_fk",
    })).onDelete("restrict"),
    primaryKey({
      columns: [table.runId, table.seedMemberKey, table.ordinal],
      name: "public_projection_final_work_position_updates_run_id_seed_member_key_ordinal_pk",
    }),
    unique().on(table.runId, table.positionItemId),
  ]
);
