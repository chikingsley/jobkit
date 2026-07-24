import { MODEL_PROVIDERS } from "../../src/model/registry";
import { runHttpStructuredAgent } from "./http-agent";
import type { StructuredAgentOptions } from "./structured-agent";

export const DEFAULT_MISTRAL_MODEL = "mistral-large-latest";
const DEFAULT_MISTRAL_MAX_TOKENS = 4096;

export function resolveMistralDefaultModel(
  env: Record<string, string | undefined> = process.env
) {
  return env.JOBKIT_MISTRAL_MODEL?.trim() || DEFAULT_MISTRAL_MODEL;
}

function resolveMistralMaxTokens(
  env: Record<string, string | undefined> = process.env
) {
  const trimmed = env.JOBKIT_MISTRAL_MAX_TOKENS?.trim();
  if (!trimmed) {
    return DEFAULT_MISTRAL_MAX_TOKENS;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(
      `JOBKIT_MISTRAL_MAX_TOKENS must be a positive integer, received ${JSON.stringify(env.JOBKIT_MISTRAL_MAX_TOKENS)}`
    );
  }
  return parsed;
}

export function runMistralStructuredAgent(options: StructuredAgentOptions) {
  return runHttpStructuredAgent(
    {
      maxTokens: resolveMistralMaxTokens(),
      model: options.model,
      provider: MODEL_PROVIDERS.mistral,
      thinking: false,
    },
    options
  );
}
