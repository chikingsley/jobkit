// The one OpenAI-compatible chat call. Every openai-http provider (Mistral, the
// local llama server, any future hosted model) goes through this. The caller
// resolves the API key so the same code runs in the Worker and the CLI runner.

export interface ModelUsage {
  completionTokens: number;
  promptTokens: number;
  totalTokens: number;
}

export interface ChatCompletion {
  content: string;
  usage: ModelUsage | null;
}

export interface ChatRequest {
  apiKey: string;
  baseUrl: string;
  maxTokens: number;
  model: string;
  prompt: string;
  thinking?: boolean;
  timeoutMs?: number;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const TRAILING_SLASHES = /\/+$/u;

type ChatAttempt =
  | { ok: true; completion: ChatCompletion }
  | { ok: false; error: Error; retryable: boolean };

export async function callOpenAiChat(
  request: ChatRequest
): Promise<ChatCompletion> {
  const url = `${request.baseUrl.replace(TRAILING_SLASHES, "")}/chat/completions`;
  const body = JSON.stringify({
    chat_template_kwargs: { enable_thinking: request.thinking ?? false },
    max_tokens: request.maxTokens,
    messages: [{ content: request.prompt, role: "user" }],
    model: request.model,
    stream: false,
    temperature: 0,
  });
  let lastError: Error = new Error("model call failed");
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: retry attempts are strictly sequential.
    const outcome = await attemptChat(url, request, body);
    if (outcome.ok) {
      return outcome.completion;
    }
    lastError = outcome.error;
    if (!(outcome.retryable && attempt < RETRY_ATTEMPTS)) {
      throw outcome.error;
    }
    await delay(RETRY_DELAY_MS * attempt);
  }
  throw lastError;
}

async function attemptChat(
  url: string,
  request: ChatRequest,
  body: string
): Promise<ChatAttempt> {
  let response: Response;
  try {
    response = await fetch(url, {
      body,
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: request.timeoutMs
        ? AbortSignal.timeout(request.timeoutMs)
        : undefined,
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      ok: false,
      retryable:
        error instanceof Error &&
        (error.name === "TimeoutError" || error.message.includes("fetch")),
    };
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    return {
      error: new Error(`model HTTP ${response.status}: ${detail}`),
      ok: false,
      retryable: RETRYABLE_STATUS_CODES.has(response.status),
    };
  }
  return { completion: extractCompletion(await response.json()), ok: true };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractCompletion(payload: unknown): ChatCompletion {
  if (!(payload && typeof payload === "object")) {
    throw new Error("model response was not a JSON object");
  }
  const choices = Reflect.get(payload, "choices");
  const choice: unknown = Array.isArray(choices) ? choices[0] : undefined;
  if (!(choice && typeof choice === "object")) {
    throw new Error("model response contained no choices");
  }
  const message = Reflect.get(choice, "message");
  const rawContent =
    message && typeof message === "object"
      ? Reflect.get(message, "content")
      : undefined;
  const content = typeof rawContent === "string" ? rawContent.trim() : "";
  if (!content) {
    throw completionWithoutContentError(Reflect.get(choice, "finish_reason"));
  }
  return { content, usage: extractUsage(Reflect.get(payload, "usage")) };
}

function completionWithoutContentError(finishReason: unknown) {
  if (finishReason === "length") {
    return new Error(
      "model reached max_tokens before emitting final content; raise its max-tokens setting"
    );
  }
  return new Error(
    `model returned no final content (finish_reason ${JSON.stringify(finishReason ?? null)})`
  );
}

function extractUsage(usage: unknown): ModelUsage | null {
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
