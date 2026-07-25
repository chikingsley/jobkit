import { sha256Hex } from "../../../../src/features/countries/materialization";
import { isConstraintError } from "../../agent-tasks/run-store";
import { MATERIALIZATION_TOPIC } from "../output";
import type { FanoutPageResult, MaterializationItemRow } from "./model";

export function completeChunkItemStatement(
  db: D1Database,
  item: MaterializationItemRow,
  count: number
) {
  return db
    .prepare(
      `UPDATE country_sweep_materialization_items
          SET status='completed',processed_count=?,
              lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND output_id=? AND status='processing'
          AND attempt_count=? AND lease_token=? AND expected_count=?`
    )
    .bind(
      count,
      item.id,
      item.output_id,
      item.attempt_count,
      item.lease_token,
      item.expected_count
    );
}

export function captureInsertedCountStatement(
  db: D1Database,
  item: MaterializationItemRow
) {
  return db
    .prepare(
      `UPDATE country_sweep_materialization_items
          SET inserted_count=changes(),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND output_id=? AND status='processing'
          AND attempt_count=? AND lease_token=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND EXISTS (
            SELECT 1 FROM country_sweep_outputs output
             WHERE output.id=country_sweep_materialization_items.output_id
               AND output.status='materializing'
          )`
    )
    .bind(item.id, item.output_id, item.attempt_count, item.lease_token);
}

export function accumulateInsertedCountStatement(
  db: D1Database,
  item: MaterializationItemRow
) {
  return db
    .prepare(
      `UPDATE country_sweep_materialization_items
          SET inserted_count=inserted_count+changes(),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND output_id=? AND status='processing'
          AND attempt_count=? AND lease_token=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND EXISTS (
            SELECT 1 FROM country_sweep_outputs output
             WHERE output.id=country_sweep_materialization_items.output_id
               AND output.status='materializing'
          )`
    )
    .bind(item.id, item.output_id, item.attempt_count, item.lease_token);
}

export function completeFanoutPageStatement(
  db: D1Database,
  item: MaterializationItemRow,
  result: FanoutPageResult
) {
  return db
    .prepare(
      `UPDATE country_sweep_materialization_items
          SET status=?,cursor_primary=CASE WHEN ?<>'' THEN ? ELSE cursor_primary END,
              cursor_secondary=CASE WHEN ?<>'' THEN ? ELSE cursor_secondary END,
              processed_count=processed_count+?,inserted_count=inserted_count+?,
              lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
              completed_at=CASE WHEN ?=1 THEN
                strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND output_id=? AND status='processing'
          AND attempt_count=? AND lease_token=?`
    )
    .bind(
      result.completed ? "completed" : "queued",
      result.nextPrimary,
      result.nextPrimary,
      result.nextSecondary,
      result.nextSecondary,
      result.processedCount,
      result.insertedCount,
      result.completed ? 1 : 0,
      item.id,
      item.output_id,
      item.attempt_count,
      item.lease_token
    );
}

export function completeFinalizerItemStatement(
  db: D1Database,
  item: MaterializationItemRow
) {
  return db
    .prepare(
      `UPDATE country_sweep_materialization_items
          SET status='completed',processed_count=expected_count,
              lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
              completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND output_id=? AND status='processing'
          AND attempt_count=? AND lease_token=?`
    )
    .bind(item.id, item.output_id, item.attempt_count, item.lease_token);
}

export function insertNextOutboxStatement(
  db: D1Database,
  outputId: string,
  outboxId: string,
  workItemId?: string
) {
  return db
    .prepare(
      `INSERT INTO work_outbox
        (id,topic,aggregate_id,work_item_id,available_at,created_at)
       SELECT ?,?,?,next.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
         FROM country_sweep_materialization_items next
        WHERE next.output_id=? AND next.status='queued'
          AND (? IS NULL OR next.id=?)
          AND ${materializationStagePrerequisitesSql("next")}
        ORDER BY next.sequence,next.id LIMIT 1`
    )
    .bind(
      outboxId,
      MATERIALIZATION_TOPIC,
      outputId,
      outputId,
      workItemId ?? null,
      workItemId ?? null
    );
}

