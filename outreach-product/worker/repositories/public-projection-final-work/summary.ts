export async function readFinalComponentSummary(db: D1Database, runId: string) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) component_count,
              COALESCE(SUM(allocation_state='promotable'),0) promotable_count,
              COALESCE(SUM(allocation_state='blocked'),0) blocked_count
         FROM public_projection_final_component_work
        WHERE run_id=? AND state='sealed'`
    )
    .bind(runId)
    .first<{
      blocked_count: number;
      component_count: number;
      promotable_count: number;
    }>();
  if (!row) {
    throw new Error("The durable final component summary is unavailable");
  }
  return {
    blockedCount: row.blocked_count,
    componentCount: row.component_count,
    promotableCount: row.promotable_count,
  };
}
