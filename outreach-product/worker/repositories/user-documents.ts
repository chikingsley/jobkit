import type { StoredDocument } from "../../src/profile-types";

export async function listUserDocuments(
  db: D1Database,
  userId: string,
  scope: "application" | "all" | "test_lab" = "application"
): Promise<StoredDocument[]> {
  const categoryFilter = {
    all: "",
    application: "AND category<>'test_lab'",
    test_lab: "AND category='test_lab'",
  }[scope];
  const rows = await db
    .prepare(
      `SELECT id,category,filename,content_type,size_bytes,is_default,created_at
         FROM user_documents
        WHERE user_id=? AND archived_at IS NULL ${categoryFilter}
        ORDER BY category,created_at DESC`
    )
    .bind(userId)
    .all<StoredDocument>();
  return rows.results;
}
