export interface CampaignDeliveryAuthorization {
  authorizedAt: string | null;
  authorizedBy: string;
  enabled: boolean;
  scope: string;
  updatedAt: string;
}

export interface CampaignDeliveryAuthorizationEvent {
  actingUserId: string;
  createdAt: string;
  enabled: boolean;
  id: string;
  reason: string;
  scope: string;
}

export interface CampaignDeliveryAuthorizationWrite {
  actingUserId: string;
  enabled: boolean;
  reason: string;
  scope: "campaigns";
  userId: string;
}

interface AuthorizationRow {
  authorized_at: string | null;
  authorized_by: string;
  authorized_scope: string;
  enabled: number;
  updated_at: string;
}

interface EventRow {
  acting_user_id: string;
  authorized_scope: string;
  created_at: string;
  enabled: number;
  id: string;
  reason: string;
}

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

export async function readCampaignDeliveryAuthorization(
  db: D1Database,
  userId: string
): Promise<CampaignDeliveryAuthorization | null> {
  const row = await db
    .prepare(
      `SELECT enabled,authorized_scope,authorized_at,authorized_by,updated_at
         FROM campaign_delivery_authorizations WHERE user_id=?`
    )
    .bind(userId)
    .first<AuthorizationRow>();
  if (!row) {
    return null;
  }
  return {
    authorizedAt: row.authorized_at,
    authorizedBy: row.authorized_by,
    enabled: Boolean(row.enabled),
    scope: row.authorized_scope,
    updatedAt: row.updated_at,
  };
}

export async function listCampaignDeliveryAuthorizationEvents(
  db: D1Database,
  userId: string
): Promise<CampaignDeliveryAuthorizationEvent[]> {
  const rows = await db
    .prepare(
      `SELECT id,acting_user_id,enabled,authorized_scope,reason,created_at
         FROM campaign_delivery_authorization_events
        WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 200`
    )
    .bind(userId)
    .all<EventRow>();
  return rows.results.map((row) => ({
    actingUserId: row.acting_user_id,
    createdAt: row.created_at,
    enabled: Boolean(row.enabled),
    id: row.id,
    reason: row.reason,
    scope: row.authorized_scope,
  }));
}

export async function writeCampaignDeliveryAuthorization(
  db: D1Database,
  input: CampaignDeliveryAuthorizationWrite
): Promise<CampaignDeliveryAuthorization> {
  const timestamp = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO campaign_delivery_authorizations
          (user_id,enabled,authorized_scope,authorized_at,authorized_by,
           updated_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET
           enabled=excluded.enabled,
           authorized_scope=excluded.authorized_scope,
           authorized_at=excluded.authorized_at,
           authorized_by=excluded.authorized_by,
           updated_at=excluded.updated_at`
      )
      .bind(
        input.userId,
        input.enabled ? 1 : 0,
        input.scope,
        input.enabled ? timestamp : null,
        input.actingUserId,
        timestamp
      ),
    db
      .prepare(
        `INSERT INTO campaign_delivery_authorization_events
          (id,user_id,acting_user_id,enabled,authorized_scope,reason,
           created_at)
         VALUES (?,?,?,?,?,?,?)`
      )
      .bind(
        crypto.randomUUID(),
        input.userId,
        input.actingUserId,
        input.enabled ? 1 : 0,
        input.scope,
        input.reason,
        timestamp
      ),
  ]);
  const authorization = await readCampaignDeliveryAuthorization(
    db,
    input.userId
  );
  if (!authorization) {
    throw new Error("Delivery authorization could not be read back");
  }
  return authorization;
}