export function materializationStagePrerequisitesSql(itemExpression: string) {
  const itemRank = materializationStageRankSql(`${itemExpression}.kind`);
  const predecessorRank = materializationStageRankSql("predecessor.kind");
  return `NOT EXISTS (
    SELECT 1 FROM country_sweep_materialization_items predecessor
     WHERE predecessor.output_id=${itemExpression}.output_id
       AND predecessor.id<>${itemExpression}.id
       AND predecessor.status<>'completed'
       AND (
         ${predecessorRank}<${itemRank}
         OR (
           ${predecessorRank}=${itemRank}
           AND predecessor.sequence<${itemExpression}.sequence
         )
       )
  )`;
}

function materializationStageRankSql(kindExpression: string) {
  return `CASE ${kindExpression}
    WHEN 'organizations_chunk' THEN 0
    WHEN 'contacts_chunk' THEN 1
    WHEN 'phase_finalize' THEN 3
    ELSE 2 END`;
}

export function materializationGuardSql(outputExpression: string) {
  return `EXISTS (
    SELECT 1 FROM country_sweep_materialization_items active_item
     WHERE active_item.id=? AND active_item.output_id=${outputExpression}
       AND active_item.status='processing' AND active_item.attempt_count=?
       AND active_item.lease_token=?
       AND active_item.lease_expires_at>
           strftime('%Y-%m-%dT%H:%M:%fZ','now')
       AND EXISTS (
         SELECT 1 FROM country_sweep_outputs active_output
          WHERE active_output.id=active_item.output_id
            AND active_output.status='materializing'
       )
  )`;
}

export function materializationGuardValues(item: MaterializationItemRow) {
  return [item.id, item.attempt_count, item.lease_token] as const;
}

export function directMaterializationGuardSql() {
  return `EXISTS (
    SELECT 1 FROM country_sweep_materialization_items active_item
     JOIN country_sweep_outputs active_output
       ON active_output.id=active_item.output_id
      AND active_output.status='materializing'
    WHERE active_item.id=? AND active_item.output_id=?
      AND active_item.status='processing' AND active_item.attempt_count=?
      AND active_item.lease_token=?
      AND active_item.lease_expires_at>
          strftime('%Y-%m-%dT%H:%M:%fZ','now')
  )`;
}

export function directMaterializationGuardValues(item: MaterializationItemRow) {
  return [
    item.id,
    item.output_id,
    item.attempt_count,
    item.lease_token,
  ] as const;
}

export function nextOutboxId(item: MaterializationItemRow) {
  return `country-materialization:${item.output_id}:after:${item.id}:${item.attempt_count.toString()}`;
}

export function pageOutboxId(item: MaterializationItemRow) {
  return `country-materialization:${item.output_id}:page:${item.id}:${item.attempt_count.toString()}`;
}

export function expiredLeaseOutboxId(item: MaterializationItemRow) {
  return `country-materialization:${item.output_id}:expired:${item.id}:${item.attempt_count.toString()}`;
}

export function isMaterializationRace(error: unknown) {
  return (
    error instanceof Error &&
    (error.message === "Country materialization lease changed" ||
      isConstraintError(error.cause))
  );
}

export async function readItemCursor(
  db: D1Database,
  itemId: string,
  column: "cursor_primary" | "cursor_secondary"
) {
  return (
    (await db
      .prepare(
        `SELECT ${column} value FROM country_sweep_materialization_items WHERE id=?`
      )
      .bind(itemId)
      .first<string>("value")) ?? ""
  );
}

export async function readSweepValue(
  db: D1Database,
  sweepId: string,
  column: "country_code" | "country_name"
) {
  return (
    (await db
      .prepare(`SELECT ${column} value FROM country_sweeps WHERE id=?`)
      .bind(sweepId)
      .first<string>("value")) ?? ""
  );
}

export async function stableId(namespace: string, ...parts: string[]) {
  return `${namespace}:${await sha256Hex(parts.join("\u001f"))}`;
}

export function requiredChangesAssertion(
  db: D1Database,
  expectedChanges: number
) {
  return db
    .prepare(
      `INSERT INTO transaction_assertions(must_equal_one)
       SELECT 0 WHERE changes()<>?`
    )
    .bind(expectedChanges);
}

export async function guardedBatch(
  db: D1Database,
  statements: D1PreparedStatement[]
) {
  try {
    await db.batch(statements);
  } catch (error) {
    if (isConstraintError(error)) {
      const conflict = new Error("Country materialization lease changed");
      conflict.cause = error;
      throw conflict;
    }
    throw error;
  }
}
