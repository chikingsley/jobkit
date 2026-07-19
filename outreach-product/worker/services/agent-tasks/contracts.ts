export const AGENT_TASK_LEASE_MS = 30 * 60 * 1000;

export interface AgentTaskRunRow {
  model: string;
  source_hash: string;
  source_task_id: string;
  status: string;
  task_type: string;
}

export interface PreparedAgentTask {
  leaseExpiresAt: string;
  model: string;
  outputSchema: Record<string, unknown>;
  prompt: string;
  promptVersion: string;
  reasoningEffort: "high" | "low" | "medium" | "xhigh";
  runId: string;
  taskType: string;
  webSearch: "disabled" | "live";
}

export type AgentTaskFamily =
  | "application_message"
  | "country_sweep"
  | "job_match_facts"
  | "job_position"
  | "profile_import";

export class AgentTaskError extends Error {
  readonly status: 401 | 404 | 409;

  constructor(message: string, status: 401 | 404 | 409) {
    super(message);
    this.status = status;
  }
}
