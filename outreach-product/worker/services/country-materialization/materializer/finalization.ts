import { sha256Hex } from "../../../../src/features/countries/materialization";
import type { MaterializationItemRow } from "./model";
import {
  completeFinalizerItemStatement,
  expiredLeaseOutboxId,
  guardedBatch,
  insertNextOutboxStatement,
  materializationGuardSql,
  materializationGuardValues,
  pageOutboxId,
  readSweepValue,
  requiredChangesAssertion,
  stableId,
} from "./statements";

export async function finalizeMaterializedOutput(
  db: D1Database,
  item: MaterializationItemRow
) {
  const counts = await db
    .prepare(
      `SELECT output.organization_count,output.contact_count,output.scope_count,
              (SELECT COALESCE(SUM(processed_count),0)
                 FROM country_sweep_materialization_items counted
                WHERE counted.output_id=output.id
                  AND counted.kind='organizations_chunk') processed_organizations,
              (SELECT COALESCE(SUM(processed_count),0)
                 FROM country_sweep_materialization_items counted
                WHERE counted.output_id=output.id
                  AND counted.kind='contacts_chunk') processed_contacts,
              (SELECT COALESCE(SUM(processed_count),0)
                 FROM country_sweep_materialization_items counted
                WHERE counted.output_id=output.id
                  AND counted.kind='scopes_chunk') processed_scopes,
              (SELECT COUNT(*) FROM country_sweep_output_organizations p
                WHERE p.output_id=output.id) provenance_organizations,
              (SELECT COUNT(*) FROM country_sweep_output_contacts p
                WHERE p.output_id=output.id) provenance_contacts,
              (SELECT COUNT(*) FROM country_sweep_output_scopes p
                WHERE p.output_id=output.id) provenance_scopes,
              (SELECT COALESCE(SUM(inserted_count),0)
                 FROM country_sweep_materialization_items counted
                WHERE counted.output_id=output.id
                  AND counted.kind='scopes_chunk') inserted_scopes,
              (SELECT COUNT(*) FROM country_sweep_materialization_items sibling
                WHERE sibling.output_id=output.id AND sibling.id<>?
                  AND sibling.status<>'completed') unfinished
         FROM country_sweep_outputs output WHERE output.id=?`
    )
    .bind(item.id, item.output_id)
    .first<Record<string, number>>();
  if (
    counts?.unfinished !== 0 ||
    counts.processed_organizations !== counts.organization_count ||
    counts.processed_contacts !== counts.contact_count ||
    counts.processed_scopes !== counts.scope_count ||
    counts.provenance_organizations !== counts.organization_count ||
    counts.provenance_contacts !== counts.contact_count ||
    counts.provenance_scopes !== counts.scope_count
  ) {
    throw new Error("Country output materialization counts are incomplete");
  }
  const auditInput = JSON.stringify({
    countryCode: await readSweepValue(db, item.sweep_id, "country_code"),
    countryName: await readSweepValue(db, item.sweep_id, "country_name"),
    phase: "coverage_audit",
    progress: { completedTaskId: item.task_id },
  });
  const audit = {
    id: await stableId("country-coverage-task", item.sweep_id, item.task_id),
    inputHash: await sha256Hex(auditInput),
    inputJson: auditInput,
    scopeKey: `coverage:after:${item.task_id}`,
  };
  const terminalAudit =
    item.phase === "coverage_audit" && counts.inserted_scopes === 0;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE country_sweep_outputs
            SET status='materialized',
                materialized_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND status='materializing' AND ${materializationGuardSql(
            "country_sweep_outputs.id"
          )}`
      )
      .bind(item.output_id, ...materializationGuardValues(item)),
    requiredChangesAssertion(db, 1),
    db
      .prepare(
        `UPDATE country_sweep_tasks
            SET status='completed',error_code='',error_detail='',
                completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND sweep_id=? AND status='materializing'
            AND accepted_output_id=?`
      )
      .bind(item.task_id, item.sweep_id, item.output_id),
    requiredChangesAssertion(db, 1),
  ];
  if (item.phase !== "coverage_audit") {
    statements.push(
      db
        .prepare(
          `INSERT INTO country_sweep_tasks
            (id,sweep_id,phase,scope_key,status,input_json,input_hash,
             created_at,updated_at)
           SELECT ?,?,'coverage_audit',?,'queued',?,?,
                  strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                  strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE NOT EXISTS (
              SELECT 1 FROM country_sweep_tasks active
               WHERE active.sweep_id=? AND active.id<>?
                 AND active.phase IN ('discovery','verification')
                 AND active.status IN ('queued','claimed','materializing')
            )
              AND NOT EXISTS (
                SELECT 1 FROM country_sweep_tasks audit
                 WHERE audit.sweep_id=? AND audit.phase='coverage_audit'
                   AND audit.status IN ('queued','claimed','materializing')
              )
           ON CONFLICT(sweep_id,phase,scope_key) DO NOTHING`
        )
        .bind(
          audit.id,
          item.sweep_id,
          audit.scopeKey,
          audit.inputJson,
          audit.inputHash,
          item.sweep_id,
          item.task_id,
          item.sweep_id
        )
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE country_sweeps
            SET status=CASE
                  WHEN ?=1 AND NOT EXISTS (
                    SELECT 1 FROM country_sweep_tasks active
                     WHERE active.sweep_id=country_sweeps.id
                       AND active.status IN ('queued','claimed','materializing')
                  ) THEN CASE WHEN EXISTS (
                    SELECT 1 FROM country_sweep_tasks failed
                     WHERE failed.sweep_id=country_sweeps.id
                       AND failed.status='failed'
                       AND failed.phase IN ('discovery','verification')
                  ) THEN 'completed_with_gaps' ELSE 'completed' END
                  ELSE 'running' END,
                task_total=(SELECT COUNT(*) FROM country_sweep_tasks counted
                  WHERE counted.sweep_id=country_sweeps.id),
                task_completed=(SELECT COUNT(*) FROM country_sweep_tasks counted
                  WHERE counted.sweep_id=country_sweeps.id
                    AND counted.status='completed'),
                task_failed=(SELECT COUNT(*) FROM country_sweep_tasks counted
                  WHERE counted.sweep_id=country_sweeps.id
                    AND counted.status='failed'),
                missing_scope_count=(SELECT COUNT(*)
                  FROM country_sweep_tasks counted
                  WHERE counted.sweep_id=country_sweeps.id
                    AND counted.status='failed'
                    AND counted.phase IN ('discovery','verification')),
                completed_at=CASE WHEN ?=1 AND NOT EXISTS (
                  SELECT 1 FROM country_sweep_tasks active
                   WHERE active.sweep_id=country_sweeps.id
                     AND active.status IN ('queued','claimed','materializing')
                ) THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND status='running'`
      )
      .bind(terminalAudit ? 1 : 0, terminalAudit ? 1 : 0, item.sweep_id),
    requiredChangesAssertion(db, 1),
    completeFinalizerItemStatement(db, item),
    requiredChangesAssertion(db, 1)
  );
  await guardedBatch(db, statements);
}

