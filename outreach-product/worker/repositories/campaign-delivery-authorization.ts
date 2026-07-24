import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  campaignDeliveryAuthorizationEvents,
  campaignDeliveryAuthorizations,
} from "../db/schema/campaigns";

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

export async function campaignDeliveryEnabled(db: D1Database, userId: string) {
  const row = await getDb(db)
    .select({ enabled: campaignDeliveryAuthorizations.enabled })
    .from(campaignDeliveryAuthorizations)
    .where(
      and(
        eq(campaignDeliveryAuthorizations.userId, userId),
        eq(campaignDeliveryAuthorizations.authorizedScope, "campaigns")
      )
    )
    .get();
  return Boolean(row?.enabled);
}

export async function readCampaignDeliveryAuthorization(
  db: D1Database,
  userId: string
): Promise<CampaignDeliveryAuthorization | null> {
  const row = await getDb(db)
    .select({
      authorizedAt: campaignDeliveryAuthorizations.authorizedAt,
      authorizedBy: campaignDeliveryAuthorizations.authorizedBy,
      authorizedScope: campaignDeliveryAuthorizations.authorizedScope,
      enabled: campaignDeliveryAuthorizations.enabled,
      updatedAt: campaignDeliveryAuthorizations.updatedAt,
    })
    .from(campaignDeliveryAuthorizations)
    .where(eq(campaignDeliveryAuthorizations.userId, userId))
    .get();
  if (!row) {
    return null;
  }
  return {
    authorizedAt: row.authorizedAt,
    authorizedBy: row.authorizedBy,
    enabled: Boolean(row.enabled),
    scope: row.authorizedScope,
    updatedAt: row.updatedAt,
  };
}

export async function listCampaignDeliveryAuthorizationEvents(
  db: D1Database,
  userId: string
): Promise<CampaignDeliveryAuthorizationEvent[]> {
  const rows = await getDb(db)
    .select({
      actingUserId: campaignDeliveryAuthorizationEvents.actingUserId,
      authorizedScope: campaignDeliveryAuthorizationEvents.authorizedScope,
      createdAt: campaignDeliveryAuthorizationEvents.createdAt,
      enabled: campaignDeliveryAuthorizationEvents.enabled,
      id: campaignDeliveryAuthorizationEvents.id,
      reason: campaignDeliveryAuthorizationEvents.reason,
    })
    .from(campaignDeliveryAuthorizationEvents)
    .where(eq(campaignDeliveryAuthorizationEvents.userId, userId))
    .orderBy(
      desc(campaignDeliveryAuthorizationEvents.createdAt),
      desc(campaignDeliveryAuthorizationEvents.id)
    )
    .limit(200);
  return rows.map((row) => ({
    actingUserId: row.actingUserId,
    createdAt: row.createdAt,
    enabled: Boolean(row.enabled),
    id: row.id,
    reason: row.reason,
    scope: row.authorizedScope,
  }));
}

// Ordered two-statement D1 batch (authorization upsert plus audit event);
// batch atomicity depends on statement ordering, so it stays raw SQL.
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
