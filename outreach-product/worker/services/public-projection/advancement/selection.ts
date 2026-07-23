import {
  PUBLIC_PROJECTION_ADVANCE_LIMIT,
  PUBLIC_PROJECTION_SELECTION_PAGE_SIZE,
} from "../contracts";
import {
  FinalDuplicateSnapshotError,
  finalizeCanonicalDuplicateGraph,
} from "../final-graph";
import { sha256Hex } from "../hash";
import type { ActiveRunRow, SelectionRow } from "./model";
import { failRun } from "./stages";

export function finalDuplicateSealExists(db: D1Database, runId: string) {
  return db
    .prepare(
      `SELECT 1 present FROM public_projection_final_duplicate_seals
        WHERE run_id=? LIMIT 1`
    )
    .bind(runId)
    .first<{ present: number }>()
    .then((row) => row?.present === 1);
}

export async function finalizeRunDuplicateGraph(
  db: D1Database,
  runId: string,
  timestamp: string
): Promise<
  | {
      errorCode: null;
      finalGraph: Awaited<ReturnType<typeof finalizeCanonicalDuplicateGraph>>;
    }
  | {
      errorCode: FinalDuplicateSnapshotError["code"];
      finalGraph: null;
    }
> {
  try {
    return {
      errorCode: null,
      finalGraph: await finalizeCanonicalDuplicateGraph(db, runId, timestamp),
    };
  } catch (error) {
    if (!(error instanceof FinalDuplicateSnapshotError)) {
      throw error;
    }
    await failRun(db, runId, error.code, timestamp);
    return { errorCode: error.code, finalGraph: null };
  }
}

export function nextActiveRun(
  db: D1Database,
  canonicalResolutionEnabled: boolean
) {
  return db
    .prepare(
      `SELECT id,scope_json,selection_cursor,selection_complete,
              policy_heads_hash,source_watermark_json,status
         FROM public_projection_runs
        WHERE status='queued'
           OR (
             status='running'
             AND (
               selection_complete=0
               OR EXISTS (
                 SELECT 1 FROM public_projection_listing_items item
                  WHERE item.run_id=public_projection_runs.id
                    AND item.status='queued'
                    AND item.attempt_count<item.max_attempts
                    AND item.stage IN (
                      'selected','prerequisites','source_positions'
                    )
               )
               OR (
                 ?=1
                 AND EXISTS (
                   SELECT 1 FROM public_projection_position_items item
                    JOIN public_projection_duplicate_batch_members member
                      ON member.run_id=item.run_id
                     AND member.position_item_id=item.id
                    JOIN public_projection_duplicate_batches batch
                      ON batch.run_id=member.run_id
                   WHERE item.run_id=public_projection_runs.id
                     AND item.stage='canonical_resolution'
                     AND item.status='queued'
                     AND item.attempt_count<item.max_attempts
                     AND batch.canonical_identity_state='pending'
                     AND NOT EXISTS (
                       SELECT 1 FROM public_projection_resolution_seals seal
                        WHERE seal.run_id=item.run_id
                          AND seal.position_item_id=item.id
                     )
                 )
               )
               OR EXISTS (
                 SELECT 1 FROM public_projection_position_items item
                  WHERE item.run_id=public_projection_runs.id
                    AND item.status='queued'
                    AND item.attempt_count<item.max_attempts
                    AND item.stage='identity'
               )
               OR (
                 selection_complete=1
                 AND NOT EXISTS (
                   SELECT 1 FROM public_projection_duplicate_batches batch
                    WHERE batch.run_id=public_projection_runs.id
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM public_projection_listing_items item
                    WHERE item.run_id=public_projection_runs.id
                      AND item.status IN (
                        'queued','processing','waiting_analysis'
                      )
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM public_projection_position_items item
                    WHERE item.run_id=public_projection_runs.id
                      AND item.stage='identity'
                      AND item.status IN (
                        'queued','processing','waiting_analysis'
                      )
                 )
               )
               OR (
                 selection_complete=1
                 AND EXISTS (
                   SELECT 1 FROM public_projection_duplicate_batches batch
                    WHERE batch.run_id=public_projection_runs.id
                      AND batch.canonical_identity_state='pending'
                 )
                 AND NOT EXISTS (
                   SELECT 1
                     FROM public_projection_duplicate_batch_members member
                    WHERE member.run_id=public_projection_runs.id
                      AND NOT EXISTS (
                        SELECT 1 FROM public_projection_resolution_seals seal
                         WHERE seal.run_id=member.run_id
                           AND seal.position_item_id=member.position_item_id
                      )
                 )
                 AND NOT EXISTS (
                   SELECT 1
                     FROM public_projection_final_duplicate_seals seal
                    WHERE seal.run_id=public_projection_runs.id
                 )
               )
               OR (
                 EXISTS (
                   SELECT 1 FROM public_projection_final_duplicate_seals seal
                    WHERE seal.run_id=public_projection_runs.id
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM public_projection_candidate_seals seal
                    WHERE seal.run_id=public_projection_runs.id
                 )
               )
             )
           )
        ORDER BY updated_at,
                 CASE WHEN status='queued' THEN 0 ELSE 1 END,
                 requested_at,id
        LIMIT 1`
    )
    .bind(canonicalResolutionEnabled ? 1 : 0)
    .first<ActiveRunRow>();
}

