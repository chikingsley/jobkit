import { type ListingItemRow, testEnv } from "./model";

export async function listingItem(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT id,stage,status,attempt_count,checkpoint_json,error_code
       FROM public_projection_listing_items WHERE run_id=? LIMIT 1`
  )
    .bind(runId)
    .first<ListingItemRow>();
  if (!row) {
    throw new Error(`Projection listing item is missing for ${runId}`);
  }
  return row;
}

export async function positionItems(runId: string) {
  const result = await testEnv.DB.prepare(
    `SELECT source_position_id,stage,status,input_hash
       FROM public_projection_position_items
      WHERE run_id=? ORDER BY source_position_id`
  )
    .bind(runId)
    .all<{
      input_hash: string;
      source_position_id: string;
      stage: string;
      status: string;
    }>();
  return result.results;
}

export async function positionItem(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT attempt_count,checkpoint_json,completed_at,error_code,stage,status
       FROM public_projection_position_items WHERE run_id=? LIMIT 1`
  )
    .bind(runId)
    .first<{
      attempt_count: number;
      checkpoint_json: string;
      completed_at: string | null;
      error_code: string;
      stage: string;
      status: string;
    }>();
  if (!row) {
    throw new Error(`Projection position item is missing for ${runId}`);
  }
  return row;
}

export async function positionIdentityCheckpoints(runId: string) {
  const result = await testEnv.DB.prepare(
    `SELECT source_position_id,checkpoint_json
       FROM public_projection_position_items
      WHERE run_id=? ORDER BY source_position_id`
  )
    .bind(runId)
    .all<{ checkpoint_json: string; source_position_id: string }>();
  return result.results.map((row) => {
    const checkpoint = JSON.parse(row.checkpoint_json) as {
      identity: unknown;
    };
    return {
      identity: checkpoint.identity,
      sourcePositionId: row.source_position_id,
    };
  });
}

export async function projectionSourcePositionIds(runId: string) {
  return (await positionItems(runId)).map((item) => item.source_position_id);
}

export async function sourcePositionCounts(listingId: string, runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM job_source_positions WHERE listing_id=?) positions,
      (SELECT COUNT(*) FROM public_projection_position_items WHERE run_id=?)
        projection_items`
  )
    .bind(listingId, runId)
    .first<{ positions: number; projection_items: number }>();
  return {
    positions: row?.positions ?? -1,
    projectionItems: row?.projection_items ?? -1,
  };
}

export async function runStatus(runId: string) {
  const row = await testEnv.DB.prepare(
    "SELECT status FROM public_projection_runs WHERE id=?"
  )
    .bind(runId)
    .first<{ status: string }>();
  return row?.status ?? "missing";
}

export async function runStates(runIds: string[]) {
  const result = await testEnv.DB.prepare(
    `SELECT id,status FROM public_projection_runs
      WHERE id IN (?,?) ORDER BY CASE id WHEN ? THEN 0 ELSE 1 END`
  )
    .bind(runIds[0], runIds[1], runIds[0])
    .all<{ id: string; status: string }>();
  return result.results;
}
