export async function claimLegacyData(
  db: D1Database,
  userId: string
): Promise<void> {
  const claim = await db
    .prepare("SELECT claimed_by FROM legacy_data_claims WHERE id=1")
    .first<{ claimed_by: string | null }>();
  if (!claim || (claim.claimed_by && claim.claimed_by !== userId)) {
    return;
  }

  if (claim.claimed_by === userId) {
    await assignLegacyRows(db, userId);
    return;
  }

  const firstUser = await db
    .prepare("SELECT id FROM users ORDER BY created_at,id LIMIT 1")
    .first<{ id: string }>();
  if (firstUser?.id !== userId) {
    return;
  }

  const claimed = await db
    .prepare(
      "UPDATE legacy_data_claims SET claimed_by=?,claimed_at=? WHERE id=1 AND claimed_by IS NULL RETURNING claimed_by"
    )
    .bind(userId, new Date().toISOString())
    .first<{ claimed_by: string }>();
  if (claimed?.claimed_by === userId) {
    await assignLegacyRows(db, userId);
  }
}

async function assignLegacyRows(db: D1Database, userId: string) {
  await db.batch([
    db
      .prepare("UPDATE user_profiles SET user_id=? WHERE user_id IS NULL")
      .bind(userId),
    db
      .prepare("UPDATE user_preferences SET user_id=? WHERE user_id IS NULL")
      .bind(userId),
    db
      .prepare("UPDATE user_documents SET user_id=? WHERE user_id IS NULL")
      .bind(userId),
    db
      .prepare("UPDATE user_jobs SET user_id=? WHERE user_id IS NULL")
      .bind(userId),
  ]);
}
