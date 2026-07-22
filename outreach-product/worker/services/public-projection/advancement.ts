import { processProjectionCanonicalResolutionClaim } from "./canonical-resolution";
import {
  PUBLIC_PROJECTION_ADVANCE_LIMIT,
  PUBLIC_PROJECTION_SELECTION_PAGE_SIZE,
  PublicProjectionScopeSchema,
} from "./contracts";
import {
  DuplicateComparisonSnapshotError,
  finalizeStableDuplicateComparisons,
} from "./duplicate-comparisons";
import {
  FinalDuplicateSnapshotError,
  finalizeCanonicalDuplicateGraph,
} from "./final-graph";
import { canonicalJson, sha256Hex } from "./hash";
import { processProjectionIdentityClaim } from "./identity";
import {
  claimProjectionListing,
  projectionRunCounterStatement,
} from "./listing-items";
import type { PermanentLocationResolver } from "./mapbox-location-resolver";
import { claimProjectionPosition } from "./position-items";
import {
  inspectProjectionPrerequisiteWaiter,
  processProjectionPrerequisiteClaim,
} from "./prerequisites";
import {
  publicProjectionPolicyHeadsHash,
  publicProjectionSourceWatermark,
} from "./snapshots";
import { processProjectionSourcePositionClaim } from "./source-positions";

interface ActiveRunRow {
  id: string;
  policy_heads_hash: string;
  scope_json: string;
  selection_complete: number;
  selection_cursor: string;
  source_watermark_json: string;
  status: "queued" | "running";
}

interface WaitingListingRow {
  id: string;
  policy_heads_hash: string;
  run_id: string;
  scope_json: string;
  source_watermark_json: string;
  stage: "prerequisites" | "source_positions";
}

interface SelectionRow {
  id: string;
  material_hash: string;
  material_hash_version: number;
  material_json: string | null;
  material_version: number;
}

interface ExpiredProjectionItemRow {
  item_id: string;
  item_kind: "listing" | "position";
  lease_token: string;
  recovered_at: string;
  run_id: string;
}

interface RunCompletionRow {
  duplicate_batch_count: number;
  final_duplicate_seal_count: number;
  listing_blocked: number;
  listing_completed: number;
  listing_failed: number;
  listing_superseded: number;
  listing_total: number;
  position_blocked: number;
  position_completed: number;
  position_failed: number;
  position_superseded: number;
  position_total: number;
  selection_complete: number;
}

interface PublicProjectionAdvanceOptions {
  deferFinalDuplicate?: boolean;
  locationResolver?: PermanentLocationResolver;
}

