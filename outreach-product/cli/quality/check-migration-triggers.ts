import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { file } from "bun";

/**
 * The D1 HTTP API's statement splitter (api-version 2026-07-23) fails on
 * CASE...END expressions inside CREATE TRIGGER bodies: it mistakes the END of
 * the CASE expression for the END of the trigger. Trigger guards must use the
 * single-statement form instead:
 *
 *   SELECT RAISE(ABORT,'message') WHERE condition;
 *
 * Migrations written before this guard existed already shipped to production
 * through a compatible apply path and stay grandfathered; every new migration
 * must use the splitter-safe form.
 */
const GRANDFATHERED_MIGRATIONS = new Set([
  "0048_public_job_entities.sql",
  "0049_public_projection_runs.sql",
  "0051_public_projection_duplicate_comparisons.sql",
  "0052_agent_task_attempt_leases.sql",
  "0053_public_job_read_model.sql",
  "0054_country_sweep_task_leases.sql",
  "0055_public_projection_canonical_resolution.sql",
  "0056_country_sweep_materialization.sql",
  "0060_public_projection_final_input_guards.sql",
  "0061_public_projection_final_seal_guards.sql",
  "0062_public_projection_final_immutability.sql",
  "0063_public_projection_candidates_and_promotions.sql",
  "0068_reset_successful_projection_page_attempts.sql",
]);

const TRIGGER_PATTERN = /create\s+(?:temp(?:orary)?\s+)?trigger/giu;
const CASE_PATTERN = /(?<![\w'".])case(?![\w'".])/iu;
const BEGIN_PATTERN = /(?<![\w'".])begin(?![\w'".])/iu;
const END_PATTERN = /(?<![\w'".])end(?![\w'".])\s*;/iu;

function stripSqlNoise(sql: string) {
  return sql
    .replace(/--[^\n]*/gu, "")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/'(?:[^']|'')*'/gu, "''");
}

/** Returns the body of every CREATE TRIGGER statement in the migration. */
function triggerBodies(sql: string) {
  const cleaned = stripSqlNoise(sql);
  const bodies: string[] = [];
  for (const match of cleaned.matchAll(TRIGGER_PATTERN)) {
    const begin = cleaned.slice(match.index).search(BEGIN_PATTERN);
    if (begin < 0) {
      continue;
    }
    const bodyStart = match.index + begin;
    const end = cleaned.slice(bodyStart).search(END_PATTERN);
    bodies.push(
      end < 0
        ? cleaned.slice(bodyStart)
        : cleaned.slice(bodyStart, bodyStart + end)
    );
  }
  return bodies;
}

export function migrationTriggerViolations(name: string, sql: string) {
  if (GRANDFATHERED_MIGRATIONS.has(name)) {
    return [];
  }
  return triggerBodies(sql).flatMap((body, index) =>
    CASE_PATTERN.test(body) ? [{ migration: name, trigger: index + 1 }] : []
  );
}

async function main() {
  const migrationsDir = resolve(import.meta.dir, "../../migrations");
  const names = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const sources = await Promise.all(
    names.map(async (name) => ({
      name,
      sql: await file(resolve(migrationsDir, name)).text(),
    }))
  );
  const violations = sources.flatMap(({ name, sql }) =>
    migrationTriggerViolations(name, sql)
  );
  if (violations.length > 0) {
    console.error(
      "CASE found inside CREATE TRIGGER bodies. The D1 HTTP API statement " +
        "splitter cannot parse CASE...END in trigger bodies; use " +
        "\"SELECT RAISE(ABORT,'msg') WHERE cond;\" instead:"
    );
    for (const violation of violations) {
      console.error(`  ${violation.migration} (trigger #${violation.trigger})`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `All ${names.length} migrations keep CASE out of new trigger bodies.`
  );
}

if (import.meta.main) {
  await main();
}
