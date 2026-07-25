import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import type { StoredDocument } from "../../src/profile-types";
import { getDb } from "../db/client";
import { userDocuments } from "../db/schema/user-profile";

export function listUserDocuments(
  db: D1Database,
  userId: string,
  scope: "application" | "all" | "test_lab" = "application"
): Promise<StoredDocument[]> {
  const categoryFilter = {
    all: undefined,
    application: ne(userDocuments.category, "test_lab"),
    test_lab: eq(userDocuments.category, "test_lab"),
  }[scope];
  return getDb(db)
    .select({
      category: userDocuments.category,
      content_type: userDocuments.contentType,
      created_at: userDocuments.createdAt,
      filename: userDocuments.filename,
      id: userDocuments.id,
      is_default: userDocuments.isDefault,
      size_bytes: userDocuments.sizeBytes,
    })
    .from(userDocuments)
    .where(
      and(
        eq(userDocuments.userId, userId),
        isNull(userDocuments.archivedAt),
        categoryFilter
      )
    )
    .orderBy(asc(userDocuments.category), desc(userDocuments.createdAt));
}
