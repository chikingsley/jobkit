import type { z } from "zod";
import type { AgentRunnerContext } from "../../features/agents/runner";
import type {
  InventoryRunBatchSchema,
  InventoryRunFailureSchema,
  InventoryRunFinishSchema,
  InventoryRunStartSchema,
} from "../../features/inventory/schema";

export type InventoryRunBatch = z.infer<typeof InventoryRunBatchSchema>;
export type InventoryRunFailure = z.infer<typeof InventoryRunFailureSchema>;
export type InventoryRunFinish = z.infer<typeof InventoryRunFinishSchema>;
export type InventoryRunStart = z.infer<typeof InventoryRunStartSchema>;

export type InventoryItemStatus = "failed" | "unchanged" | "upserted";
export type InventoryRunStatus =
  | "canceled"
  | "completed"
  | "failed"
  | "ingesting"
  | "partial"
  | "reconciling";

export interface InventoryRunRow {
  failed_count: number;
  id: string;
  processed_count: number;
  refresh_request_id: string | null;
  runner_id: string | null;
  source_active_count: number;
  source_id: string;
  source_total_count: number;
  started_by_user_id: string | null;
  status: InventoryRunStatus;
  unchanged_count: number;
  upserted_count: number;
}

export interface InventoryRunItemRow {
  content_hash: string;
  status: InventoryItemStatus;
}

export interface InventorySourceRow {
  completeness_policy: "append_only" | "complete_snapshot";
  id: string;
}

export class InventoryRunError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 422 | 503;

  constructor(message: string, status: 400 | 403 | 404 | 409 | 422 | 503) {
    super(message);
    this.status = status;
  }
}

export async function readInventorySource(db: D1Database, sourceId: string) {
  const source = await db
    .prepare(
      `SELECT id,completeness_policy FROM inventory_sources
        WHERE id=? AND status='active'`
    )
    .bind(sourceId)
    .first<InventorySourceRow>();
  if (!source) {
    throw new InventoryRunError("Inventory source is not registered", 404);
  }
  return source;
}

export async function readOwnedRun(
  db: D1Database,
  runner: AgentRunnerContext,
  runId: string
) {
  const row = await db
    .prepare(
      `SELECT id,source_id,started_by_user_id,runner_id,status,refresh_request_id,
              source_total_count,source_active_count,processed_count,
              upserted_count,unchanged_count,failed_count
         FROM inventory_runs WHERE id=?`
    )
    .bind(runId)
    .first<InventoryRunRow>();
  if (!row) {
    throw new InventoryRunError("Inventory run was not found", 404);
  }
  assertRunOwner(row, runner);
  if (row.refresh_request_id) {
    await assertRefreshOperationLease(
      db,
      runner,
      row.refresh_request_id,
      row.source_id
    );
  }
  return row;
}

export async function assertRefreshOperationLease(
  db: D1Database,
  runner: AgentRunnerContext,
  operationId: string,
  sourceId: string
) {
  const operation = await db
    .prepare(
      `SELECT 1 present FROM inventory_refresh_requests
        WHERE id=? AND source_id=? AND runner_id=?
          AND status IN ('claimed','crawling','publishing')`
    )
    .bind(operationId, sourceId, runner.id)
    .first();
  if (!operation) {
    throw new InventoryRunError(
      "Inventory refresh operation is not leased by this runner",
      409
    );
  }
}

export function assertRunOwner(
  run: InventoryRunRow,
  runner: AgentRunnerContext
) {
  if (
    run.runner_id !== runner.id ||
    run.started_by_user_id !== runner.user.id
  ) {
    throw new InventoryRunError(
      "Inventory run belongs to another paired runner",
      403
    );
  }
}

export function assertRunCounts(
  run: InventoryRunRow,
  input: InventoryRunStart
) {
  if (
    run.source_total_count !== input.sourceTotalCount ||
    run.source_active_count !== input.sourceActiveCount
  ) {
    throw new InventoryRunError(
      "Inventory snapshot key was reused with different source counts",
      409
    );
  }
}

export function toInventoryRun(row: InventoryRunRow) {
  return {
    failedCount: Number(row.failed_count),
    id: row.id,
    processedCount: Number(row.processed_count),
    sourceActiveCount: Number(row.source_active_count),
    sourceId: row.source_id,
    sourceTotalCount: Number(row.source_total_count),
    status: row.status,
    unchangedCount: Number(row.unchanged_count),
    upsertedCount: Number(row.upserted_count),
  };
}
