import { createCerebras } from "@ai-sdk/cerebras";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { AppEnv } from "../env";

export type AiProviderEnv = Pick<
  AppEnv,
  | "CEREBRAS_API_KEY"
  | "LLAMACPP_API_KEY"
  | "LLAMACPP_BASE_URL"
  | "MISTRAL_API_KEY"
>;

export type AiModelProvider = "cerebras" | "llamacpp" | "mistral";
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
  {
    label: "Local Qwen 3.5 9B",
    modelId: "qwen35-9b-ud-q4-k-xl",
    provider: "llamacpp",
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

export const JOB_FACT_EXTRACTION_FALLBACK: AiModelSelection = {
  modelId: "zai-glm-4.7",
  provider: "cerebras",
};

const MISTRAL_JOB_FACT_EXTRACTION_FALLBACK: AiModelSelection = {
  modelId: "mistral-large-latest",
  provider: "mistral",
};

export function jobFactExtractionFallback(
  selection: AiModelSelection
): AiModelSelection {
  return selection.provider === "mistral"
    ? MISTRAL_JOB_FACT_EXTRACTION_FALLBACK
    : JOB_FACT_EXTRACTION_FALLBACK;
}

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
  env: AiProviderEnv,
  selection: AiModelSelection
): LanguageModel {
  const model = requireAiModel(selection);
  if (model.provider === "cerebras") {
    return createCerebras({ apiKey: env.CEREBRAS_API_KEY })(model.modelId);
  }
  if (model.provider === "mistral") {
    return createMistral({ apiKey: env.MISTRAL_API_KEY })(model.modelId);
  }
  if (!(env.LLAMACPP_API_KEY && env.LLAMACPP_BASE_URL)) {
    throw new Error(
      "llama.cpp requires LLAMACPP_BASE_URL and LLAMACPP_API_KEY"
    );
  }
  const provider = createOpenAICompatible({
    apiKey: env.LLAMACPP_API_KEY,
    baseURL: env.LLAMACPP_BASE_URL,
    name: "llamacpp",
    supportsStructuredOutputs: true,
    transformRequestBody: (body) => {
      const existing =
        typeof body.chat_template_kwargs === "object" &&
        body.chat_template_kwargs !== null
          ? body.chat_template_kwargs
          : {};
      return {
        ...body,
        chat_template_kwargs: { ...existing, enable_thinking: false },
      };
    },
  });
  return provider.chatModel(model.modelId);
}
