import type { AgentTaskCompletionFence } from "../services/agent-tasks/run-store";

// Statement builder used inside multi-statement D1 batches (optionally behind
// a completion-fence clause); batch atomicity depends on prepared-statement
// ordering, so it stays raw SQL.
export function jobEventStatement(
  db: D1Database,
  userJobId: string,
  type: string,
  detail: string,
  draftId?: string,
  metadata: Record<string, unknown> = {},
  fence?: AgentTaskCompletionFence
) {
  if (fence) {
    return db
      .prepare(
        `INSERT INTO job_events
          (id,user_job_id,event_type,draft_id,detail,metadata_json,created_at)
         SELECT ?,?,?,?,?,?,? WHERE ${fence.clause}`
      )
      .bind(
        crypto.randomUUID(),
        userJobId,
        type,
        draftId ?? null,
        detail,
        JSON.stringify(metadata),
        new Date().toISOString(),
        ...fence.values
      );
  }
  return db
    .prepare(
      "INSERT INTO job_events (id,user_job_id,event_type,draft_id,detail,metadata_json,created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .bind(
      crypto.randomUUID(),
      userJobId,
      type,
      draftId ?? null,
      detail,
      JSON.stringify(metadata),
      new Date().toISOString()
    );
}

export async function recordJobEvent(
  db: D1Database,
  userJobId: string,
  type: string,
  detail: string,
  draftId?: string
) {
  await jobEventStatement(db, userJobId, type, detail, draftId).run();
}
