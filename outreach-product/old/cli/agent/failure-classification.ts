import type { AgentTaskFailureCode } from "../../src/features/agents/schema";
import { JobKitAgentApiError } from "./client";

export type AgentExecutionPhase =
  | "artifact"
  | "completion"
  | "execution"
  | "heartbeat"
  | "output";

export class ArtifactDownloadError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function classifyAgentTaskFailure(
  error: unknown,
  phase: AgentExecutionPhase
): AgentTaskFailureCode {
  if (error instanceof JobKitAgentApiError) {
    return classifyApiError(error);
  }
  if (error instanceof ArtifactDownloadError) {
    return classifyArtifactStatus(error.status);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (phase === "artifact") {
    return classifyArtifactMessage(message);
  }
  const phaseCodes: Record<
    Exclude<AgentExecutionPhase, "artifact">,
    AgentTaskFailureCode
  > = {
    completion: "runner_failure",
    execution: "provider_unavailable",
    heartbeat: "provider_transport",
    output: "schema_invalid",
  };
  return phaseCodes[phase];
}

function classifyApiError(error: JobKitAgentApiError): AgentTaskFailureCode {
  const statusCodes = new Map<number, AgentTaskFailureCode>([
    [400, "schema_invalid"],
    [401, "policy_violation"],
    [403, "policy_violation"],
    [409, "source_changed"],
  ]);
  if (error.status === 422) {
    return error.rejectedEvidence.length > 0
      ? "evidence_invalid"
      : "schema_invalid";
  }
  return (
    statusCodes.get(error.status) ??
    (error.status >= 500 ? "d1_unavailable" : "runner_failure")
  );
}

function classifyArtifactStatus(status: number): AgentTaskFailureCode {
  return status === 404 || status === 409 ? "source_changed" : "r2_unavailable";
}

function classifyArtifactMessage(message: string): AgentTaskFailureCode {
  if (message.includes("hash changed") || message.includes("size changed")) {
    return "source_changed";
  }
  return message.includes("does not accept")
    ? "invalid_input"
    : "r2_unavailable";
}