export async function recordMaterializationFailure(
  db: D1Database,
  item: MaterializationItemRow,
  error: unknown,
  mode: "expired" | "runtime" = "runtime"
) {
  const detail = error instanceof Error ? error.message : String(error);
  const retry = item.attempt_count < item.max_attempts;
  const auditInput = JSON.stringify({
    countryCode: item.country_code,
    countryName: await readSweepValue(db, item.sweep_id, "country_name"),
    phase: "coverage_audit",
    progress: { failedTaskId: item.task_id },
  });
  const audit = {
    id: await stableId("country-coverage-task", item.sweep_id, item.task_id),
    inputHash: await sha256Hex(auditInput),
    inputJson: auditInput,
    scopeKey: `coverage:after:${item.task_id}`,
  };
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE country_sweep_materialization_items
            SET status=?,lease_owner=NULL,lease_token=NULL,
                lease_expires_at=NULL,error_code='materialization_failed',
                error_detail=?,completed_at=CASE WHEN ?=1 THEN NULL ELSE
                  strftime('%Y-%m-%dT%H:%M:%fZ','now') END,
                updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id=? AND output_id=? AND status='processing'
            AND attempt_count=? AND lease_token=?
            ${
              mode === "expired"
                ? "AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
                : ""
            }`
      )
      .bind(
        retry ? "queued" : "failed",
        detail.slice(0, 4000),
        retry ? 1 : 0,
        item.id,
        item.output_id,
        item.attempt_count,
        item.lease_token
      ),
    requiredChangesAssertion(db, 1),
  ];
  if (retry) {
    statements.push(
      insertNextOutboxStatement(
        db,
        item.output_id,
        mode === "expired" ? expiredLeaseOutboxId(item) : pageOutboxId(item),
        item.id
      ),
      requiredChangesAssertion(db, 1)
    );
  } else {
    statements.push(
      db
        .prepare(
          `UPDATE country_sweep_outputs
              SET status='failed',error_code='materialization_failed',
                  error_detail=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id=? AND status IN ('accepted','materializing')`
        )
        .bind(detail.slice(0, 4000), item.output_id),
      requiredChangesAssertion(db, 1)
    );
    statements.push(
      db
        .prepare(
          `UPDATE country_sweep_tasks
              SET status='failed',error_code='materialization_failed',
                  error_detail=?,completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id=? AND sweep_id=? AND status='materializing'
              AND accepted_output_id=?`
        )
        .bind(
          detail.slice(0, 4000),
          item.task_id,
          item.sweep_id,
          item.output_id
        ),
      requiredChangesAssertion(db, 1)
    );
    if (item.phase !== "coverage_audit") {
      statements.push(
        db
          .prepare(
            `INSERT INTO country_sweep_tasks
              (id,sweep_id,phase,scope_key,status,input_json,input_hash,
               created_at,updated_at)
             SELECT ?,?,'coverage_audit',?,'queued',?,?,
                    strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                    strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE NOT EXISTS (
                SELECT 1 FROM country_sweep_tasks active
                 WHERE active.sweep_id=?
                   AND active.phase IN ('discovery','verification')
                   AND active.status IN ('queued','claimed','materializing')
              )
                AND NOT EXISTS (
                  SELECT 1 FROM country_sweep_tasks active_audit
                   WHERE active_audit.sweep_id=?
                     AND active_audit.phase='coverage_audit'
                     AND active_audit.status IN (
                       'queued','claimed','materializing'
                     )
                )
             ON CONFLICT(sweep_id,phase,scope_key) DO NOTHING`
          )
          .bind(
            audit.id,
            item.sweep_id,
            audit.scopeKey,
            audit.inputJson,
            audit.inputHash,
            item.sweep_id,
            item.sweep_id
          )
      );
    }
    statements.push(
      db
        .prepare(
          `UPDATE country_sweeps
              SET status=CASE WHEN ?='coverage_audit' THEN 'failed'
                    ELSE 'running' END,
                  task_total=(SELECT COUNT(*) FROM country_sweep_tasks counted
                    WHERE counted.sweep_id=country_sweeps.id),
                  task_completed=(SELECT COUNT(*) FROM country_sweep_tasks counted
                    WHERE counted.sweep_id=country_sweeps.id
                      AND counted.status='completed'),
                  task_failed=(SELECT COUNT(*) FROM country_sweep_tasks counted
                    WHERE counted.sweep_id=country_sweeps.id
                      AND counted.status='failed'),
                  missing_scope_count=(SELECT COUNT(*)
                    FROM country_sweep_tasks counted
                    WHERE counted.sweep_id=country_sweeps.id
                      AND counted.status='failed'
                      AND counted.phase IN ('discovery','verification')),
                  error_detail=CASE WHEN ?='coverage_audit' THEN ?
                    ELSE error_detail END,
                  completed_at=CASE WHEN ?='coverage_audit' THEN
                    strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
                  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id=? AND status='running'`
        )
        .bind(
          item.phase,
          item.phase,
          detail.slice(0, 4000),
          item.phase,
          item.sweep_id
        ),
      requiredChangesAssertion(db, 1)
    );
  }
  await guardedBatch(db, statements);
}
