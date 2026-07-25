import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import {
  applicationAttempts,
  applicationBundles,
  applicationRoutes,
} from "./applications";
import { users } from "./auth";
import { countrySweeps } from "./country-sweeps";
import { jobListings } from "./jobs";
import {
  contactChannels,
  organizationContactPoints,
  organizations,
} from "./organizations";
import { userDocumentPackets, userDocuments } from "./user-profile";

export const campaigns = sqliteTable(
  "campaigns",
  {
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    dailyPace: integer("daily_pace").notNull(),
    firstFiveCompletedAt: text("first_five_completed_at"),
    firstFiveRequired: integer("first_five_required").default(1).notNull(),
    humanReplyCount: integer("human_reply_count").default(0).notNull(),
    id: text().primaryKey(),
    name: text().notNull(),
    nextRunAt: text("next_run_at"),
    pauseReason: text("pause_reason").default("").notNull(),
    policySnapshotJson: text("policy_snapshot_json").notNull(),
    postedTargetPercent: integer("posted_target_percent").notNull(),
    startedAt: text("started_at"),
    status: text().default("draft").notNull(),
    stopAfterHumanReplies: integer("stop_after_human_replies").notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_campaigns_user_status").on(
      table.userId,
      table.status,
      sql`${table.updatedAt} desc`
    ),
  ]
);

export const campaignMarkets = sqliteTable(
  "campaign_markets",
  {
    addedAt: text("added_at").notNull(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    countryCode: text("country_code").notNull(),
    countryName: text("country_name").notNull(),
    sweepId: text("sweep_id").references(() => countrySweeps.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_campaign_markets_country").on(
      table.countryCode,
      table.campaignId
    ),
    primaryKey({
      columns: [table.campaignId, table.countryCode],
      name: "campaign_markets_campaign_id_country_code_pk",
    }),
  ]
);

export const campaignTargets = sqliteTable(
  "campaign_targets",
  {
    admittedAt: text("admitted_at").notNull(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    channel: text().notNull(),
    contactChannelId: text("contact_channel_id").references(
      () => contactChannels.id,
      { onDelete: "set null" }
    ),
    contactPointId: text("contact_point_id").references(
      () => organizationContactPoints.id,
      { onDelete: "set null" }
    ),
    countryCode: text("country_code").notNull(),
    dedupKey: text("dedup_key").notNull(),
    holdReason: text("hold_reason").default("").notNull(),
    id: text().primaryKey(),
    jobId: text("job_id").references(() => jobListings.id, {
      onDelete: "cascade",
    }),
    matchLabel: text("match_label").default("").notNull(),
    matchScore: integer("match_score"),
    matchSnapshotJson: text("match_snapshot_json").default("{}").notNull(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    routeId: text("route_id").references(() => applicationRoutes.id, {
      onDelete: "set null",
    }),
    routeStrategy: text("route_strategy").default("single").notNull(),
    sourceKind: text("source_kind").notNull(),
    status: text().default("eligible").notNull(),
    subjectId: text("subject_id").notNull(),
    subjectKind: text("subject_kind").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_campaign_targets_campaign_dedup").on(
      table.campaignId,
      table.dedupKey,
      table.routeStrategy
    ),
    index("idx_campaign_targets_campaign_status").on(
      table.campaignId,
      table.status,
      table.sourceKind,
      table.admittedAt
    ),
    unique().on(table.campaignId, table.subjectKind, table.subjectId),
  ]
);

export const campaignRuns = sqliteTable(
  "campaign_runs",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    dailyPace: integer("daily_pace").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    id: text().primaryKey(),
    plannedDispatchCount: integer("planned_dispatch_count")
      .default(0)
      .notNull(),
    postedTargetPercent: integer("posted_target_percent").notNull(),
    scheduledFor: text("scheduled_for").notNull(),
    sentDispatchCount: integer("sent_dispatch_count").default(0).notNull(),
    status: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_campaign_runs_campaign").on(
      table.campaignId,
      sql`${table.scheduledFor} desc`
    ),
    unique().on(table.campaignId, table.scheduledFor),
  ]
);

export const campaignDispatches = sqliteTable(
  "campaign_dispatches",
  {
    applicationAttemptId: text("application_attempt_id").references(
      () => applicationAttempts.id,
      { onDelete: "set null" }
    ),
    applicationBundleId: text("application_bundle_id").references(
      () => applicationBundles.id,
      { onDelete: "set null" }
    ),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    channel: text().notNull(),
    createdAt: text("created_at").notNull(),
    dedupKey: text("dedup_key").notNull(),
    documentPacketId: text("document_packet_id").references(
      () => userDocumentPackets.id,
      { onDelete: "set null" }
    ),
    documentPacketManifestJson: text("document_packet_manifest_json")
      .default("[]")
      .notNull(),
    documentPacketName: text("document_packet_name").default("").notNull(),
    documentPacketSlug: text("document_packet_slug").default("").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    id: text().primaryKey(),
    recipient: text().default("").notNull(),
    routeStrategy: text("route_strategy").notNull(),
    runId: text("run_id").references(() => campaignRuns.id, {
      onDelete: "set null",
    }),
    scheduledFor: text("scheduled_for"),
    status: text().notNull(),
    subject: text().default("").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_campaign_dispatches_due").on(
      table.campaignId,
      table.status,
      table.scheduledFor,
      table.createdAt
    ),
    unique().on(table.campaignId, table.dedupKey),
  ]
);

export const campaignDispatchTargets = sqliteTable(
  "campaign_dispatch_targets",
  {
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => campaignDispatches.id, { onDelete: "cascade" }),
    ordinal: integer().notNull(),
    targetId: text("target_id")
      .notNull()
      .references(() => campaignTargets.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.dispatchId, table.targetId],
      name: "campaign_dispatch_targets_dispatch_id_target_id_pk",
    }),
    unique().on(table.targetId),
    unique().on(table.dispatchId, table.ordinal),
  ]
);

