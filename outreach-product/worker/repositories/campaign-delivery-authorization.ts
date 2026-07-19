export async function campaignDeliveryEnabled(db: D1Database, userId: string) {
  const enabled = await db
    .prepare(
      `SELECT enabled FROM campaign_delivery_authorizations
        WHERE user_id=? AND authorized_scope='campaigns'`
    )
    .bind(userId)
    .first<number>("enabled");
  return Boolean(enabled);
}
