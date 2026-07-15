import type { JobImport } from "../schemas";

export async function upsertApplicationRoutes(
  db: D1Database,
  job: JobImport,
  timestamp: string
): Promise<string[]> {
  const routeIds: string[] = [];
  const destination = job.applyEmail.trim().toLowerCase();
  if (destination) {
    routeIds.push(await upsertRoute(db, job, timestamp, "email", destination));
  }
  if (job.board === "seriousteachers") {
    routeIds.push(
      await upsertRoute(db, job, timestamp, "board_form", job.applyUrl)
    );
  }
  return routeIds;
}

async function upsertRoute(
  db: D1Database,
  job: JobImport,
  timestamp: string,
  kind: "board_form" | "email",
  destination: string
): Promise<string> {
  const row = await db
    .prepare(
      `INSERT INTO application_routes
        (id,job_id,kind,destination,source_evidence,last_verified_at,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,'active',?,?)
       ON CONFLICT(job_id,kind,destination) DO UPDATE SET
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