export const campaignMessages = sqliteTable(
  "campaign_messages",
  {
    approvedAt: text("approved_at"),
    changeSummary: text("change_summary").default("").notNull(),
    createdAt: text("created_at").notNull(),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => campaignDispatches.id, { onDelete: "cascade" }),
    id: text().primaryKey(),
    message: text().notNull(),
    modelId: text("model_id"),
    revisionInstruction: text("revision_instruction").default("").notNull(),
    revisionSource: text("revision_source").notNull(),
    status: text().default("draft").notNull(),
    version: integer().notNull(),
  },
  (table) => [
    index("idx_campaign_messages_current").on(
      table.dispatchId,
      table.status,
      sql`${table.version} desc`
    ),
    unique().on(table.dispatchId, table.version),
  ]
);

export const campaignDispatchAttachments = sqliteTable(
  "campaign_dispatch_attachments",
  {
    category: text().notNull(),
    contentType: text("content_type").notNull(),
    createdAt: text("created_at").notNull(),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => campaignDispatches.id, { onDelete: "cascade" }),
    etag: text().notNull(),
    filename: text().notNull(),
    objectKey: text("object_key").notNull(),
    position: integer().notNull(),
    r2Version: text("r2_version").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => userDocuments.id, { onDelete: "restrict" }),
  },
  (table) => [
    index("idx_campaign_dispatch_attachments_document").on(
      table.sourceDocumentId
    ),
    primaryKey({
      columns: [table.dispatchId, table.position],
      name: "campaign_dispatch_attachments_dispatch_id_position_pk",
    }),
    unique().on(table.dispatchId, table.sourceDocumentId),
  ]
);

export const campaignGuidance = sqliteTable(
  "campaign_guidance",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    decidedAt: text("decided_at"),
    id: text().primaryKey(),
    instruction: text().notNull(),
    scope: text().notNull(),
    sourceDispatchId: text("source_dispatch_id").references(
      () => campaignDispatches.id,
      { onDelete: "set null" }
    ),
    status: text().default("proposed").notNull(),
  },
  (table) => [
    index("idx_campaign_guidance_campaign").on(
      table.campaignId,
      table.status,
      table.createdAt
    ),
  ]
);

export const campaignEmailAttempts = sqliteTable(
  "campaign_email_attempts",
  {
    approvedAt: text("approved_at").notNull(),
    claimedAt: text("claimed_at"),
    createdAt: text("created_at").notNull(),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => campaignDispatches.id, { onDelete: "cascade" }),
    draftedAt: text("drafted_at"),
    errorDetail: text("error_detail").default("").notNull(),
    errorStage: text("error_stage").default("").notNull(),
    gmailDraftId: text("gmail_draft_id").default("").notNull(),
    gmailDraftMessageId: text("gmail_draft_message_id").default("").notNull(),
    gmailMessageId: text("gmail_message_id").default("").notNull(),
    gmailThreadId: text("gmail_thread_id").default("").notNull(),
    id: text().primaryKey(),
    payloadSha256: text("payload_sha256").default("").notNull(),
    recipient: text().notNull(),
    sendingAt: text("sending_at"),
    sentAt: text("sent_at"),
    status: text().notNull(),
    subject: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_campaign_email_attempts_status").on(
      table.status,
      table.updatedAt
    ),
    unique().on(table.dispatchId),
  ]
);

export const campaignDeliveryAuthorizations = sqliteTable(
  "campaign_delivery_authorizations",
  {
    authorizedAt: text("authorized_at"),
    authorizedBy: text("authorized_by").default("").notNull(),
    authorizedScope: text("authorized_scope").default("none").notNull(),
    enabled: integer().default(0).notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
  }
);

export const campaignReplyEvents = sqliteTable(
  "campaign_reply_events",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    classification: text().notNull(),
    countsTowardPause: integer("counts_toward_pause").notNull(),
    createdAt: text("created_at").notNull(),
    dispatchId: text("dispatch_id").references(() => campaignDispatches.id, {
      onDelete: "set null",
    }),
    evidenceJson: text("evidence_json").default("{}").notNull(),
    gmailMessageId: text("gmail_message_id").default("").notNull(),
    gmailThreadId: text("gmail_thread_id").default("").notNull(),
    id: text().primaryKey(),
    receivedAt: text("received_at").notNull(),
  },
  (table) => [
    index("idx_campaign_reply_events_campaign").on(
      table.campaignId,
      sql`${table.receivedAt} desc`
    ),
    unique().on(table.campaignId, table.gmailMessageId),
  ]
);

export const campaignTargetEvents = sqliteTable(
  "campaign_target_events",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    nextStatus: text("next_status").notNull(),
    previousStatus: text("previous_status").notNull(),
    reason: text().default("").notNull(),
    targetId: text("target_id")
      .notNull()
      .references(() => campaignTargets.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_campaign_target_events_v2_campaign").on(
      table.campaignId,
      sql`${table.createdAt} desc`
    ),
    index("idx_campaign_target_events_v2_target").on(
      table.targetId,
      sql`${table.createdAt} desc`
    ),
  ]
);

export const campaignDeliveryAuthorizationEvents = sqliteTable(
  "campaign_delivery_authorization_events",
  {
    actingUserId: text("acting_user_id").notNull(),
    authorizedScope: text("authorized_scope").notNull(),
    createdAt: text("created_at").notNull(),
    enabled: integer().notNull(),
    id: text().primaryKey(),
    reason: text().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_campaign_delivery_authorization_events_user").on(
      table.userId,
      sql`${table.createdAt} desc`
    ),
  ]
);
