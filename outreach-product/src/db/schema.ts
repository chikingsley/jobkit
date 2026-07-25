import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const jobListings = sqliteTable(
  "job_listings",
  {
    applyUrl: text("apply_url").notNull(),
    board: text("board").notNull(),
    company: text("company").notNull().default(""),
    country: text("country").notNull().default(""),
    description: text("description").notNull().default(""),
    firstSeenAt: text("first_seen_at").notNull(),
    id: text("id").primaryKey(),
    inventoryStatus: text("inventory_status").notNull().default("active"),
    location: text("location").notNull().default(""),
    title: text("title").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("job_listings_board_status").on(table.board, table.inventoryStatus),
  ]
);

export const jobMatchFacts = sqliteTable("job_match_facts", {
  factsJson: text("facts_json").notNull(),
  jobId: text("job_id").primaryKey(),
  schemaVersion: integer("schema_version").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const applicationRoutes = sqliteTable(
  "application_routes",
  {
    createdAt: text("created_at").notNull(),
    destination: text("destination").notNull(),
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("active"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("application_routes_job").on(table.jobId, table.status)]
);
