import { createCerebras } from "@ai-sdk/cerebras";
import { createMistral } from "@ai-sdk/mistral";
import type { AppEnv } from "../env";

export interface DraftModel {
  id: string;
  provider: "cerebras" | "mistral";
  value: ReturnType<ReturnType<typeof createCerebras>>;
}

export function draftModel(env: AppEnv): DraftModel {
  if (env.DRAFT_MODEL_PROVIDER === "cerebras") {
    return {
      id: env.CEREBRAS_DRAFT_MODEL,
      provider: "cerebras",
      value: createCerebras({ apiKey: env.CEREBRAS_API_KEY })(
        env.CEREBRAS_DRAFT_MODEL
      ),
    };
  }
  if (env.DRAFT_MODEL_PROVIDER === "mistral") {
    return {
      id: env.MISTRAL_DRAFT_MODEL,
      provider: "mistral",
      value: createMistral({ apiKey: env.MISTRAL_API_KEY })(
        env.MISTRAL_DRAFT_MODEL
      ),
    };
  }
  throw new Error(
    `Unsupported draft model provider: ${env.DRAFT_MODEL_PROVIDER}`
  );
}
