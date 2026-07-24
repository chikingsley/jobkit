import { readdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { file, spawnSync } from "bun";
import { migrationTriggerViolations } from "../quality/check-migration-triggers";

const projectRoot = resolve(import.meta.dir, "../..");
const stagingDir = resolve(projectRoot, "drizzle");
const migrationsDir = resolve(projectRoot, "migrations");
const MIGRATION_NAME_PATTERN = /^(\d{4})_(.+)\.sql$/u;

function sqlFiles(directory: string): string[] {
  return readdirSync(directory).filter((name) => name.endsWith(".sql"));
}

function nextMigrationNumber(): number {
  const numbers = sqlFiles(migrationsDir)
    .map((name) => MIGRATION_NAME_PATTERN.exec(name)?.[1])
    .filter((prefix): prefix is string => prefix !== undefined)
    .map((prefix) => Number.parseInt(prefix, 10));
  return Math.max(...numbers) + 1;
}

async function promote(stagedName: string): Promise<string> {
  const stagedPath = resolve(stagingDir, stagedName);
  const sql = await file(stagedPath).text();
  const violations = migrationTriggerViolations(stagedName, sql);
  if (violations.length > 0) {
    throw new Error(
      `${stagedName} contains CASE inside a CREATE TRIGGER body; ` +
        "the D1 statement splitter rejects it. Staged file kept at " +
        `${stagedPath} for manual repair.`
    );
  }
  const baseName = stagedName.replace(MIGRATION_NAME_PATTERN, "$2");
  const number = String(nextMigrationNumber()).padStart(4, "0");
  const target = resolve(migrationsDir, `${number}_${baseName}.sql`);
  renameSync(stagedPath, target);
  return target;
}

async function main(): Promise<void> {
  const nameArguments = process.argv.slice(2);
  const before = new Set(sqlFiles(stagingDir));
  const result = spawnSync(
    ["bunx", "drizzle-kit", "generate", ...nameArguments],
    { cwd: projectRoot, stderr: "inherit", stdout: "inherit" }
  );
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode ?? 1;
    return;
  }
  const staged = sqlFiles(stagingDir).filter((name) => !before.has(name));
  if (staged.length === 0) {
    console.log("No staged migration to promote.");
    return;
  }
  if (staged.length > 1) {
    throw new Error(
      `Expected one staged migration, found ${staged.length}: ${staged.join(", ")}`
    );
  }
  const [stagedName] = staged as [string];
  const target = await promote(stagedName);
  console.log(`Promoted ${stagedName} -> ${target}`);
  console.log(
    "Apply with: bunx wrangler d1 migrations apply <database> [--local|--remote]"
  );
}

await main();
