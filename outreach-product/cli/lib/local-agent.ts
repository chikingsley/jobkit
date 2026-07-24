import { readFile } from "node:fs/promises";
import type {
  StructuredAgentOptions,
  StructuredAgentUsage,
} from "./structured-agent";
import { extractJsonObjectText, structuredJsonPrompt } from "./structured-json";

export const DEFAULT_LOCAL_LLM_BASE_URL = "http://127.0.0.1:8030/v1";
export const DEFAULT_LOCAL_LLM_MODEL = "qwen35-9b-ud-q4-k-xl";
export const DEFAULT_LOCAL_LLM_KEY_FILE =
  "/home/simon/docker/llamacpp-llm/secrets/llamacpp-api-key";
export const DEFAULT_LOCAL_LLM_MAX_TOKENS = 4096;

const CONNECTION_RETRY_ATTEMPTS = 3;
const CONNECTION_RETRY_DELAY_MS = 2000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
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

export interface LocalCompletion {
  content: string;
  usage: StructuredAgentUsage | null;
}

export function extractLocalCompletion(payload: unknown): LocalCompletion {
  if (!(payload && typeof payload === "object")) {
    throw new Error("local completion response was not a JSON object");
  }
  const choices = Reflect.get(payload, "choices");
  const choice: unknown = Array.isArray(choices) ? choices[0] : undefined;
  if (!(choice && typeof choice === "object")) {
    throw new Error("local completion response contained no choices");
  }
  const message = Reflect.get(choice, "message");
  const content =
    message && typeof message === "object"
      ? Reflect.get(message, "content")
      : undefined;
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) {
    throw completionWithoutContentError(Reflect.get(choice, "finish_reason"));
  }
  return { content: text, usage: extractUsage(Reflect.get(payload, "usage")) };
}

function completionWithoutContentError(finishReason: unknown) {
  if (finishReason === "length") {
    return new Error(
      "local model reached max_tokens before emitting final content; raise JOBKIT_LOCAL_LLM_MAX_TOKENS"
    );
  }
  return new Error(
    `local completion contained no final content (finish_reason ${JSON.stringify(finishReason ?? null)})`
  );
}

function extractUsage(usage: unknown): StructuredAgentUsage | null {
  if (!(usage && typeof usage === "object")) {
    return null;
  }
  const completionTokens = Reflect.get(usage, "completion_tokens");
  const promptTokens = Reflect.get(usage, "prompt_tokens");
  const totalTokens = Reflect.get(usage, "total_tokens");
  if (
    typeof completionTokens !== "number" ||
    typeof promptTokens !== "number" ||
    typeof totalTokens !== "number"
  ) {
    return null;
  }
  return { completionTokens, promptTokens, totalTokens };
}

export async function runLocalStructuredAgent(options: StructuredAgentOptions) {
  if ((options.artifacts ?? []).length > 0) {
    throw new Error(
      "The local engine does not support image artifacts; leave vision tasks queued for a hosted engine"
    );
  }
  const config = resolveLocalAgentConfig();
  const key = (await readFile(config.keyFile, "utf8")).trim();
  const body = JSON.stringify({
    chat_template_kwargs: { enable_thinking: config.thinking },
    max_tokens: config.maxTokens,
    messages: [{ content: structuredJsonPrompt(options), role: "user" }],
    model: options.model,
    stream: false,
    temperature: 0,
  });
  const payload = await postChatCompletion(
    config,
    key,
    body,
    options.timeoutMs
  );
  const completion = extractLocalCompletion(payload);
  if (completion.usage) {
    options.onUsage?.(completion.usage);
  }
  return extractJsonObjectText(completion.content);
}

async function postChatCompletion(
  config: LocalAgentConfig,
  key: string,
  body: string,
  timeoutMs: number
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; ; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `local completion timed out after ${Math.round(timeoutMs / 1000)} seconds`
      );
    }
    // biome-ignore lint/performance/noAwaitInLoops: Retry attempts are strictly sequential.
    const outcome = await attemptChatCompletion(config, key, body, remainingMs);
    if (outcome.ok) {
      return outcome.payload;
    }
    if (!outcome.retryable || attempt >= CONNECTION_RETRY_ATTEMPTS) {
      throw outcome.error;
    }
    await sleep(
      Math.min(CONNECTION_RETRY_DELAY_MS, Math.max(deadline - Date.now(), 0))
    );
  }
}

type CompletionAttempt =
  | { ok: false; error: Error; retryable: boolean }
  | { ok: true; payload: unknown };

async function attemptChatCompletion(
  config: LocalAgentConfig,
  key: string,
  body: string,
  remainingMs: number
): Promise<CompletionAttempt> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      body,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(remainingMs),
    });
  } catch (error) {
    return connectionFailure(config.baseUrl, error);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    return {
      error: new Error(
        `local llm server responded ${response.status}: ${detail || "no body"}`
      ),
      ok: false,
      retryable: RETRYABLE_STATUS_CODES.has(response.status),
    };
  }
  try {
    return { ok: true, payload: await response.json() };
  } catch (error) {
    return {
      error: new Error(
        `local llm server returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
      ),
      ok: false,
      retryable: false,
    };
  }
}

function connectionFailure(baseUrl: string, error: unknown): CompletionAttempt {
  if (error instanceof Error && error.name === "TimeoutError") {
    return {
      error: new Error(`local completion timed out against ${baseUrl}`),
      ok: false,
      retryable: false,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    error: new Error(
      `local llm server at ${baseUrl} is unreachable: ${message}`
    ),
    ok: false,
    retryable: true,
  };
}

function sleep(milliseconds: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}
