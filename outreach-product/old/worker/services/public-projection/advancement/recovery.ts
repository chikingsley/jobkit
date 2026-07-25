import { canonicalJson } from "../hash";
import { projectionRunCounterStatement } from "../listing-items";
import { inspectProjectionPrerequisiteWaiter } from "../prerequisites";
import {
  completeTerminalSelectionRun,
  projectionSnapshotDrift,
} from "./completion";
import type { ExpiredProjectionItemRow, WaitingListingRow } from "./model";
import { failRun } from "./stages";

export async function recoverOneExpiredItem(db: D1Database) {
  const affected = await db
    .prepare(
      `SELECT item_id,item_kind,run_id,lease_token,lease_expires_at,
              strftime('%Y-%m-%dT%H:%M:%fZ','now') recovered_at
         FROM (
           SELECT item.id item_id,'listing' item_kind,item.run_id,
                  item.lease_token,item.lease_expires_at
             FROM public_projection_listing_items item
             JOIN public_projection_runs run ON run.id=item.run_id
            WHERE run.status='running' AND item.status='processing'
              AND item.lease_token IS NOT NULL
              AND item.lease_expires_at<=strftime(
                    '%Y-%m-%dT%H:%M:%fZ','now'
                  )
           UNION ALL
           SELECT item.id item_id,'position' item_kind,item.run_id,
                  item.lease_token,item.lease_expires_at
             FROM public_projection_position_items item
             JOIN public_projection_runs run ON run.id=item.run_id
            WHERE run.status='running' AND item.status='processing'
              AND item.lease_token IS NOT NULL
              AND item.lease_expires_at<=strftime(
                    '%Y-%m-%dT%H:%M:%fZ','now'
                  )
         ) expired
        ORDER BY lease_expires_at,item_kind,item_id
        LIMIT 1`
    )
    .first<ExpiredProjectionItemRow>();
  if (!affected) {
    return { inspected: 0, recovered: 0, runId: null };
  }

  const table =
    affected.item_kind === "listing"
      ? "public_projection_listing_items"
      : "public_projection_position_items";
  const detail =
    affected.item_kind === "listing"
      ? "Projection listing lease expired at max attempts"
      : "Projection position lease expired at max attempts";
  const result = await db
    .prepare(
      `UPDATE ${table}
          SET status=CASE
                WHEN attempt_count<max_attempts THEN 'queued'
                ELSE 'failed'
              END,
              lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
              error_code=CASE
                WHEN attempt_count<max_attempts THEN ''
                ELSE 'projection_attempts_exhausted'
              END,
              error_detail=CASE
                WHEN attempt_count<max_attempts THEN ''
                ELSE ?
              END,
              completed_at=CASE
                WHEN attempt_count<max_attempts THEN NULL
                ELSE ?
              END,
              updated_at=?
        WHERE id=? AND run_id=? AND status='processing' AND lease_token=?
          AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    )
    .bind(
      detail,
      affected.recovered_at,
      affected.recovered_at,
      affected.item_id,
      affected.run_id,
      affected.lease_token
    )
    .run();
  const recovered = result.meta.changes ?? 0;
  if (recovered > 0) {
    await projectionRunCounterStatement(
      db,
      affected.run_id,
      affected.recovered_at
    ).run();
    await completeTerminalSelectionRun(
      db,
      affected.run_id,
      affected.recovered_at
    );
  }
  return { inspected: 1, recovered, runId: affected.run_id };
}

export async function awakenReadyAnalysisWaiters(
  db: D1Database,
  runId: string | null = null
): Promise<{
  awakened: number;
  drift: {
    code: "policy_heads_changed" | "source_watermark_changed";
    runId: string;
  } | null;
  inspected: number;
  runId: string | null;
}> {
  const waiting = await db
    .prepare(
      `SELECT item.id,item.run_id,item.stage,run.scope_json,
              run.policy_heads_hash,run.source_watermark_json
         FROM public_projection_listing_items item
         JOIN public_projection_runs run ON run.id=item.run_id
        WHERE run.status='running' AND item.status='waiting_analysis'
          AND item.stage IN ('prerequisites','source_positions')
          AND (? IS NULL OR item.run_id=?)
        ORDER BY item.updated_at,run.requested_at,item.listing_id,item.id
        LIMIT 1`
    )
    .bind(runId, runId)
    .all<WaitingListingRow>();
  const runs = new Map<
    string,
    Pick<
      WaitingListingRow,
      "policy_heads_hash" | "run_id" | "scope_json" | "source_watermark_json"
    >
  >();
  for (const item of waiting.results) {
    runs.set(item.run_id, item);
  }
  const driftChecks = await Promise.all(
    [...runs.values()].map(async (run) => ({
      code: await projectionSnapshotDrift(db, run),
      runId: run.run_id,
    }))
  );
  const driftedRuns = new Set<string>();
  let firstDrift: {
    code: "policy_heads_changed" | "source_watermark_changed";
    runId: string;
  } | null = null;
  for (const drift of driftChecks) {
    if (!drift.code) {
      continue;
    }
    const timestamp = new Date().toISOString();
    // biome-ignore lint/performance/noAwaitInLoops: Each drifted run is failed and fenced independently.
    await failRun(db, drift.runId, drift.code, timestamp);
    driftedRuns.add(drift.runId);
    firstDrift ??= { code: drift.code, runId: drift.runId };
  }
  let awakened = 0;
  for (const item of waiting.results) {
    if (driftedRuns.has(item.run_id)) {
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: Each pinned snapshot has independent source-hash prerequisites.
    const inspection = await inspectProjectionPrerequisiteWaiter(db, item.id);
    const timestamp = new Date().toISOString();
    const inspectionJson = canonicalJson(inspection.checkpoint);
    if (inspection.terminalFailure) {
      await db.batch([
        db
          .prepare(
            `UPDATE public_projection_listing_items
                SET status='blocked',
                    checkpoint_json=json_set(
                      checkpoint_json,'$.waiterInspection',json(?)
                    ),error_code=?,
                    error_detail=?,completed_at=?,updated_at=?
              WHERE id=? AND status='waiting_analysis'`
          )
          .bind(
            inspectionJson,
            inspection.terminalFailure.code,
            inspection.terminalFailure.detail,
            timestamp,
            timestamp,
            item.id
          ),
        projectionRunCounterStatement(db, item.run_id, timestamp),
      ]);
      await completeTerminalSelectionRun(db, item.run_id, timestamp);
      continue;
    }
    if (analysisWaiterRemainsPending(inspection)) {
      await db
        .prepare(
          `UPDATE public_projection_listing_items
              SET checkpoint_json=json_set(
                    checkpoint_json,'$.waiterInspection',json(?)
                  ),updated_at=?
            WHERE id=? AND status='waiting_analysis'`
        )
        .bind(inspectionJson, timestamp, item.id)
        .run();
      continue;
    }
    const result = await db
      .prepare(
        `UPDATE public_projection_listing_items
            SET status='queued',attempt_count=0,
                error_code='',error_detail='',updated_at=?
          WHERE id=? AND status='waiting_analysis'`
      )
      .bind(timestamp, item.id)
      .run();
    awakened += result.meta.changes ?? 0;
  }
  return {
    awakened,
    drift: firstDrift,
    inspected: waiting.results.length,
    runId: waiting.results.at(0)?.run_id ?? null,
  };
}

function analysisWaiterRemainsPending(input: { ready: boolean }) {
  return !input.ready;
}
