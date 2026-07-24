import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { agentTaskRequests } from "./agent-tasks";
import { users } from "./auth";
import { jobListings, userListingStates } from "./jobs";
import { userMessageFoundations } from "./message-style";
import { contactChannels } from "./organizations";
import { userDocumentPackets, userDocuments } from "./user-profile";

export const applicationDrafts = sqliteTable(
  "application_drafts",
  {
    applicationBundleId: text("application_bundle_id").references(
      () => applicationBundles.id,
      { onDelete: "set null" }
    ),
    approvedAt: text("approved_at"),
    changeSummary: text("change_summary").default("").notNull(),
    createdAt: text("created_at").notNull(),
    documentPacketId: text("document_packet_id").references(
      () => userDocumentPackets.id,
      { onDelete: "set null" }
    ),
    documentPacketManifestJson: text("document_packet_manifest_json")
      .default("[]")
      .notNull(),
    documentPacketName: text("document_packet_name").default("").notNull(),
    documentPacketSlug: text("document_packet_slug").default("").notNull(),
    id: text().primaryKey(),
    message: text().notNull(),
    messageFoundationId: text("message_foundation_id").references(
      () => userMessageFoundations.id
    ),
    messageTemplateKey: text("message_template_key"),
    modelId: text("model_id"),
    modelProvider: text("model_provider"),
    requiredOpening: text("required_opening").default("Hello,").notNull(),
    revisionInstruction: text("revision_instruction").default("").notNull(),
    revisionSource: text("revision_source").default("generated").notNull(),
    status: text().default("draft").notNull(),
    submittedAt: text("submitted_at"),
    userJobId: text("user_job_id")
      .notNull()
      .references(() => userListingStates.id, { onDelete: "cascade" }),
    version: integer().notNull(),
  },
  (table) => [
    index("idx_application_drafts_bundle_version")
      .on(table.applicationBundleId, sql`${table.version} desc`)
      .where(sql`application_bundle_id IS NOT NULL`),
    index("idx_drafts_user_job_version").on(
      table.userJobId,
      sql`${table.version} desc`
    ),
    unique().on(table.userJobId, table.version),
  ]
);

export const applicationDraftAttachments = sqliteTable(
  "application_draft_attachments",
  {
    category: text().default("").notNull(),
    contentType: text("content_type").notNull(),
    createdAt: text("created_at").notNull(),
    draftId: text("draft_id")
      .notNull()
      .references(() => applicationDrafts.id, { onDelete: "cascade" }),
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
    index("idx_application_draft_attachments_document").on(
      table.sourceDocumentId
    ),
    primaryKey({
      columns: [table.draftId, table.position],
      name: "application_draft_attachments_draft_id_position_pk",
    }),
    unique().on(table.draftId, table.sourceDocumentId),
  ]
);

export const applicationRoutes = sqliteTable(
  "application_routes",
  {
    contactChannelId: text("contact_channel_id").references(
      () => contactChannels.id,
      { onDelete: "set null" }
    ),
    contactPointId: text("contact_point_id"),
    createdAt: text("created_at").notNull(),
    destination: text().notNull(),
    id: text().primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobListings.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    lastVerifiedAt: text("last_verified_at"),
    sourceEvidence: text("source_evidence").default("").notNull(),
    status: text().default("active").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_application_routes_contact_channel").on(
      table.contactChannelId,
      table.status,
      sql`${table.updatedAt} desc`
    ),
    index("idx_application_routes_job_status").on(
      table.jobId,
      table.status,
      table.kind
    ),
    unique().on(table.jobId, table.kind, table.destination),
  ]
);

