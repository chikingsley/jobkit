import { and, eq, sql } from "drizzle-orm";
import { excluded, getDb } from "../db/client";
import { outboundRecipientClaims } from "../db/schema/applications";

export type OutboundClaimSourceKind =
  | "application_attempt"
  | "campaign_dispatch";

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
  const claim = await getDb(db)
    .insert(outboundRecipientClaims)
    .values({
      claimedAt: timestamp,
      dedupKey: input.dedupKey,
      id: crypto.randomUUID(),
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
      status: "claimed",
      updatedAt: timestamp,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: {
        claimedAt: excluded(outboundRecipientClaims.claimedAt),
        leaseExpiresAt: null,
        releasedAt: null,
        sentAt: null,
        sourceId: excluded(outboundRecipientClaims.sourceId),
        sourceKind: excluded(outboundRecipientClaims.sourceKind),
        status: "claimed",
        updatedAt: excluded(outboundRecipientClaims.updatedAt),
      },
      setWhere: sql`${outboundRecipientClaims.status}='released'
          OR (
            ${outboundRecipientClaims.sourceKind}=excluded.source_kind
            AND ${outboundRecipientClaims.sourceId}=excluded.source_id
          )`,
      target: [
        outboundRecipientClaims.userId,
        outboundRecipientClaims.dedupKey,
      ],
    })
    .returning({
      id: outboundRecipientClaims.id,
      source_id: outboundRecipientClaims.sourceId,
      source_kind: outboundRecipientClaims.sourceKind,
      status: outboundRecipientClaims.status,
    })
    .get();
  if (!claim) {
    throw new OutboundRecipientClaimError(
      "This recipient already has an active or sent outreach message"
    );
  }
  return claim as {
    id: string;
    source_id: string;
    source_kind: OutboundClaimSourceKind;
    status: "claimed" | "released" | "sent";
  };
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

// Statement builder used inside multi-statement D1 batches; batch atomicity
// depends on prepared-statement ordering, so it stays raw SQL.
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
  await getDb(db)
    .update(outboundRecipientClaims)
    .set({
      leaseExpiresAt: null,
      releasedAt: timestamp,
      status: "released",
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(outboundRecipientClaims.sourceKind, sourceKind),
        eq(outboundRecipientClaims.sourceId, sourceId),
        eq(outboundRecipientClaims.status, "claimed")
      )
    )
    .run();
}
