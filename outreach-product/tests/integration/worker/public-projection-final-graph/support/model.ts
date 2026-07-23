import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";

export interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

export interface PositionFixture {
  inputHash: string;
  itemId: string;
  listingId: string;
  sourcePositionId: string;
}

export const testEnv = env as TestEnv;

export const timestamp = "2026-07-22T12:00:00.000Z";

export const SAME_RUN_INPUT_SCAN_PATTERN = /SCAN (?:left_input|right_input)/u;
