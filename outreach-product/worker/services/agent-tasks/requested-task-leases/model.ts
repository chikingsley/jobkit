import type { AgentTaskFailureCode } from "../../../../src/features/agents/schema";
import { AGENT_TASK_LEASE_MS, type PreparedAgentTask } from "../contracts";

const LEASE_MINUTES = AGENT_TASK_LEASE_MS / 60_000;

export const LEASE_SQL_MODIFIER = `+${LEASE_MINUTES.toString()} minutes`;

export const AGENT_TASK_REAPER_LIMIT = 1;

export type RequestedAgentTaskSpecification = Omit<
  PreparedAgentTask,
  "attemptNumber" | "leaseExpiresAt" | "leaseToken" | "runId"
> & {
  sourceHash: string;
};

export interface RequestedAgentTaskClaimContext {
  attemptNumber: number;
  leaseToken: string;
  requestId: string;
  runId: string;
  runnerId: string;
  taskType: string;
  userId: string;
}

export interface RequestedAgentTaskFailureContext
  extends RequestedAgentTaskClaimContext {
  errorCode: AgentTaskFailureCode | "lease_expired" | "runner_revoked";
  errorDetail: string;
  mode: "expiry" | "revocation" | "runner";
}

export interface ActiveRequestedPairRow {
  attempt_count: number;
  error_detail: string;
  id: string;
  input_json: string;
  lease_token: string;
  max_attempts: number;
  run_id: string;
  runner_id: string;
  runner_revoked_at?: string | null;
  subject_id: string;
  task_type: string;
  user_id: string;
}
