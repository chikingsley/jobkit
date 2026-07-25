import { readFileSync } from "node:fs";
import { type OpenDatabase, openDatabase } from "./client";

export const BASELINE_PATH = "migrations/0000_baseline.sql";
export const LOCAL_DATABASE_PATH = ".jobkit/jobkit.sqlite";

export function createLocalDatabase(
  path = LOCAL_DATABASE_PATH,
  baselinePath = BASELINE_PATH
): OpenDatabase {
  const opened = openDatabase(path);
  opened.exec(readFileSync(baselinePath, "utf8"));
  return opened;
}
