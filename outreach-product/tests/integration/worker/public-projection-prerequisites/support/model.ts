import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { InventoryJob } from "../../../../../src/features/inventory/schema";

export const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

export interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

export interface ProjectionRunResponse {
  run: { id: string };
}

export interface SeededListing {
  job: InventoryJob;
  materialHash: string;
  materialJson: string;
  sourceHash: string;
}

export interface ListingItemRow {
  attempt_count: number;
  checkpoint_json: string;
  error_code: string;
  id: string;
  stage: string;
  status: string;
}

export const testEnv = env as TestEnv;

export const timestamp = "2026-07-22T12:00:00.000Z";

export const futureTimestamp = "2099-07-22T12:00:00.000Z";

export async function resetPrerequisiteDb() {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);

  await testEnv.DB.prepare(
    `DELETE FROM public_projection_duplicate_work
      WHERE run_id NOT IN (
        SELECT run_id FROM public_projection_duplicate_batches
      )`
  ).run();

  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `DELETE FROM public_projection_position_items
        WHERE run_id NOT IN (
          SELECT run_id FROM public_projection_duplicate_work
        )`
    ),
    testEnv.DB.prepare(
      `DELETE FROM public_projection_listing_items
        WHERE run_id NOT IN (
          SELECT run_id FROM public_projection_duplicate_work
        )`
    ),
    testEnv.DB.prepare(
      `DELETE FROM public_projection_runs
        WHERE id NOT IN (
          SELECT run_id FROM public_projection_duplicate_work
        )`
    ),
  ]);
}
