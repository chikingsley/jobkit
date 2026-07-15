import { generateText, Output } from "ai";
import { z } from "zod";
import type { Profile } from "../../src/features/profile/schema";
import type { AppEnv } from "../env";
import type { JobImport } from "../schemas";
import {
  APPLICATION_MESSAGE_INSTRUCTIONS,
  validateApplicationMessage,
} from "./application-message-policy";
import { type AiModelSelection, createAiModel } from "./model-catalog";

const DraftOutputSchema = z
  .object({
    message: z.string().min(100).max(5000),
    summary: z.string().min(1).max(500),
  })
  .strict();

// Cerebras structured output rejects JSON Schema string-length keywords. Keep
// the provider schema portable, then enforce the stricter limits after parsing.
const ProviderDraftOutputSchema = z
  .object({
    message: z.string(),
    summary: z.string(),
  })
  .strict();

export interface GeneratedApplicationMessage
  extends z.infer<typeof DraftOutputSchema> {
  modelId: string;
  provider: "cerebras" | "mistral";
}

export class ApplicationMessageGenerationError extends Error {}

export function generateApplicationMessage(
  env: AppEnv,
  model: AiModelSelection,
  job: JobImport,
  profile: Profile,
  styleGuidance: string[] = []
): Promise<GeneratedApplicationMessage> {
  const signature = signatureFor(profile);
  return runModel(env, model, {
    job,
    profile,
    request: "Write a new application message.",
    requiredEnding: `Best,\n${signature}`,
    styleGuidance,
  });
}

export function reviseApplicationMessage(
  env: AppEnv,
  model: AiModelSelection,
  job: JobImport,
  profile: Profile,
  currentMessage: string,
  revisionInstruction: string,
  styleGuidance: string[] = []
): Promise<GeneratedApplicationMessage> {
  const signature = signatureFor(profile);
  return runModel(env, model, {
    currentMessage,
    job,
    profile,
    request:
      "Revise the current message according to revisionInstruction while preserving every rule.",
    requiredEnding: `Best,\n${signature}`,
    revisionInstruction,
    styleGuidance,
  });
}

async function runModel(
  env: AppEnv,
  selection: AiModelSelection,
  input: Record<string, unknown> & { requiredEnding: string }
): Promise<GeneratedApplicationMessage> {
  const model = createAiModel(env, selection);
  try {
    const result = await generateText({
      instructions: APPLICATION_MESSAGE_INSTRUCTIONS,
      maxOutputTokens: 1200,
      maxRetries: 2,
      model,
      output: Output.object({
        description: "A truthful job application and its tailoring summary",
        name: "job_application_draft",
        schema: ProviderDraftOutputSchema,
      }),
      prompt: JSON.stringify(input),
      providerOptions:
        selection.provider === "cerebras" && selection.modelId === "zai-glm-4.7"
          ? { cerebras: { reasoningEffort: "none" } }
          : undefined,
      temperature: 0.2,
      timeout: { totalMs: 45_000 },
    });
    const output = DraftOutputSchema.parse(result.output);
    const message = validateApplicationMessage(
      output.message,
      input.requiredEnding
    );
    return {
      message,
      modelId: selection.modelId,
      provider: selection.provider,
      summary: output.summary.trim(),
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        event: "draft_generation_failed",
        model: selection.modelId,
        provider: selection.provider,
      })
    );
    throw new ApplicationMessageGenerationError(
      `Application-message generation failed using ${selection.provider}/${selection.modelId}`,
      { cause: error }
    );
  }
}

function signatureFor(profile: Profile): string {
  const surname = profile.fullName.trim().split(/\s+/).at(-1) ?? "";
  return `${profile.preferredName} ${surname}`.trim();
}