export const applicationAttempts = sqliteTable(
  "application_attempts",
  {
    applicationBundleId: text("application_bundle_id").references(
      () => applicationBundles.id,
      { onDelete: "set null" }
    ),
    approvedAt: text("approved_at").notNull(),
    channel: text().notNull(),
    claimedAt: text("claimed_at"),
    createdAt: text("created_at").notNull(),
    draftedAt: text("drafted_at"),
    draftId: text("draft_id")
      .notNull()
      .references(() => applicationDrafts.id, { onDelete: "restrict" }),
    errorDetail: text("error_detail").default("").notNull(),
    errorStage: text("error_stage").default("").notNull(),
    gmailDraftId: text("gmail_draft_id").default("").notNull(),
    gmailDraftMessageId: text("gmail_draft_message_id").default("").notNull(),
    gmailMessageId: text("gmail_message_id").default("").notNull(),
    gmailThreadId: text("gmail_thread_id").default("").notNull(),
    id: text().primaryKey(),
    payloadSha256: text("payload_sha256").default("").notNull(),
    recipient: text().notNull(),
    routeId: text("route_id")
      .notNull()
      .references(() => applicationRoutes.id, { onDelete: "restrict" }),
    sendingAt: text("sending_at"),
    sendRequestedAt: text("send_requested_at"),
    sentAt: text("sent_at"),
    status: text().notNull(),
    subject: text().notNull(),
    updatedAt: text("updated_at").notNull(),
    userJobId: text("user_job_id")
      .notNull()
      .references(() => userListingStates.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("idx_application_attempts_bundle_draft")
      .on(table.applicationBundleId, table.draftId)
      .where(sql`application_bundle_id IS NOT NULL`),
    index("idx_application_attempts_send_requests").on(
      table.status,
      table.sendRequestedAt,
      table.updatedAt
    ),
    index("idx_application_attempts_route").on(
      table.routeId,
      sql`${table.createdAt} desc`
    ),
    index("idx_application_attempts_user_job_status").on(
      table.userJobId,
      table.status,
      sql`${table.updatedAt} desc`
    ),
    unique().on(table.userJobId, table.draftId, table.routeId),
  ]
);

export const applicationThreadMessages = sqliteTable(
  "application_thread_messages",
  {
    bodyText: text("body_text").notNull(),
    classification: text().default("human").notNull(),
    createdAt: text("created_at").notNull(),
    direction: text().default("inbound").notNull(),
    fromAddress: text("from_address").notNull(),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id").notNull(),
    id: text().primaryKey(),
    readAt: text("read_at"),
    sentAt: text("sent_at").notNull(),
    subject: text().default("").notNull(),
    toAddress: text("to_address").default("").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_thread_messages_user_thread").on(
      table.userId,
      table.gmailThreadId,
      table.sentAt
    ),
    unique().on(table.userId, table.gmailMessageId),
  ]
);

export const applicationBundles = sqliteTable(
  "application_bundles",
  {
    contactChannelId: text("contact_channel_id")
      .notNull()
      .references(() => contactChannels.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    kind: text().notNull(),
    recipient: text().notNull(),
    sentAt: text("sent_at"),
    status: text().default("review").notNull(),
    subject: text().notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_application_bundles_user_status").on(
      table.userId,
      table.status,
      sql`${table.updatedAt} desc`
    ),
  ]
);

export const applicationBundleTargets = sqliteTable(
  "application_bundle_targets",
  {
    bundleId: text("bundle_id")
      .notNull()
      .references(() => applicationBundles.id, { onDelete: "cascade" }),
    location: text().default("").notNull(),
    ordinal: integer().notNull(),
    routeId: text("route_id")
      .notNull()
      .references(() => applicationRoutes.id, { onDelete: "restrict" }),
    sourceReference: text("source_reference").notNull(),
    title: text().notNull(),
    userJobId: text("user_job_id")
      .notNull()
      .references(() => userListingStates.id, { onDelete: "restrict" }),
  },
  (table) => [
    index("idx_application_bundle_targets_user_job").on(
      table.userJobId,
      table.bundleId
    ),
    primaryKey({
      columns: [table.bundleId, table.userJobId],
      name: "application_bundle_targets_bundle_id_user_job_id_pk",
    }),
    unique().on(table.bundleId, table.ordinal),
  ]
);

