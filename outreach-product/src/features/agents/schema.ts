import { z } from "zod";

export const AgentCapabilitySchema = z.enum([
  "research",
  "extraction",
  "drafting",
  "evaluation",
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
  .object({ output: z.unknown() })
  .strict();

export const AgentTaskFailureSchema = z
  .object({ error: z.string().trim().min(1).max(4000) })
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
    leaseExpiresAt: z.iso.datetime(),
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
export type AgentTaskEnvelope = z.infer<typeof AgentTaskEnvelopeSchema>;
