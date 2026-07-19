export type OutboundClaimSourceKind =
  | "application_attempt"
  | "campaign_dispatch";

interface OutboundRecipientClaimRow {
  id: string;
  source_id: string;
  source_kind: OutboundClaimSourceKind;
  status: "claimed" | "released" | "sent";
}

export class OutboundRecipientClaimError extends Error {}

export function outboundRecipientDedupKey(
  contactChannelId: string | null | undefined,
  recipient: string
) {
  return contactChannelId
    ? `contact:${contactChannelId}`
    : `email:${recipient.trim().toLowerCase()}`;
}

export async function acquireOutboundRecipientClaim(
  db: D1Database,
  input: {
    dedupKey: string;
    sourceId: string;
    sourceKind: OutboundClaimSourceKind;
    userId: string;
  }
) {
  const timestamp = new Date().toISOString();
  const claim = await db
    .prepare(
      `INSERT INTO outbound_recipient_claims
        (id,user_id,dedup_key,source_kind,source_id,status,claimed_at,
         updated_at)
       VALUES (?,?,?,?,?,'claimed',?,?)
       ON CONFLICT(user_id,dedup_key) DO UPDATE SET
         source_kind=excluded.source_kind,source_id=excluded.source_id,
         status='claimed',lease_expires_at=NULL,claimed_at=excluded.claimed_at,
         sent_at=NULL,released_at=NULL,updated_at=excluded.updated_at
       WHERE outbound_recipient_claims.status='released'
          OR (
            outbound_recipient_claims.source_kind=excluded.source_kind
            AND outbound_recipient_claims.source_id=excluded.source_id
          )
       RETURNING id,source_kind,source_id,status`
    )
    .bind(
      crypto.randomUUID(),
      input.userId,
      input.dedupKey,
      input.sourceKind,
      input.sourceId,
      timestamp,
      timestamp
    )
    .first<OutboundRecipientClaimRow>();
  if (!claim) {
    throw new OutboundRecipientClaimError(
      "This recipient already has an active or sent outreach message"
    );
  }
  return claim;
}

export async function markOutboundRecipientSent(
  db: D1Database,
  sourceKind: OutboundClaimSourceKind,
  sourceId: string,
  sentAt: string
) {
  const result = await outboundRecipientSentStatement(
    db,
    sourceKind,
    sourceId,
    sentAt
  ).run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new OutboundRecipientClaimError(
      "Outbound recipient claim could not be marked sent"
    );
  }
}

export function outboundRecipientSentStatement(
  db: D1Database,
  sourceKind: OutboundClaimSourceKind,
  sourceId: string,
  sentAt: string
) {
  return db
    .prepare(
      `UPDATE outbound_recipient_claims
          SET status='sent',sent_at=?,lease_expires_at=NULL,updated_at=?
        WHERE source_kind=? AND source_id=? AND status='claimed'`
    )
    .bind(sentAt, sentAt, sourceKind, sourceId);
}

export async function releaseOutboundRecipientClaim(
  db: D1Database,
  sourceKind: OutboundClaimSourceKind,
  sourceId: string
) {
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `UPDATE outbound_recipient_claims
          SET status='released',released_at=?,lease_expires_at=NULL,
              updated_at=?
        WHERE source_kind=? AND source_id=? AND status='claimed'`
    )
    .bind(timestamp, timestamp, sourceKind, sourceId)
    .run();
}
