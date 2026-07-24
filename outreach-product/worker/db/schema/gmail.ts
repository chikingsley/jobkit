import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { publicJobs } from "./public-jobs";

export const gmailPubsubEvents = sqliteTable(
  "gmail_pubsub_events",
  {
    emailAddress: text("email_address").notNull(),
    historyId: text("history_id").notNull(),
    messageId: text("message_id").primaryKey(),
    messagesRecorded: integer("messages_recorded").default(0).notNull(),
    processedAt: text("processed_at").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (table) => [
    index("idx_gmail_pubsub_events_processed").on(
      sql`${table.processedAt} desc`
    ),
  ]
);

export const googleIndexingEvents = sqliteTable(
  "google_indexing_events",
  {
    attemptCount: integer("attempt_count").default(0).notNull(),
    canonicalPath: text("canonical_path").notNull(),
    catalogVersion: text("catalog_version").notNull(),
    createdAt: text("created_at").notNull(),
    deliveredAt: text("delivered_at"),
    eventType: text("event_type").notNull(),
    id: text().primaryKey(),
    lastError: text("last_error").default("").notNull(),
    nextAttemptAt: text("next_attempt_at").notNull(),
    publicContentHash: text("public_content_hash").notNull(),
    publicJobId: text("public_job_id")
      .notNull()
      .references(() => publicJobs.id, { onDelete: "restrict" }),
    publicJobVersion: integer("public_job_version").notNull(),
    responseJson: text("response_json").default("{}").notNull(),
    status: text().default("pending").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_google_indexing_events_claim").on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
      table.id
    ),
    unique().on(table.catalogVersion, table.publicJobId, table.eventType),
  ]
);

export const gmailMailboxWatches = sqliteTable(
  "gmail_mailbox_watches",
  {
    createdAt: text("created_at").notNull(),
    emailAddress: text("email_address").notNull(),
    expirationAt: text("expiration_at").notNull(),
    historyId: text("history_id").notNull(),
    lastError: text("last_error").default("").notNull(),
    lastSyncedAt: text("last_synced_at"),
    nextRenewalAttemptAt: text("next_renewal_attempt_at"),
    renewalAuthFailureCount: integer("renewal_auth_failure_count")
      .default(0)
      .notNull(),
    renewalFailureCount: integer("renewal_failure_count").default(0).notNull(),
    status: text().default("active").notNull(),
    updatedAt: text("updated_at").notNull(),
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("idx_gmail_mailbox_watches_expiration").on(
      table.status,
      table.expirationAt
    ),
    unique().on(table.emailAddress),
  ]
);
