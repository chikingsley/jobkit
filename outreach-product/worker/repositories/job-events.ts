export function jobEventStatement(
  db: D1Database,
  jobId: string,
  type: string,
  detail: string,
  draftId?: string
) {
  return db
    .prepare(
      "INSERT INTO job_events (id,job_id,event_type,draft_id,detail,created_at) VALUES (?,?,?,?,?,?)"
    )
    .bind(
      crypto.randomUUID(),
      jobId,
      type,
      draftId ?? null,
      detail,
      new Date().toISOString()
    );
}

export async function recordJobEvent(
  db: D1Database,
  jobId: string,
  type: string,
  detail: string,
  draftId?: string
) {
  await jobEventStatement(db, jobId, type, detail, draftId).run();
}
