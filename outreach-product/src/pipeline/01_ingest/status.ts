export async function listInventoryStatus(db: D1Database, userId: string) {
  const [sources, runs, refreshes] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT source.id,source.name,source.completeness_policy,source.status,
              source.refresh_interval_minutes,
              next_refresh_at,last_started_at,last_completed_at,last_success_at,
              last_error,source.updated_at,
              EXISTS (
                SELECT 1 FROM inventory_source_operators operator
                 WHERE operator.source_id=source.id AND operator.user_id=?
              ) can_operate
         FROM inventory_sources source
        ORDER BY source.name,source.id`
      )
      .bind(userId),
    db.prepare(
      `SELECT id,source_id,snapshot_key,status,source_total_count,
              source_active_count,source_closed_count,processed_count,
              upserted_count,unchanged_count,closed_count,failed_count,
              error_detail,started_at,completed_at,updated_at
         FROM inventory_runs
        ORDER BY started_at DESC LIMIT 20`
    ),
    db.prepare(
      `SELECT id,source_id,mode,boards_json,status,inventory_run_id,error_detail,
              requested_at,claimed_at,started_at,completed_at,updated_at
         FROM inventory_refresh_requests
        ORDER BY requested_at DESC LIMIT 20`
    ),
  ]);
  return {
    refreshes: (refreshes?.results ?? []).map((row) => ({
      boards: JSON.parse(String(row.boards_json)) as unknown,
      claimedAt: nullableString(row.claimed_at),
      completedAt: nullableString(row.completed_at),
      error: String(row.error_detail),
      id: String(row.id),
      inventoryRunId: nullableString(row.inventory_run_id),
      mode: String(row.mode),
      requestedAt: String(row.requested_at),
      sourceId: String(row.source_id),
      startedAt: nullableString(row.started_at),
      status: String(row.status),
      updatedAt: String(row.updated_at),
    })),
    runs: (runs?.results ?? []).map((row) => ({
      closedCount: Number(row.closed_count),
      completedAt: nullableString(row.completed_at),
      error: String(row.error_detail),
      failedCount: Number(row.failed_count),
      id: String(row.id),
      processedCount: Number(row.processed_count),
      snapshotKey: String(row.snapshot_key),
      sourceActiveCount: Number(row.source_active_count),
      sourceClosedCount: Number(row.source_closed_count),
      sourceId: String(row.source_id),
      sourceTotalCount: Number(row.source_total_count),
      startedAt: String(row.started_at),
      status: String(row.status),
      unchangedCount: Number(row.unchanged_count),
      updatedAt: String(row.updated_at),
      upsertedCount: Number(row.upserted_count),
    })),
    sources: (sources?.results ?? []).map((row) => ({
      canOperate: Number(row.can_operate) === 1,
      completenessPolicy: String(row.completeness_policy),
      id: String(row.id),
      lastCompletedAt: nullableString(row.last_completed_at),
      lastError: String(row.last_error),
      lastStartedAt: nullableString(row.last_started_at),
      lastSuccessAt: nullableString(row.last_success_at),
      name: String(row.name),
      nextRefreshAt: nullableString(row.next_refresh_at),
      refreshIntervalMinutes:
        row.refresh_interval_minutes === null
          ? null
          : Number(row.refresh_interval_minutes),
      status: String(row.status),
      updatedAt: String(row.updated_at),
    })),
  };
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}
