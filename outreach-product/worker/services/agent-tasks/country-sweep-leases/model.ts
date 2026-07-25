import type { AgentTaskFailureCode } from "../../../../src/features/agents/schema";
import { AGENT_TASK_LEASE_MS } from "../contracts";

const LEASE_MINUTES = AGENT_TASK_LEASE_MS / 60_000;

export const LEASE_SQL_MODIFIER = `+${LEASE_MINUTES.toString()} minutes`;

export const LEGACY_UNHASHED_INPUT = "0".repeat(64);

export const COUNTRY_TASK_REAPER_LIMIT = 1;

export interface CountryTaskCandidateRow {
  attempt_count: number;
  country_code: string;
  country_name: string;
  id: string;
  input_hash: string;
  input_json: string;
  max_attempts: number;
  phase: "coverage_audit" | "discovery" | "verification";
  scope_key: string;
  sweep_id: string;
}

export interface CountryTaskLeaseContext {
  attemptNumber: number;
  leaseToken: string;
  outputId: string;
  runId: string;
  runnerId: string;
  sourceHash: string;
  sweepId: string;
  taskId: string;
  taskType: string;
  userId: string;
}

export interface CountryTaskFailureContext extends CountryTaskLeaseContext {
  errorCode: AgentTaskFailureCode | "lease_expired" | "runner_revoked";
  errorDetail: string;
  mode: "expiry" | "revocation" | "runner";
}

export const RETRYABLE_COUNTRY_FAILURES = new Set<
  CountryTaskFailureContext["errorCode"]
>([
  "d1_unavailable",
  "provider_transport",
  "provider_unavailable",
  "r2_unavailable",
  "runner_failure",
]);

export interface ActiveCountryTaskPairRow {
  attempt_count: number;
  country_code: string;
  country_name: string;
  input_hash: string;
  lease_token: string;
  max_attempts: number;
  output_id: string;
  phase: "coverage_audit" | "discovery" | "verification";
  run_id: string;
  runner_id: string;
  runner_revoked_at: string | null;
  sweep_id: string;
  task_id: string;
  user_id: string;
}
