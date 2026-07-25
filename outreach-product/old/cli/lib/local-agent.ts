import { runHttpStructuredAgent } from "./http-agent";
import type { StructuredAgentOptions } from "./structured-agent";

export const DEFAULT_LOCAL_LLM_BASE_URL = "http://127.0.0.1:8030/v1";
export const DEFAULT_LOCAL_LLM_MODEL = "qwen35-9b-ud-q4-k-xl";
export const DEFAULT_LOCAL_LLM_KEY_FILE =
  "/home/simon/docker/llamacpp-llm/secrets/llamacpp-api-key";
export const DEFAULT_LOCAL_LLM_MAX_TOKENS = 4096;

const TRAILING_SLASHES_PATTERN = /\/+$/u;

export interface LocalAgentConfig {
  baseUrl: string;
  keyFile: string;
  maxTokens: number;
  thinking: boolean;
}

export function resolveLocalAgentConfig(
  env: Record<string, string | undefined> = process.env
): LocalAgentConfig {
  const baseUrl =
    env.JOBKIT_LOCAL_LLM_BASE_URL?.trim() || DEFAULT_LOCAL_LLM_BASE_URL;
  return {
    baseUrl: baseUrl.replace(TRAILING_SLASHES_PATTERN, ""),
    keyFile:
      env.JOBKIT_LOCAL_LLM_KEY_FILE?.trim() || DEFAULT_LOCAL_LLM_KEY_FILE,
    maxTokens: resolveMaxTokens(env.JOBKIT_LOCAL_LLM_MAX_TOKENS),
    thinking: resolveThinking(env.JOBKIT_LOCAL_LLM_THINKING),
  };
}

function resolveThinking(raw: string | undefined) {
  const value = raw?.trim().toLowerCase();
  if (!value || value === "0" || value === "false") {
    return false;
  }
  if (value === "1" || value === "true") {
    return true;
  }
  throw new Error(
    `JOBKIT_LOCAL_LLM_THINKING must be "0", "1", "true", or "false", received ${JSON.stringify(raw)}`
  );
}

export function resolveLocalDefaultModel(
  env: Record<string, string | undefined> = process.env
) {
  return env.JOBKIT_LOCAL_LLM_MODEL?.trim() || DEFAULT_LOCAL_LLM_MODEL;
}

function resolveMaxTokens(raw: string | undefined) {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return DEFAULT_LOCAL_LLM_MAX_TOKENS;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(
      `JOBKIT_LOCAL_LLM_MAX_TOKENS must be a positive integer, received ${JSON.stringify(raw)}`
    );
  }
  return parsed;
}

export function runLocalStructuredAgent(options: StructuredAgentOptions) {
  const config = resolveLocalAgentConfig();
  return runHttpStructuredAgent(
    {
      maxTokens: config.maxTokens,
      model: options.model,
      provider: {
        baseUrl: config.baseUrl,
        keyFile: config.keyFile,
        kind: "openai-http",
      },
      thinking: config.thinking,
    },
    options
  );
}
