import { readFile } from "node:fs/promises";
import { callOpenAiChat } from "../../src/model/openai-http";
import type { ModelProvider } from "../../src/model/registry";
import type { StructuredAgentOptions } from "./structured-agent";
import { extractJsonObjectText, structuredJsonPrompt } from "./structured-json";

// The single runner for every openai-http model provider (local llama, Mistral,
// any future hosted model). Engines are now just config: a provider plus a
// model name. Codex and OpenCode remain CLI engines.

export async function resolveProviderApiKey(
  provider: ModelProvider,
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  const fromEnv = provider.keyEnv ? env[provider.keyEnv]?.trim() : undefined;
  if (fromEnv) {
    return fromEnv;
  }
  if (provider.keyFile) {
    return (await readFile(provider.keyFile, "utf8")).trim();
  }
  throw new Error("model provider has no API key source (keyEnv or keyFile)");
}

export interface HttpAgentConfig {
  maxTokens: number;
  model: string;
  provider: ModelProvider;
  thinking: boolean;
}

export async function runHttpStructuredAgent(
  config: HttpAgentConfig,
  options: StructuredAgentOptions
): Promise<string> {
  if ((options.artifacts ?? []).length > 0) {
    throw new Error(
      "This model provider does not support image artifacts; leave vision tasks for a CLI engine"
    );
  }
  if (!config.provider.baseUrl) {
    throw new Error("model provider has no baseUrl");
  }
  const apiKey = await resolveProviderApiKey(config.provider);
  const completion = await callOpenAiChat({
    apiKey,
    baseUrl: config.provider.baseUrl,
    maxTokens: config.maxTokens,
    model: config.model,
    prompt: structuredJsonPrompt(options),
    thinking: config.thinking,
    timeoutMs: options.timeoutMs,
  });
  if (completion.usage) {
    options.onUsage?.(completion.usage);
  }
  return extractJsonObjectText(completion.content);
}
