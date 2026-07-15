import { createCerebras } from "@ai-sdk/cerebras";
import { createMistral } from "@ai-sdk/mistral";
import type { LanguageModel } from "ai";
import type { AppEnv } from "../env";

export type AiModelProvider = "cerebras" | "mistral";
export type AiPurpose =
  | "application_message"
  | "job_fact_extraction"
  | "profile_extraction";

export interface AiModelSelection {
  modelId: string;
  provider: AiModelProvider;
}

export interface AiModelDefinition extends AiModelSelection {
  label: string;
  reasoning: boolean;
}

export const AI_MODELS = [
  {
    label: "Gemma 4 31B",
    modelId: "gemma-4-31b",
    provider: "cerebras",
    reasoning: false,
  },
  {
    label: "Z.ai GLM 4.7",
    modelId: "zai-glm-4.7",
    provider: "cerebras",
    reasoning: true,
  },
  {
    label: "GPT OSS 120B",
    modelId: "gpt-oss-120b",
    provider: "cerebras",
    reasoning: true,
  },
  {
    label: "Mistral Medium (latest)",
    modelId: "mistral-medium-latest",
    provider: "mistral",
    reasoning: true,
  },
  {
    label: "Mistral Small (latest)",
    modelId: "mistral-small-latest",
    provider: "mistral",
    reasoning: true,
  },
  {
    label: "Mistral Large (latest)",
    modelId: "mistral-large-latest",
    provider: "mistral",
    reasoning: false,
  },
] as const satisfies readonly AiModelDefinition[];

export const DEFAULT_AI_MODELS = {
  application_message: {
    modelId: "gemma-4-31b",
    provider: "cerebras",
  },
  job_fact_extraction: {
    modelId: "gemma-4-31b",
    provider: "cerebras",
  },
  profile_extraction: {
    modelId: "gpt-oss-120b",
    provider: "cerebras",
  },
} as const satisfies Record<AiPurpose, AiModelSelection>;

export function requireAiModel(selection: {
  modelId: string;
  provider: string;
}): AiModelDefinition {
  const model = AI_MODELS.find(
    (candidate) =>
      candidate.provider === selection.provider &&
      candidate.modelId === selection.modelId
  );
  if (!model) {
    throw new Error(
      `Unsupported AI model: ${selection.provider}/${selection.modelId}`
    );
  }
  return model;
}

export function createAiModel(
  env: AppEnv,
  selection: AiModelSelection
): LanguageModel {
  const model = requireAiModel(selection);
  if (model.provider === "cerebras") {
    return createCerebras({ apiKey: env.CEREBRAS_API_KEY })(model.modelId);
  }
  return createMistral({ apiKey: env.MISTRAL_API_KEY })(model.modelId);
}
