import { and, eq } from "drizzle-orm";
import { excluded, getDb } from "../db/client";
import { applicationRoutes } from "../db/schema/applications";
import { contactChannels } from "../db/schema/organizations";
import type { JobImport } from "../schemas";

export async function upsertApplicationRoutes(
  db: D1Database,
  job: JobImport,
  timestamp: string
): Promise<string[]> {
  const routeIds: string[] = [];
  const destination = job.applyEmail.trim().toLowerCase();
  if (destination) {
    const contactChannelId = await upsertEmailContactChannel(
      db,
      job,
      destination,
      timestamp
    );
    routeIds.push(
      await upsertRoute(
        db,
        job,
        timestamp,
        "email",
        destination,
        contactChannelId
      )
    );
    await refreshContactMetadata(db, contactChannelId, timestamp);
  }
  if (job.applyUrl.trim()) {
    routeIds.push(
      await upsertRoute(
        db,
        job,
        timestamp,
        routeKind(job.board),
        job.applyUrl,
        null
      )
    );
  }
  return routeIds;
}

function routeKind(
  board: string
): "board_form" | "external_url" | "login_gated_form" {
  if (board === "seriousteachers") {
    return "board_form";
  }
  return board === "tefl" ? "login_gated_form" : "external_url";
}

async function findEmailChannel(db: D1Database, destination: string) {
  return await getDb(db)
    .select({ id: contactChannels.id })
    .from(contactChannels)
    .where(
      and(
        eq(contactChannels.kind, "email"),
        eq(contactChannels.normalizedValue, destination)
      )
    )
    .get();
}

async function upsertEmailContactChannel(
  db: D1Database,
  job: JobImport,
  destination: string,
  timestamp: string
): Promise<string> {
  const existing = await findEmailChannel(db, destination);
  if (existing) {
    await getDb(db)
      .update(contactChannels)
      .set({ status: "active", updatedAt: timestamp, value: destination })
      .where(eq(contactChannels.id, existing.id))
      .run();
    return existing.id;
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(destination)
  );
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const contactId = `contact:email:sha256:${fingerprint}`;
  const channelId = `contact-channel:email:sha256:${fingerprint}`;
  const role =
    job.board === "anesl" && destination === "hr@anesl.com"
      ? "board_intermediary"
      : "unknown";

  await db.batch([
    db
      .prepare(
        `INSERT INTO contacts
        (id,display_name,organization_name,role,status,created_at,updated_at)
       VALUES (?,?,?,?, 'active',?,?)
       ON CONFLICT(id) DO UPDATE SET
         role=CASE
           WHEN contacts.role='unknown' THEN excluded.role
           ELSE contacts.role
         END,
         status='active',
         updated_at=excluded.updated_at`
      )
      .bind(
        contactId,
        job.contactName.trim(),
        job.company.trim(),
        role,
        timestamp,
        timestamp
      ),
    db
      .prepare(
        `INSERT INTO contact_channels
        (id,contact_id,kind,value,normalized_value,status,created_at,updated_at)
       VALUES (?,?,'email',?,?,'active',?,?)
       ON CONFLICT(kind,normalized_value) DO UPDATE SET
         value=excluded.value,
         status='active',
         updated_at=excluded.updated_at`
      )
      .bind(
        channelId,
        contactId,
        destination,
        destination,
        timestamp,
        timestamp
      ),
  ]);
  const channel = await findEmailChannel(db, destination);
  if (!channel) {
    throw new Error("Canonical email contact could not be saved");
  }
  return channel.id;
}

async function refreshContactMetadata(
  db: D1Database,
  contactChannelId: string,
  timestamp: string
) {
  await db
    .prepare(
      `UPDATE contacts
       SET
         display_name=COALESCE((
           SELECT CASE
             WHEN COUNT(DISTINCT NULLIF(trim(j.contact_name),''))=1
             THEN MAX(NULLIF(trim(j.contact_name),''))
             ELSE ''
           END
           FROM contact_channels related_cc
           JOIN application_routes ar ON ar.contact_channel_id=related_cc.id
           JOIN job_listings j ON j.id=ar.job_id
           WHERE related_cc.contact_id=contacts.id
         ),''),
         organization_name=COALESCE((
           SELECT CASE
             WHEN COUNT(DISTINCT NULLIF(trim(j.company),''))=1
             THEN MAX(NULLIF(trim(j.company),''))
             ELSE ''
           END
           FROM contact_channels related_cc
           JOIN application_routes ar ON ar.contact_channel_id=related_cc.id
           JOIN job_listings j ON j.id=ar.job_id
           WHERE related_cc.contact_id=contacts.id
         ),''),
         updated_at=?
       WHERE id=(
         SELECT contact_id FROM contact_channels WHERE id=?
       )`
    )
    .bind(timestamp, contactChannelId)
    .run();
}

async function upsertRoute(
  db: D1Database,
  job: JobImport,
  timestamp: string,
  kind: "board_form" | "email" | "external_url" | "login_gated_form",
  destination: string,
  contactChannelId: string | null
): Promise<string> {
  const row = await getDb(db)
    .insert(applicationRoutes)
    .values({
      contactChannelId,
      createdAt: timestamp,
      destination,
      id: crypto.randomUUID(),
      jobId: job.id,
      kind,
      lastVerifiedAt: timestamp,
      sourceEvidence: job.sourceUrl,
      status: "active",
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      set: {
        contactChannelId: excluded(applicationRoutes.contactChannelId),
        lastVerifiedAt: excluded(applicationRoutes.lastVerifiedAt),
        sourceEvidence: excluded(applicationRoutes.sourceEvidence),
        status: "active",
        updatedAt: excluded(applicationRoutes.updatedAt),
      },
      target: [
        applicationRoutes.jobId,
        applicationRoutes.kind,
        applicationRoutes.destination,
      ],
    })
    .returning({ id: applicationRoutes.id })
    .get();
  if (!row) {
    throw new Error("Application route could not be saved");
  }
  return row.id;
}
