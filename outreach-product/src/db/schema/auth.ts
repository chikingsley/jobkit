import {
  index,
  integer,
  numeric,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    createdAt: numeric("created_at").notNull(),
    email: text().notNull(),
    emailVerified: integer("email_verified").notNull(),
    id: text().primaryKey(),
    image: text(),
    name: text().notNull(),
    role: text().default("member").notNull(),
    updatedAt: numeric("updated_at").notNull(),
  },
  (table) => [unique().on(table.email)]
);

export const userSessions = sqliteTable(
  "user_sessions",
  {
    createdAt: numeric("created_at").notNull(),
    expiresAt: numeric("expires_at").notNull(),
    id: text().primaryKey(),
    ipAddress: text("ip_address"),
    token: text().notNull(),
    updatedAt: numeric("updated_at").notNull(),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("user_sessions_user_id_idx").on(table.userId),
    unique().on(table.token),
  ]
);

export const userAccounts = sqliteTable(
  "user_accounts",
  {
    accessToken: text("access_token"),
    accessTokenExpiresAt: numeric("access_token_expires_at"),
    accountId: text("account_id").notNull(),
    createdAt: numeric("created_at").notNull(),
    id: text().primaryKey(),
    idToken: text("id_token"),
    password: text(),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: numeric("refresh_token_expires_at"),
    scope: text(),
    updatedAt: numeric("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("user_accounts_user_id_idx").on(table.userId)]
);

export const authVerifications = sqliteTable(
  "auth_verifications",
  {
    createdAt: numeric("created_at").notNull(),
    expiresAt: numeric("expires_at").notNull(),
    id: text().primaryKey(),
    identifier: text().notNull(),
    updatedAt: numeric("updated_at").notNull(),
    value: text().notNull(),
  },
  (table) => [index("auth_verifications_identifier_idx").on(table.identifier)]
);
