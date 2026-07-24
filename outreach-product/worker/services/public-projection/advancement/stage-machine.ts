import type { ActiveRunRow } from "./model";
import { advanceSelectedListings } from "./selection";
import {
  activeStageItemsAbsentSql,
  claimableItemsExistSql,
} from "./stage-machine-sql";
import {
  candidateSealExistsSql,
  claimablePositionItemSql,
  duplicateBatchExistsSql,
  finalDuplicateSealExistsSql,
  pendingDuplicateBatchExistsSql,
  unsealedCanonicalResolutionGateSql,
  unsealedDuplicateMemberExistsSql,
} from "./stage-sql";
import {
  expandSourcePositions,
  processPositionIdentities,
  processPrerequisiteListings,
} from "./stages";

export type ProjectionRunStageName =
  | "candidates"
  | "canonical_resolution"
  | "duplicate_comparisons"
  | "final_graph"
  | "identity"
  | "listing_validation"
  | "prerequisites"
  | "selection"
  | "source_positions";

/** Uniform progress report for the claim-loop stages. */
export interface ItemStageProgress {
  advanced: number;
  blockedDelta: number;
  expanded: number;
  identified: number;
  prerequisiteReady: number;
  prerequisiteWaiting: number;
  processed: number;
}

type ItemStageExecutor = (
  db: D1Database,
  runId: string,
  timestamp: string
) => Promise<ItemStageProgress>;

type StageBind = "canonicalResolutionEnabled";

interface StagePendingWork {
  /** Positional `?` binds the fragment consumes, in order. */
  binds: readonly StageBind[];
  /** Pending-work predicate correlated against the `run` alias. */
  sql: string;
}

/**
 * How the queue consumer advances the stage. `selection` and the duplicate
 * tail keep bespoke dataflow in advancement.ts; `item-claims` stages execute
 * through the shared claim loop. Every stage added here must pick one, which
 * forces a consumer decision whenever the selector learns a new stage.
 */
type StageAdvance =
  | { execute: ItemStageExecutor; kind: "item-claims" }
  | { kind: "duplicate-tail" }
  | { kind: "selection" };

export interface ProjectionRunStage {
  advance: StageAdvance;
  name: ProjectionRunStageName;
  pendingWork: StagePendingWork;
}

const zeroProgress: Omit<ItemStageProgress, "processed"> = {
  advanced: 0,
  blockedDelta: 0,
  expanded: 0,
  identified: 0,
  prerequisiteReady: 0,
  prerequisiteWaiting: 0,
};

/**
 * The ordered public-projection run pipeline. This table is the only place
 * that knows which stages exist and when each still owes work; nextActiveRun
 * and the queue consumer both derive from it.
 */
