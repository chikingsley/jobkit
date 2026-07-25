import type { FinalDuplicateSeal, SealRow } from "./model";

export async function readFinalDuplicateSeal(
  db: D1Database,
  runId: string
): Promise<FinalDuplicateSeal | null> {
  const row = await db
    .prepare(
      `SELECT * FROM public_projection_final_duplicate_seals
        WHERE run_id=? LIMIT 1`
    )
    .bind(runId)
    .first<SealRow>();
  return row ? sealFromRow(row) : null;
}

export function sealFromRow(row: SealRow): FinalDuplicateSeal {
  return {
    allocationCount: row.allocation_count,
    allocationDigest: row.allocation_digest,
    blockedAllocationCount: row.blocked_allocation_count,
    blockedResolutionCount: row.blocked_resolution_count,
    canonicalLiveInputCount: row.canonical_live_input_count,
    canonicalLiveInputDigest: row.canonical_live_input_digest,
    createdAt: row.created_at,
    duplicateBatchInputHash: row.duplicate_batch_input_hash,
    promotableCount: row.promotable_count,
    relationCount: row.relation_count,
    relationDigest: row.relation_digest,
    resolutionCount: row.resolution_count,
    resolutionDigest: row.resolution_digest,
    resolvedPositionCount: row.resolved_position_count,
    runId: row.run_id,
    sealHash: row.seal_hash,
    sourceMappingInputCount: row.source_mapping_input_count,
    sourceMappingInputDigest: row.source_mapping_input_digest,
  };
}
