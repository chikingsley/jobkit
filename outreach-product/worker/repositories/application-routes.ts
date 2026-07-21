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

async function upsertEmailContactChannel(
  db: D1Database,
  job: JobImport,
  destination: string,
  timestamp: string
): Promise<string> {
  const existing = await db
    .prepare(
      `SELECT id FROM contact_channels
       WHERE kind='email' AND normalized_value=?`
    )
    .bind(destination)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare(
        `UPDATE contact_channels
         SET value=?,status='active',updated_at=?
         WHERE id=?`
      )
      .bind(destination, timestamp, existing.id)
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
  const channel = await db
    .prepare(
      `SELECT id FROM contact_channels
       WHERE kind='email' AND normalized_value=?`
    )
    .bind(destination)
    .first<{ id: string }>();
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
  const row = await db
    .prepare(
      `INSERT INTO application_routes
        (id,job_id,kind,destination,contact_channel_id,source_evidence,
         last_verified_at,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,'active',?,?)
       ON CONFLICT(job_id,kind,destination) DO UPDATE SET
         contact_channel_id=excluded.contact_channel_id,
         source_evidence=excluded.source_evidence,
         last_verified_at=excluded.last_verified_at,
         status='active',
         updated_at=excluded.updated_at
       RETURNING id`
    )
    .bind(
      crypto.randomUUID(),
      job.id,
      kind,
      destination,
      contactChannelId,
      job.sourceUrl,
      timestamp,
      timestamp,
      timestamp
    )
    .first<{ id: string }>();
  if (!row) {
    throw new Error("Application route could not be saved");
  }
  return row.id;
}
