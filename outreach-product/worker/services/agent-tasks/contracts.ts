export const AGENT_TASK_LEASE_MS = 30 * 60 * 1000;

export interface AgentTaskRunRow {
  attempt_number: number;
  lease_token: string;
  model: string;
  source_hash: string;
  source_task_id: string;
  status: string;
  task_type: string;
}

export interface PreparedAgentTask {
  artifacts?: PreparedAgentTaskArtifact[];
  attemptNumber: number;
  leaseExpiresAt: string;
  leaseToken: string;
  model: string;
  outputSchema: Record<string, unknown>;
  prompt: string;
  promptVersion: string;
  reasoningEffort: "high" | "low" | "medium" | "xhigh";
  runId: string;
  taskType: string;
  webSearch: "disabled" | "live";
}

export interface PreparedAgentTaskArtifact {
  contentType: string;
  filename: string;
  id: string;
  purpose: string;
  sha256: string;
  sizeBytes: number;
  url: string;
}

export type AgentTaskFamily =
  | "application_message"
  | "country_sweep"
  | "job_content"
  | "job_match_facts"
  | "job_position"
  | "profile_import"
  | "test_lab";

export class AgentTaskError extends Error {
  readonly status: 401 | 404 | 409 | 413 | 422;

  constructor(message: string, status: 401 | 404 | 409 | 413 | 422) {
    super(message);
    this.status = status;
  }
}

export class AgentTaskClaimLostError extends Error {}