export const applicationBundleTestSends = sqliteTable(
  "application_bundle_test_sends",
  {
    bundleId: text("bundle_id")
      .notNull()
      .references(() => applicationBundles.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    draftId: text("draft_id")
      .notNull()
      .references(() => applicationDrafts.id, { onDelete: "restrict" }),
    errorDetail: text("error_detail").default("").notNull(),
    gmailDraftId: text("gmail_draft_id").default("").notNull(),
    gmailMessageId: text("gmail_message_id").default("").notNull(),
    gmailThreadId: text("gmail_thread_id").default("").notNull(),
    id: text().primaryKey(),
    payloadSha256: text("payload_sha256").default("").notNull(),
    recipient: text().notNull(),
    replyReceivedAt: text("reply_received_at"),
    sentAt: text("sent_at"),
    status: text().notNull(),
    subject: text().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_application_bundle_test_sends_bundle").on(
      table.bundleId,
      sql`${table.updatedAt} desc`
    ),
    unique().on(table.bundleId, table.draftId, table.recipient),
  ]
);

export const outboundRecipientClaims = sqliteTable(
  "outbound_recipient_claims",
  {
    claimedAt: text("claimed_at").notNull(),
    dedupKey: text("dedup_key").notNull(),
    id: text().primaryKey(),
    leaseExpiresAt: text("lease_expires_at"),
    releasedAt: text("released_at"),
    sentAt: text("sent_at"),
    sourceId: text("source_id").notNull(),
    sourceKind: text("source_kind").notNull(),
    status: text().notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_outbound_recipient_claims_source").on(
      table.sourceKind,
      table.sourceId,
      table.status
    ),
    unique().on(table.sourceKind, table.sourceId),
    unique().on(table.userId, table.dedupKey),
  ]
);

export const outreachFollowups = sqliteTable(
  "outreach_followups",
  {
    agentTaskRequestId: text("agent_task_request_id").references(
      () => agentTaskRequests.id,
      { onDelete: "set null" }
    ),
    changeSummary: text("change_summary").default("").notNull(),
    createdAt: text("created_at").notNull(),
    delayDays: integer("delay_days").notNull(),
    draftedAt: text("drafted_at"),
    dueAt: text("due_at").notNull(),
    errorDetail: text("error_detail").default("").notNull(),
    gmailDraftId: text("gmail_draft_id").default("").notNull(),
    gmailDraftMessageId: text("gmail_draft_message_id").default("").notNull(),
    gmailMessageId: text("gmail_message_id").default("").notNull(),
    gmailThreadId: text("gmail_thread_id").notNull(),
    id: text().primaryKey(),
    message: text().default("").notNull(),
    modelId: text("model_id"),
    ordinal: integer().notNull(),
    sentAt: text("sent_at"),
    sourceAttemptId: text("source_attempt_id").notNull(),
    sourceKind: text("source_kind").notNull(),
    status: text().default("scheduled").notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_outreach_followups_thread").on(
      table.userId,
      table.gmailThreadId,
      table.ordinal
    ),
    index("idx_outreach_followups_due").on(
      table.status,
      table.dueAt,
      table.createdAt
    ),
    unique().on(table.userId, table.gmailThreadId, table.ordinal),
  ]
);

export const transactionAssertions = sqliteTable("transaction_assertions", {
  mustEqualOne: integer("must_equal_one").notNull(),
});

export const workOutbox = sqliteTable(
  "work_outbox",
  {
    aggregateId: text("aggregate_id").notNull(),
    availableAt: text("available_at").notNull(),
    createdAt: text("created_at").notNull(),
    id: text().primaryKey(),
    publishAttemptCount: integer("publish_attempt_count").default(0).notNull(),
    publishedAt: text("published_at"),
    topic: text().notNull(),
    workItemId: text("work_item_id").default("").notNull(),
  },
  (table) => [unique().on(table.topic, table.aggregateId, table.id)]
);
