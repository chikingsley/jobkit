import { z } from "zod";

export const AgentCapabilitySchema = z.enum([
  "research",
  "extraction",
  "drafting",
  "evaluation",
  "operations",
]);

export const AgentPairingCreateSchema = z
  .object({
    capabilities: z.array(AgentCapabilitySchema).min(1),
  })
  .strict();

export const AgentPairingExchangeSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    codexVersion: z.string().trim().max(120).default(""),
    runnerName: z.string().trim().min(1).max(120),
  })
  .strict();

export const AgentTaskClaimSchema = z
  .object({
    runnerVersion: z.string().trim().max(120).default(""),
  })
  .strict();

export const AgentTaskCompletionSchema = z
  .object({ leaseToken: z.string().min(1), output: z.unknown() })
  .strict();

export const AgentTaskFailureCodeSchema = z.enum([
  "provider_transport",
  "provider_unavailable",
  "r2_unavailable",
  "d1_unavailable",
  "schema_invalid",
  "evidence_invalid",
  "source_changed",
  "policy_violation",
  "invalid_input",
  "safety_rejection",
  "runner_failure",
]);

export const AgentTaskFailureSchema = z
  .object({
    error: z.string().trim().min(1).max(4000),
    errorCode: AgentTaskFailureCodeSchema.default("runner_failure"),
    leaseToken: z.string().min(1),
  })
  .strict();

export const AgentTaskHeartbeatSchema = z
  .object({ leaseToken: z.string().min(1) })
  .strict();

export const AgentTaskArtifactSchema = z
  .object({
    contentType: z.string().min(1),
    filename: z.string().min(1),
    id: z.string().min(1),
    purpose: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sizeBytes: z.number().int().positive(),
    url: z.string().startsWith("/api/agent-tasks/"),
  })
  .strict();

export const AgentTaskEnvelopeSchema = z
  .object({
    artifacts: z.array(AgentTaskArtifactSchema).max(20).default([]),
    attemptNumber: z.number().int().positive(),
    leaseExpiresAt: z.iso.datetime(),
    leaseToken: z.string().min(1),
    model: z.string().min(1),
    outputSchema: z.record(z.string(), z.unknown()),
    prompt: z.string().min(1),
    promptVersion: z.string().min(1),
    reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]),
    runId: z.string().min(1),
    taskType: z.string().min(1),
    webSearch: z.enum(["disabled", "live"]),
  })
  .strict();

export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;
export type AgentTaskFailureCode = z.infer<typeof AgentTaskFailureCodeSchema>;
export type AgentTaskEnvelope = z.infer<typeof AgentTaskEnvelopeSchema>;