export async function advancePublicProjectionRuns(
  db: D1Database,
  options: PublicProjectionAdvanceOptions = {}
) {
  const recovery = await recoverOneExpiredItem(db);
  const requeued = recovery.recovered;
  if (recovery.inspected > 0) {
    return {
      advanced: 0,
      awakened: 0,
      blocked: 0,
      expanded: 0,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: recovery.runId,
      selected: 0,
    };
  }
  const waiterRecovery = await awakenReadyAnalysisWaiters(db);
  const { awakened } = waiterRecovery;
  if (waiterRecovery.drift) {
    return {
      advanced: 0,
      awakened,
      blocked: 0,
      drift: waiterRecovery.drift.code,
      expanded: 0,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: waiterRecovery.drift.runId,
      selected: 0,
    };
  }
  const run = await nextActiveRun(db, options.locationResolver !== undefined);
  if (!run) {
    return {
      advanced: 0,
      awakened,
      blocked: 0,
      expanded: 0,
      identified: 0,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: null,
      selected: 0,
    };
  }

  const timestamp = new Date().toISOString();
  if (run.status === "queued") {
    await db
      .prepare(
        `UPDATE public_projection_runs
            SET status='running',started_at=?,updated_at=?
          WHERE id=? AND status='queued'`
      )
      .bind(timestamp, timestamp, run.id)
      .run();
  }

  const initialDrift = await projectionSnapshotDrift(db, run);
  if (initialDrift) {
    await failRun(db, run.id, initialDrift, timestamp);
    return {
      advanced: 0,
      awakened,
      blocked: 0,
      drift: initialDrift,
      expanded: 0,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: run.id,
      selected: 0,
    };
  }

  const selection =
    run.selection_complete === 1
      ? { blocked: 0, selected: 0 }
      : await selectListingPage(db, run, timestamp);
  const advancementDrift = await projectionSnapshotDrift(db, run);
  if (advancementDrift) {
    await failRun(db, run.id, advancementDrift, timestamp);
    return {
      advanced: 0,
      awakened,
      blocked: selection.blocked,
      drift: advancementDrift,
      expanded: 0,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  const advanced = await advanceSelectedListings(db, run.id, timestamp);
  if (advanced > 0) {
    await completeTerminalSelectionRun(db, run.id, timestamp);
    return {
      advanced,
      awakened,
      blocked: selection.blocked,
      expanded: 0,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  const prerequisites = await processPrerequisiteListings(
    db,
    run.id,
    timestamp
  );
  if (prerequisites.processed > 0) {
    await completeTerminalSelectionRun(db, run.id, timestamp);
    return {
      advanced: 0,
      awakened,
      blocked: selection.blocked + prerequisites.blocked,
      expanded: 0,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: prerequisites.ready,
      prerequisiteWaiting: prerequisites.waiting,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  const sourcePositions = await expandSourcePositions(db, run.id, timestamp);
  if (sourcePositions.processed > 0) {
    await completeTerminalSelectionRun(db, run.id, timestamp);
    return {
      advanced: 0,
      awakened,
      blocked: selection.blocked + sourcePositions.blocked,
      expanded: sourcePositions.expanded,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: sourcePositions.waiting,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  const identities = await processPositionIdentities(db, run.id, timestamp);
  // Duplicate finalization has its own fixed statement budget. A call that
  // performed identity writes yields here so the resumable D2 pass begins in
  // a clean invocation with only read-only upstream probes ahead of it.
  if (identities.processed > 0) {
    await completeTerminalSelectionRun(db, run.id, timestamp);
    return {
      advanced: 0,
      awakened,
      blocked: selection.blocked + identities.blocked,
      expanded: 0,
      identified: identities.identified,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  // A waiter inspection may serve a different run than the one selected for
  // advancement. It can share a bounded normal stage, while the fixed-budget
  // D2 finalizer always starts after an invocation with zero waiter work.
  if (waiterRecovery.inspected > 0) {
    return {
      advanced: 0,
      awakened,
      blocked: selection.blocked + identities.blocked,
      expanded: 0,
      identified: identities.identified,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  let duplicateComparisons: Awaited<
    ReturnType<typeof finalizeStableDuplicateComparisons>
  >;
  try {
    duplicateComparisons = await finalizeStableDuplicateComparisons(
      db,
      run.id,
      timestamp
    );
  } catch (error) {
    if (!(error instanceof DuplicateComparisonSnapshotError)) {
      throw error;
    }
    await failRun(db, run.id, error.code, timestamp);
    return {
      advanced: 0,
      awakened,
      blocked: selection.blocked + identities.blocked,
      drift: error.code,
      expanded: 0,
      identified: identities.identified,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  return advanceAfterDuplicatePass(db, {
    awakened,
    blocked: selection.blocked + identities.blocked,
    deferFinalDuplicate: options.deferFinalDuplicate ?? false,
    duplicateComparisons,
    identified: identities.identified,
    locationResolver: options.locationResolver,
    requeued,
    runId: run.id,
    selected: selection.selected,
    timestamp,
  });
}

async function advanceAfterDuplicatePass(
  db: D1Database,
  input: {
    awakened: number;
    blocked: number;
    duplicateComparisons: Awaited<
      ReturnType<typeof finalizeStableDuplicateComparisons>
    >;
    deferFinalDuplicate: boolean;
    identified: number;
    locationResolver: PermanentLocationResolver | undefined;
    requeued: number;
    runId: string;
    selected: number;
    timestamp: string;
  }
) {
  if (
    input.duplicateComparisons.replayed &&
    input.locationResolver !== undefined
  ) {
    const claim = await claimProjectionPosition(
      db,
      input.runId,
      "canonical_resolution",
      input.timestamp,
      { requireUnsealedCanonicalResolution: true }
    );
    if (claim) {
      const resolution = await processProjectionCanonicalResolutionClaim(
        db,
        claim,
        input.timestamp,
        input.locationResolver
      );
      await completeTerminalSelectionRun(db, input.runId, input.timestamp);
      return {
        advanced: 0,
        awakened: input.awakened,
        blocked: input.blocked + resolution.blocked,
        canonicalResolutionState: resolution.state,
        duplicateComparisons: input.duplicateComparisons.comparisonCount,
        duplicateState: input.duplicateComparisons.state,
        expanded: 0,
        identified: input.identified,
        invariantFailed: false,
        prerequisiteReady: 0,
        prerequisiteWaiting: 0,
        requeued: input.requeued,
        resolved: resolution.resolved,
        retried: resolution.retried,
        runId: input.runId,
        sealed: resolution.sealed,
        selected: input.selected,
      };
    }
  }

  if (!input.duplicateComparisons.replayed) {
    return {
      advanced: 0,
      awakened: input.awakened,
      blocked: input.blocked,
      duplicateComparisons: input.duplicateComparisons.comparisonCount,
      duplicateState: input.duplicateComparisons.state,
      expanded: 0,
      identified: input.identified,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued: input.requeued,
      runId: input.runId,
      selected: input.selected,
    };
  }

  if (
    input.deferFinalDuplicate &&
    !(await finalDuplicateSealExists(db, input.runId))
  ) {
    return {
      advanced: 0,
      allocations: 0,
      awakened: input.awakened,
      blocked: input.blocked,
      duplicateComparisons: input.duplicateComparisons.comparisonCount,
      duplicateState: input.duplicateComparisons.state,
      expanded: 0,
      finalDuplicateState: "pending" as const,
      identified: input.identified,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      promotableAllocations: 0,
      requeued: input.requeued,
      runId: input.runId,
      selected: input.selected,
    };
  }

  const finalization = await finalizeRunDuplicateGraph(
    db,
    input.runId,
    input.timestamp
  );
  if (finalization.errorCode) {
    return {
      advanced: 0,
      awakened: input.awakened,
      blocked: input.blocked,
      drift: finalization.errorCode,
      duplicateComparisons: input.duplicateComparisons.comparisonCount,
      duplicateState: input.duplicateComparisons.state,
      expanded: 0,
      identified: input.identified,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued: input.requeued,
      runId: input.runId,
      selected: input.selected,
    };
  }
  const { finalGraph } = finalization;
  await completeTerminalSelectionRunAfterFinalGraph(
    db,
    input.runId,
    input.timestamp
  );
  return {
    advanced: 0,
    allocations: finalGraph.allocationCount,
    awakened: input.awakened,
    blocked: input.blocked + finalGraph.blockedAllocationCount,
    duplicateComparisons: input.duplicateComparisons.comparisonCount,
    duplicateState: input.duplicateComparisons.state,
    expanded: 0,
    finalDuplicateState: finalGraph.state,
    identified: input.identified,
    invariantFailed: false,
    prerequisiteReady: 0,
    prerequisiteWaiting: 0,
    promotableAllocations: finalGraph.promotableCount,
    requeued: input.requeued,
    runId: input.runId,
    selected: input.selected,
  };
}

function finalDuplicateSealExists(db: D1Database, runId: string) {
  return db
    .prepare(
      `SELECT 1 present FROM public_projection_final_duplicate_seals
        WHERE run_id=? LIMIT 1`
    )
    .bind(runId)
    .first<{ present: number }>()
    .then((row) => row?.present === 1);
}

async function finalizeRunDuplicateGraph(
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

function nextActiveRun(db: D1Database, canonicalResolutionEnabled: boolean) {
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

async function selectListingPage(
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

async function advanceSelectedListings(
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

async function recoverOneExpiredItem(db: D1Database) {
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

async function awakenReadyAnalysisWaiters(db: D1Database) {
  const waiting = await db
    .prepare(
      `SELECT item.id,item.run_id,item.stage,run.scope_json,
              run.policy_heads_hash,run.source_watermark_json
         FROM public_projection_listing_items item
         JOIN public_projection_runs run ON run.id=item.run_id
        WHERE run.status='running' AND item.status='waiting_analysis'
          AND item.stage IN ('prerequisites','source_positions')
        ORDER BY item.updated_at,run.requested_at,item.listing_id,item.id
        LIMIT 1`
    )
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
            SET status='queued',error_code='',error_detail='',updated_at=?
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

async function processPrerequisiteListings(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  const totals = { blocked: 0, processed: 0, ready: 0, waiting: 0 };
  while (totals.processed < PUBLIC_PROJECTION_ADVANCE_LIMIT) {
    // biome-ignore lint/performance/noAwaitInLoops: Each iteration atomically leases one bounded projection item.
    const claim = await claimProjectionListing(
      db,
      runId,
      "prerequisites",
      timestamp
    );
    if (!claim) {
      break;
    }
    const result = await processProjectionPrerequisiteClaim(
      db,
      claim,
      timestamp
    );
    totals.blocked += result.blocked;
    totals.ready += result.ready;
    totals.waiting += result.waiting;
    totals.processed += 1;
  }
  return totals;
}

async function expandSourcePositions(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  const totals = { blocked: 0, expanded: 0, processed: 0, waiting: 0 };
  while (totals.processed < PUBLIC_PROJECTION_ADVANCE_LIMIT) {
    // biome-ignore lint/performance/noAwaitInLoops: Each iteration atomically leases one bounded projection item.
    const claim = await claimProjectionListing(
      db,
      runId,
      "source_positions",
      timestamp
    );
    if (!claim) {
      break;
    }
    const result = await processProjectionSourcePositionClaim(
      db,
      claim,
      timestamp
    );
    totals.blocked += result.blocked;
    totals.expanded += result.expanded;
    totals.waiting += result.waiting;
    totals.processed += 1;
  }
  return totals;
}

async function processPositionIdentities(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  const totals = { blocked: 0, identified: 0, processed: 0 };
  while (totals.processed < PUBLIC_PROJECTION_ADVANCE_LIMIT) {
    // biome-ignore lint/performance/noAwaitInLoops: Each iteration atomically leases one bounded projection item.
    const claim = await claimProjectionPosition(
      db,
      runId,
      "identity",
      timestamp
    );
    if (!claim) {
      break;
    }
    const result = await processProjectionIdentityClaim(db, claim, timestamp);
    totals.blocked += result.blocked;
    totals.identified += result.identified;
    totals.processed += 1;
  }
  return totals;
}

async function failRun(
  db: D1Database,
  runId: string,
  errorCode:
    | "duplicate_pair_input_snapshot_changed"
    | "final_duplicate_input_snapshot_changed"
    | "policy_heads_changed"
    | "source_watermark_changed",
  timestamp: string
) {
  const errorDetail = {
    duplicate_pair_input_snapshot_changed:
      "The sealed duplicate-comparison inputs changed during finalization",
    final_duplicate_input_snapshot_changed:
      "The sealed canonical duplicate inputs changed during finalization",
    policy_heads_changed: "Publication policy heads changed during the run",
    source_watermark_changed: "The scoped active listing cohort changed",
  }[errorCode];
  await db.batch([
    db
      .prepare(
        `UPDATE public_projection_listing_items
            SET status='superseded',lease_owner=NULL,lease_token=NULL,
                lease_expires_at=NULL,error_code='projection_run_failed',
                error_detail=?,completed_at=COALESCE(completed_at,?),updated_at=?
          WHERE run_id=?
            AND status IN ('queued','processing','waiting_analysis')`
      )
      .bind(errorDetail, timestamp, timestamp, runId),
    db
      .prepare(
        `UPDATE public_projection_position_items
            SET status='superseded',lease_owner=NULL,lease_token=NULL,
                lease_expires_at=NULL,error_code='projection_run_failed',
                error_detail=?,completed_at=COALESCE(
                  completed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')
                ),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE run_id=?
            AND status IN ('queued','processing','waiting_analysis')`
      )
      .bind(errorDetail, runId),
    projectionRunCounterStatement(db, runId, timestamp),
    db
      .prepare(
        `UPDATE public_projection_runs
            SET status='failed',error_code=?,error_detail=?,
                completed_at=?,updated_at=?
          WHERE id=? AND status='running'`
      )
      .bind(errorCode, errorDetail, timestamp, timestamp, runId),
  ]);
}

async function projectionSnapshotDrift(
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

async function completeTerminalSelectionRun(
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

async function completeTerminalSelectionRunAfterFinalGraph(
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
