import { PublicProjectionScopeSchema } from "../contracts";
import {
  publicProjectionPolicyHeadsHash,
  publicProjectionSourceWatermark,
} from "../snapshots";
import type { ActiveRunRow, RunCompletionRow } from "./model";

export async function projectionSnapshotDrift(
  db: D1Database,
  run: Pick<
    ActiveRunRow,
    "policy_heads_hash" | "scope_json" | "source_watermark_json"
  >
): Promise<"policy_heads_changed" | "source_watermark_changed" | null> {
  const scope = PublicProjectionScopeSchema.parse(JSON.parse(run.scope_json));
  const [policyHeadsHash, sourceWatermark] = await Promise.all([
    publicProjectionPolicyHeadsHash(db),
    publicProjectionSourceWatermark(db, scope),
  ]);
  if (policyHeadsHash !== run.policy_heads_hash) {
    return "policy_heads_changed";
  }
  if (JSON.stringify(sourceWatermark) !== run.source_watermark_json) {
    return "source_watermark_changed";
  }
  return null;
}

export async function completeTerminalSelectionRun(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  const row = await db
    .prepare(
      `SELECT listing_total,listing_blocked,selection_complete
              ,listing_completed,listing_failed,listing_superseded
              ,position_total,position_completed,position_blocked
              ,position_failed,position_superseded
              ,(SELECT COUNT(*)
                  FROM public_projection_duplicate_batches batch
                 WHERE batch.run_id=public_projection_runs.id
                ) duplicate_batch_count
              ,(SELECT COUNT(*)
                  FROM public_projection_final_duplicate_seals seal
                 WHERE seal.run_id=public_projection_runs.id
                ) final_duplicate_seal_count
              ,(SELECT COUNT(*)
                  FROM public_projection_candidate_seals seal
                 WHERE seal.run_id=public_projection_runs.id
                ) candidate_seal_count
         FROM public_projection_runs WHERE id=?`
    )
    .bind(runId)
    .first<RunCompletionRow>();
  if (row?.selection_complete !== 1) {
    return;
  }
  if (row.duplicate_batch_count !== 1) {
    return;
  }
  if (row.final_duplicate_seal_count !== 1) {
    return;
  }
  if (row.candidate_seal_count !== 1) {
    return;
  }
  if (row.listing_total === 0) {
    await finishRun(db, runId, "completed", timestamp);
    return;
  }
  const listingTerminal =
    row.listing_completed +
    row.listing_blocked +
    row.listing_failed +
    row.listing_superseded;
  const positionTerminal =
    row.position_completed +
    row.position_blocked +
    row.position_failed +
    row.position_superseded;
  if (listingTerminal !== row.listing_total) {
    return;
  }
  if (row.position_total > 0 && positionTerminal !== row.position_total) {
    return;
  }
  const hasBlocks =
    row.listing_blocked +
      row.listing_failed +
      row.listing_superseded +
      row.position_blocked +
      row.position_failed +
      row.position_superseded >
    0;
  await finishRun(
    db,
    runId,
    hasBlocks ? "completed_with_blocks" : "completed",
    timestamp
  );
}

export async function completeTerminalSelectionRunAfterCandidates(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  await db
    .prepare(
      `UPDATE public_projection_runs
          SET status=CASE WHEN (
                listing_blocked+listing_failed+listing_superseded+
                position_blocked+position_failed+position_superseded
              )>0 THEN 'completed_with_blocks' ELSE 'completed' END,
              completed_at=?,updated_at=?
        WHERE id=? AND status='running' AND selection_complete=1
          AND EXISTS (
            SELECT 1 FROM public_projection_duplicate_batches batch
             WHERE batch.run_id=public_projection_runs.id
          )
          AND EXISTS (
            SELECT 1 FROM public_projection_final_duplicate_seals seal
             WHERE seal.run_id=public_projection_runs.id
          )
          AND EXISTS (
            SELECT 1 FROM public_projection_candidate_seals seal
             WHERE seal.run_id=public_projection_runs.id
          )
          AND (
            listing_total=0
            OR (
              listing_completed+listing_blocked+listing_failed+
                listing_superseded=listing_total
              AND (
                position_total=0
                OR position_completed+position_blocked+position_failed+
                  position_superseded=position_total
              )
            )
          )`
    )
    .bind(timestamp, timestamp, runId)
    .run();
}

async function finishRun(
  db: D1Database,
  runId: string,
  status: "completed" | "completed_with_blocks",
  timestamp: string
) {
  await db
    .prepare(
      `UPDATE public_projection_runs
          SET status=?,completed_at=?,updated_at=?
        WHERE id=? AND status='running'`
    )
    .bind(status, timestamp, timestamp, runId)
    .run();
}
