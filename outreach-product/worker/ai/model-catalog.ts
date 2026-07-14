import { createCerebras } from "@ai-sdk/cerebras";
import { createMistral } from "@ai-sdk/mistral";
import type { LanguageModel } from "ai";
import type { AppEnv } from "../env";

export type AiModelProvider = "cerebras" | "mistral";

export interface AiModelSelection {
  modelId: string;
  provider: AiModelProvider;
}

interface ApplicationMessageModelDefinition extends AiModelSelection {
  label: string;
  reasoning: boolean;
}

export const APPLICATION_MESSAGE_MODELS = [
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
    label: "Mistral Medium 3.5",
    modelId: "mistral-medium-2604",
    provider: "mistral",
    reasoning: true,
  },
  {
    label: "Mistral Small 4",
    modelId: "mistral-small-2603",
    provider: "mistral",
    reasoning: true,
  },
  {
    label: "Mistral Large 3",
    modelId: "mistral-large-2512",
    provider: "mistral",
    reasoning: false,
  },
] as const satisfies readonly ApplicationMessageModelDefinition[];

export const DEFAULT_APPLICATION_MESSAGE_MODEL = {
  modelId: "gemma-4-31b",
  provider: "cerebras",
} as const satisfies AiModelSelection;

export function requireApplicationMessageModel(selection: {
  modelId: string;
  provider: string;
}): ApplicationMessageModelDefinition {
  const model = APPLICATION_MESSAGE_MODELS.find(
    (candidate) =>
      candidate.provider === selection.provider &&
      candidate.modelId === selection.modelId
  );
  if (!model) {
    throw new Error(
      `Unsupported application-message model: ${selection.provider}/${selection.modelId}`
    );
  }
  return model;
}

export function createApplicationMessageModel(
  env: AppEnv,
  selection: AiModelSelection
): LanguageModel {
  const model = requireApplicationMessageModel(selection);
  if (model.provider === "cerebras") {
    return createCerebras({ apiKey: env.CEREBRAS_API_KEY })(model.modelId);
  }
  return createMistral({ apiKey: env.MISTRAL_API_KEY })(model.modelId);
}
