import type { z } from "zod";
import type {
  InventoryOperationCompletionSchema,
  InventoryRefreshRequestSchema,
  InventoryRunFailureSchema,
  InventorySourceScheduleSchema,
} from "../../src/features/inventory/schema";
import type { AgentRunnerContext } from "../app-types";
import { InventoryRunError } from "./inventory-runs/contracts";

type InventoryOperationCompletion = z.infer<
  typeof InventoryOperationCompletionSchema
>;
type InventoryRefreshRequest = z.infer<typeof InventoryRefreshRequestSchema>;
type InventoryRunFailure = z.infer<typeof InventoryRunFailureSchema>;
type InventorySourceSchedule = z.infer<typeof InventorySourceScheduleSchema>;

const OPERATION_LEASE_MS = 5 * 60 * 1000;

interface RefreshRow {
  boards_json: string;
  id: string;
  lease_expires_at: string;
  mode: "full" | "latest";
  source_id: string;
}

export async function requestInventoryRefresh(
  db: D1Database,
  userId: string,
  input: InventoryRefreshRequest
) {
  await requireSourceOperator(db, input.sourceId, userId);
  const boards = [...new Set(input.boards)].sort();
  const requestKey = `${input.sourceId}:${input.mode}:${boards.join(",")}`;
  const existing = await db
    .prepare(
      `SELECT id,source_id,mode,boards_json,status,requested_at,updated_at
         FROM inventory_refresh_requests
        WHERE source_id=? AND request_key=?
          AND status IN ('queued','claimed','crawling','publishing')
        ORDER BY requested_at DESC LIMIT 1`
    )
    .bind(input.sourceId, requestKey)
    .first<Record<string, unknown>>();
  if (existing) {
    return refreshSummary(existing);
  }
  return insertRefreshRequest(db, {
    boards,
    mode: input.mode,
    requestedByUserId: userId,
    requestKey,
    sourceId: input.sourceId,
  });
}

export async function updateInventorySourceSchedule(
  db: D1Database,
  userId: string,
  sourceId: string,
  input: InventorySourceSchedule
) {
  await requireSourceOperator(db, sourceId, userId);
  const timestamp = new Date().toISOString();
  const nextRefreshAt = input.refreshIntervalMinutes
    ? new Date(
        Date.now() + input.refreshIntervalMinutes * 60 * 1000
      ).toISOString()
    : null;
  await db
    .prepare(
      `UPDATE inventory_sources
          SET refresh_interval_minutes=?,next_refresh_at=?,updated_at=?
        WHERE id=?`
    )
    .bind(input.refreshIntervalMinutes, nextRefreshAt, timestamp, sourceId)
    .run();
  return {
    nextRefreshAt,
    refreshIntervalMinutes: input.refreshIntervalMinutes,
    sourceId,
  };
}

export async function queueDueInventoryRefreshes(db: D1Database) {
  const timestamp = new Date().toISOString();
  const sources = await db
    .prepare(
      `SELECT id,refresh_interval_minutes FROM inventory_sources source
        WHERE source.status='active'
          AND source.refresh_interval_minutes IS NOT NULL
          AND source.next_refresh_at IS NOT NULL
          AND source.next_refresh_at<=?
          AND EXISTS (
            SELECT 1 FROM inventory_source_operators operator
             WHERE operator.source_id=source.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM inventory_refresh_requests request
             WHERE request.source_id=source.id
               AND request.status IN ('queued','claimed','crawling','publishing')
          )`
    )
    .bind(timestamp)
    .all<{ id: string; refresh_interval_minutes: number }>();
  let queued = 0;
  for (const source of sources.results) {
    // biome-ignore lint/performance/noAwaitInLoops: Each due source is durably queued and rescheduled before the next source is considered.
    await insertRefreshRequest(db, {
      boards: [],
      mode: "latest",
      requestedByUserId: null,
      requestKey: `${source.id}:latest:`,
      sourceId: source.id,
    });
    const nextRefreshAt = new Date(
      Date.now() + source.refresh_interval_minutes * 60 * 1000
    ).toISOString();
    await db
      .prepare(
        `UPDATE inventory_sources
            SET next_refresh_at=?,updated_at=?
          WHERE id=?`
      )
      .bind(nextRefreshAt, timestamp, source.id)
      .run();
    queued += 1;
  }
  return { queued };
}