export async function selectListingPage(
  db: D1Database,
  run: ActiveRunRow,
  timestamp: string
) {
  const rows = await db
    .prepare(
      `SELECT listing.id,listing.material_version,version.material_hash,
              version.material_hash_version,version.material_json
         FROM job_listings listing
         JOIN job_listing_versions version
           ON version.listing_id=listing.id
          AND version.material_version=listing.material_version
        WHERE listing.inventory_status='active'
          AND listing.id>?
          AND listing.id<=json_extract(?,'$.maxListingId')
          AND listing.material_changed_at<=json_extract(
            ?,'$.materialChangedAt'
          )
          AND (
            json_array_length(json_extract(?,'$.boards'))=0
            OR listing.board IN (
              SELECT CAST(value AS TEXT)
                FROM json_each(json_extract(?,'$.boards'))
            )
          )
          AND (
            json_array_length(json_extract(?,'$.listingIds'))=0
            OR listing.id IN (
              SELECT CAST(value AS TEXT)
                FROM json_each(json_extract(?,'$.listingIds'))
            )
          )
        ORDER BY listing.id
        LIMIT ?`
    )
    .bind(
      run.selection_cursor,
      run.source_watermark_json,
      run.source_watermark_json,
      run.scope_json,
      run.scope_json,
      run.scope_json,
      run.scope_json,
      PUBLIC_PROJECTION_SELECTION_PAGE_SIZE + 1
    )
    .all<SelectionRow>();
  const page = rows.results.slice(0, PUBLIC_PROJECTION_SELECTION_PAGE_SIZE);
  const prepared = await Promise.all(
    page.map(async (row) => {
      const legacy =
        row.material_json === null || row.material_hash_version !== 1;
      const inputHash =
        row.material_hash.length === 64
          ? row.material_hash
          : await sha256Hex(
              `jobkit-projection-input/v1\0${row.id}\0${row.material_version}\0${row.material_hash}`
            );
      return { inputHash, legacy, row };
    })
  );
  const selectionComplete = rows.results.length <= page.length ? 1 : 0;
  const cursor = page.at(-1)?.id ?? run.selection_cursor;
  const statements = prepared.map(({ inputHash, legacy, row }) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO public_projection_listing_items (
          id,run_id,listing_id,material_version,input_hash,stage,status,
          checkpoint_json,error_code,error_detail,created_at,completed_at,
          updated_at
        ) VALUES (?,?,?,?,?,'${legacy ? "prerequisites" : "selected"}',
          '${legacy ? "blocked" : "queued"}',?, ?, ?, ?, ?, ?)`
      )
      .bind(
        `projection-listing:${run.id}:${row.id}:${row.material_version}`,
        run.id,
        row.id,
        row.material_version,
        inputHash,
        legacy
          ? '{"materialSnapshot":"legacy"}'
          : '{"materialSnapshot":"selected"}',
        legacy ? "legacy_material_snapshot" : "",
        legacy ? "Material JSON is absent or uses a legacy hash version" : "",
        timestamp,
        legacy ? timestamp : null,
        timestamp
      )
  );
  statements.push(
    db
      .prepare(
        `UPDATE public_projection_runs
            SET listing_total=(
                  SELECT COUNT(*) FROM public_projection_listing_items
                   WHERE run_id=?
                ),
                listing_blocked=(
                  SELECT COUNT(*) FROM public_projection_listing_items
                   WHERE run_id=? AND status='blocked'
                ),
                selection_cursor=?,selection_complete=?,updated_at=?
          WHERE id=? AND status='running'`
      )
      .bind(run.id, run.id, cursor, selectionComplete, timestamp, run.id)
  );
  await db.batch(statements);
  return {
    blocked: prepared.filter((item) => item.legacy).length,
    selected: prepared.length,
  };
}

export async function advanceSelectedListings(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  const result = await db
    .prepare(
      `UPDATE public_projection_listing_items
          SET stage='prerequisites',
              checkpoint_json=json_set(
                checkpoint_json,'$.materialSnapshot','validated'
              ),
              updated_at=?
        WHERE id IN (
          SELECT id FROM public_projection_listing_items
           WHERE run_id=? AND status='queued' AND stage='selected'
           ORDER BY listing_id,id LIMIT ?
        )
      RETURNING id`
    )
    .bind(timestamp, runId, PUBLIC_PROJECTION_ADVANCE_LIMIT)
    .all<{ id: string }>();
  if (result.results.length > 0) {
    await db
      .prepare(
        `UPDATE public_projection_runs SET updated_at=?
          WHERE id=? AND status='running'`
      )
      .bind(timestamp, runId)
      .run();
  }
  return result.results.length;
}