export const PROJECTION_RUN_STAGES: readonly ProjectionRunStage[] = [
  {
    advance: { kind: "selection" },
    name: "selection",
    pendingWork: { binds: [], sql: "run.selection_complete=0" },
  },
  {
    advance: {
      execute: async (db, runId, timestamp) => {
        const advanced = await advanceSelectedListings(db, runId, timestamp);
        return { ...zeroProgress, advanced, processed: advanced };
      },
      kind: "item-claims",
    },
    name: "listing_validation",
    pendingWork: {
      binds: [],
      sql: claimableItemsExistSql("public_projection_listing_items", [
        "selected",
      ]),
    },
  },
  {
    advance: {
      execute: async (db, runId, timestamp) => {
        const totals = await processPrerequisiteListings(db, runId, timestamp);
        return {
          ...zeroProgress,
          blockedDelta: totals.blocked,
          prerequisiteReady: totals.ready,
          prerequisiteWaiting: totals.waiting,
          processed: totals.processed,
        };
      },
      kind: "item-claims",
    },
    name: "prerequisites",
    pendingWork: {
      binds: [],
      sql: claimableItemsExistSql("public_projection_listing_items", [
        "prerequisites",
      ]),
    },
  },
  {
    advance: {
      execute: async (db, runId, timestamp) => {
        const totals = await expandSourcePositions(db, runId, timestamp);
        return {
          ...zeroProgress,
          blockedDelta: totals.blocked,
          expanded: totals.expanded,
          prerequisiteWaiting: totals.waiting,
          processed: totals.processed,
        };
      },
      kind: "item-claims",
    },
    name: "source_positions",
    pendingWork: {
      binds: [],
      sql: claimableItemsExistSql("public_projection_listing_items", [
        "source_positions",
      ]),
    },
  },
  {
    advance: {
      execute: async (db, runId, timestamp) => {
        const totals = await processPositionIdentities(db, runId, timestamp);
        return {
          ...zeroProgress,
          blockedDelta: totals.blocked,
          identified: totals.identified,
          processed: totals.processed,
        };
      },
      kind: "item-claims",
    },
    name: "identity",
    pendingWork: {
      binds: [],
      sql: claimableItemsExistSql("public_projection_position_items", [
        "identity",
      ]),
    },
  },
  {
    advance: { kind: "duplicate-tail" },
    name: "duplicate_comparisons",
    pendingWork: {
      binds: [],
      sql: `run.selection_complete=1
        AND NOT ${duplicateBatchExistsSql("run")}
        AND ${activeStageItemsAbsentSql()}`,
    },
  },
  {
    advance: { kind: "duplicate-tail" },
    name: "canonical_resolution",
    pendingWork: {
      binds: ["canonicalResolutionEnabled"],
      sql: `?=1 AND EXISTS (
        SELECT 1 FROM public_projection_position_items item
         WHERE item.run_id=run.id
           AND item.stage='canonical_resolution'
           AND ${claimablePositionItemSql("item")}
           AND ${unsealedCanonicalResolutionGateSql("item")}
      )`,
    },
  },
  {
    advance: { kind: "duplicate-tail" },
    name: "final_graph",
    pendingWork: {
      binds: [],
      sql: `run.selection_complete=1
        AND ${pendingDuplicateBatchExistsSql("run")}
        AND NOT ${unsealedDuplicateMemberExistsSql("run")}
        AND NOT ${finalDuplicateSealExistsSql("run")}`,
    },
  },
  {
    advance: { kind: "duplicate-tail" },
    name: "candidates",
    pendingWork: {
      binds: [],
      sql: `${finalDuplicateSealExistsSql("run")}
        AND NOT ${candidateSealExistsSql("run")}`,
    },
  },
];

export const PROJECTION_ITEM_STAGES: readonly {
  execute: ItemStageExecutor;
  name: ProjectionRunStageName;
}[] = PROJECTION_RUN_STAGES.flatMap((stage) =>
  stage.advance.kind === "item-claims"
    ? [{ execute: stage.advance.execute, name: stage.name }]
    : []
);

const STAGE_BIND_VALUES: Record<
  StageBind,
  (canonicalResolutionEnabled: boolean) => number
> = {
  canonicalResolutionEnabled: (enabled) => (enabled ? 1 : 0),
};

/**
 * Selects the next run the queue consumer can make durable progress on. The
 * WHERE body is generated from PROJECTION_RUN_STAGES, so a run is only
 * selectable while some declared stage still reports pending work.
 */
export function nextActiveRun(
  db: D1Database,
  canonicalResolutionEnabled: boolean
) {
  const binds: number[] = [];
  const pending = PROJECTION_RUN_STAGES.map((stage) => {
    for (const bind of stage.pendingWork.binds) {
      binds.push(STAGE_BIND_VALUES[bind](canonicalResolutionEnabled));
    }
    return `(${stage.pendingWork.sql})`;
  }).join("\n           OR ");
  return db
    .prepare(
      `SELECT id,scope_json,selection_cursor,selection_complete,
              policy_heads_hash,source_watermark_json,status
         FROM public_projection_runs run
        WHERE status='queued'
           OR (
             status='running'
             AND (
           ${pending}
             )
           )
        ORDER BY updated_at,
                 CASE WHEN status='queued' THEN 0 ELSE 1 END,
                 requested_at,id
        LIMIT 1`
    )
    .bind(...binds)
    .first<ActiveRunRow>();
}