export async function claimInventoryOperation(
  db: D1Database,
  runner: AgentRunnerContext
) {
  const timestamp = new Date().toISOString();
  const leaseExpiresAt = new Date(
    Date.now() + OPERATION_LEASE_MS
  ).toISOString();
  const row = await db
    .prepare(
      `UPDATE inventory_refresh_requests
          SET status='claimed',runner_id=?,claimed_at=COALESCE(claimed_at,?),
              started_at=COALESCE(started_at,?),lease_expires_at=?,updated_at=?
        WHERE id=(
          SELECT request.id FROM inventory_refresh_requests request
           WHERE (
             request.status='queued' OR
             (
               request.status IN ('claimed','crawling','publishing')
               AND request.lease_expires_at<?
             )
           )
             AND EXISTS (
               SELECT 1 FROM inventory_source_operators operator
                WHERE operator.source_id=request.source_id AND operator.user_id=?
             )
           ORDER BY request.requested_at LIMIT 1
        )
      RETURNING id,source_id,mode,boards_json,lease_expires_at`
    )
    .bind(
      runner.id,
      timestamp,
      timestamp,
      leaseExpiresAt,
      timestamp,
      timestamp,
      runner.user.id
    )
    .first<RefreshRow>();
  if (!row) {
    return null;
  }
  return {
    boards: JSON.parse(row.boards_json) as string[],
    id: row.id,
    leaseExpiresAt: row.lease_expires_at,
    mode: row.mode,
    sourceId: row.source_id,
    type: "inventory.refresh" as const,
  };
}

export async function heartbeatInventoryOperation(
  db: D1Database,
  runner: AgentRunnerContext,
  operationId: string,
  status: "crawling" | "publishing"
) {
  const timestamp = new Date().toISOString();
  const leaseExpiresAt = new Date(
    Date.now() + OPERATION_LEASE_MS
  ).toISOString();
  const result = await db
    .prepare(
      `UPDATE inventory_refresh_requests
          SET status=?,lease_expires_at=?,updated_at=?
        WHERE id=? AND runner_id=?
          AND status IN ('claimed','crawling','publishing')`
    )
    .bind(status, leaseExpiresAt, timestamp, operationId, runner.id)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new InventoryRunError(
      "Inventory operation is not leased by this runner",
      409
    );
  }
  return { leaseExpiresAt, status };
}

export async function completeInventoryOperation(
  db: D1Database,
  runner: AgentRunnerContext,
  operationId: string,
  input: InventoryOperationCompletion
) {
  const inventoryRun = await db
    .prepare(
      `SELECT run.id FROM inventory_runs run
       JOIN inventory_refresh_requests request ON request.id=?
       WHERE run.id=? AND run.source_id=request.source_id
         AND run.runner_id=? AND run.refresh_request_id=request.id
         AND run.status='completed'`
    )
    .bind(operationId, input.inventoryRunId, runner.id)
    .first<{ id: string }>();
  if (!inventoryRun) {
    throw new InventoryRunError(
      "Completed inventory snapshot does not belong to this operation",
      409
    );
  }
  const timestamp = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE inventory_refresh_requests
          SET status='completed',inventory_run_id=?,lease_expires_at=NULL,
              error_detail='',completed_at=?,updated_at=?
        WHERE id=? AND runner_id=?
          AND status IN ('claimed','crawling','publishing')`
    )
    .bind(input.inventoryRunId, timestamp, timestamp, operationId, runner.id)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new InventoryRunError(
      "Inventory operation is not leased by this runner",
      409
    );
  }
  await rescheduleCompletedAutomaticRefresh(db, operationId);
  return {
    id: operationId,
    inventoryRunId: input.inventoryRunId,
    status: "completed",
  };
}

export async function failInventoryOperation(
  db: D1Database,
  runner: AgentRunnerContext,
  operationId: string,
  input: InventoryRunFailure
) {
  const timestamp = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE inventory_refresh_requests
          SET status='failed',error_detail=?,lease_expires_at=NULL,
              completed_at=?,updated_at=?
        WHERE id=? AND runner_id=?
          AND status IN ('claimed','crawling','publishing')`
    )
    .bind(input.error, timestamp, timestamp, operationId, runner.id)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new InventoryRunError(
      "Inventory operation is not leased by this runner",
      409
    );
  }
  await rescheduleCompletedAutomaticRefresh(db, operationId);
  return { id: operationId, status: "failed" as const };
}

async function rescheduleCompletedAutomaticRefresh(
  db: D1Database,
  operationId: string
) {
  const schedule = await db
    .prepare(
      `SELECT source.id,source.refresh_interval_minutes
         FROM inventory_refresh_requests request
         JOIN inventory_sources source ON source.id=request.source_id
        WHERE request.id=? AND request.requested_by_user_id IS NULL
          AND source.refresh_interval_minutes IS NOT NULL`
    )
    .bind(operationId)
    .first<{ id: string; refresh_interval_minutes: number }>();
  if (!schedule) {
    return;
  }
  const timestamp = new Date().toISOString();
  const nextRefreshAt = new Date(
    Date.now() + schedule.refresh_interval_minutes * 60 * 1000
  ).toISOString();
  await db
    .prepare(
      "UPDATE inventory_sources SET next_refresh_at=?,updated_at=? WHERE id=?"
    )
    .bind(nextRefreshAt, timestamp, schedule.id)
    .run();
}

async function requireSourceOperator(
  db: D1Database,
  sourceId: string,
  userId: string
) {
  const operator = await db
    .prepare(
      `SELECT 1 present FROM inventory_source_operators
        WHERE source_id=? AND user_id=?`
    )
    .bind(sourceId, userId)
    .first();
  if (!operator) {
    throw new InventoryRunError(
      "Inventory source operator access is required",
      403
    );
  }
}

async function insertRefreshRequest(
  db: D1Database,
  input: {
    boards: string[];
    mode: "full" | "latest";
    requestKey: string;
    requestedByUserId: string | null;
    sourceId: string;
  }
) {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO inventory_refresh_requests
        (id,source_id,requested_by_user_id,mode,boards_json,request_key,status,
         requested_at,updated_at)
       VALUES (?,?,?,?,?,?,'queued',?,?)`
    )
    .bind(
      id,
      input.sourceId,
      input.requestedByUserId,
      input.mode,
      JSON.stringify(input.boards),
      input.requestKey,
      timestamp,
      timestamp
    )
    .run();
  if ((result.meta.changes ?? 0) === 0) {
    const existing = await db
      .prepare(
        `SELECT id,source_id,mode,boards_json,status,requested_at,updated_at
           FROM inventory_refresh_requests
          WHERE request_key=?
            AND status IN ('queued','claimed','crawling','publishing')
          ORDER BY requested_at DESC LIMIT 1`
      )
      .bind(input.requestKey)
      .first<Record<string, unknown>>();
    if (!existing) {
      throw new Error("Inventory refresh could not be queued");
    }
    return refreshSummary(existing);
  }
  return {
    boards: input.boards,
    id,
    mode: input.mode,
    requestedAt: timestamp,
    sourceId: input.sourceId,
    status: "queued" as const,
    updatedAt: timestamp,
  };
}

function refreshSummary(row: Record<string, unknown>) {
  return {
    boards: JSON.parse(String(row.boards_json)) as unknown,
    id: String(row.id),
    mode: String(row.mode),
    requestedAt: String(row.requested_at),
    sourceId: String(row.source_id),
    status: String(row.status),
    updatedAt: String(row.updated_at),
  };
}
