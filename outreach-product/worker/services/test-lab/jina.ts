import { z } from "zod";
import type { TestLabCase } from "../../../src/test-lab/corpus";
import type { AppEnv } from "../../env";
import { TestLabError } from "./errors";

const MAX_PROVIDER_RESPONSE_CHARACTERS = 4_000_000;
const JINA_API_BASE = "https://api.jina.ai/v1";
const JINA_DEEPSEARCH_URL = "https://deepsearch.jina.ai/v1/chat/completions";
const URL_PATTERN = /https?:\/\/[^\s)\]}>"']+/giu;

const UsageSchema = z
  .object({ total_tokens: z.number().nonnegative() })
  .passthrough();
const ClassifierResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          prediction: z.union([z.string(), z.record(z.string(), z.string())]),
          score: z.union([z.number(), z.record(z.string(), z.number())]),
        })
        .passthrough()
    ),
    usage: UsageSchema,
  })
  .passthrough();
const RerankerResponseSchema = z
  .object({
    model: z.string(),
    results: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          relevance_score: z.number(),
        })
        .passthrough()
    ),
    usage: UsageSchema,
  })
  .passthrough();
const EmbeddingResponseSchema = z
  .object({
    data: z.array(
      z
        .object({
          embedding: z.array(z.number()),
          index: z.number().int().nonnegative(),
        })
        .passthrough()
    ),
    model: z.string(),
    usage: z.record(z.string(), z.unknown()),
  })
  .passthrough();
const DeepSearchChunkSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            delta: z
              .object({
                annotations: z
                  .array(z.record(z.string(), z.unknown()))
                  .optional(),
                content: z.string().optional(),
              })
              .passthrough(),
          })
          .passthrough()
      )
      .optional(),
    usage: z.record(z.string(), z.unknown()).optional(),
    visitedURLs: z.array(z.string()).optional(),
  })
  .passthrough();

export interface JinaExecutionResult {
  model: string;
  output: Record<string, unknown>;
  provenance: Record<string, unknown>;
  usage: Record<string, unknown>;
}

export function executeJinaCase(
  env: AppEnv,
  testCase: TestLabCase
): Promise<JinaExecutionResult> {
  if (!env.JINA_API_KEY) {
    throw new TestLabError("Jina is not configured for this environment", 503);
  }
  switch (testCase.capability) {
    case "classification":
      return classify(env, testCase, "label");
    case "matching":
      return classify(env, matchingClassifierCase(testCase), "decision");
    case "reranking":
      return rerank(env, testCase);
    case "deduplication":
      return nearestEmbedding(env, testCase);
    case "reader":
      return readUrl(env, testCase);
    case "search":
      return searchWeb(env, testCase);
    case "deepsearch":
      return deepSearch(env, testCase);
    default:
      throw new TestLabError(
        `Jina does not have a promoted adapter for ${testCase.capability}`,
        409
      );
  }
}

async function classify(env: AppEnv, testCase: TestLabCase, resultKey: string) {
  const text = requiredString(testCase.input.text, "classification text");
  const labels = requiredStringArray(
    testCase.input.labels,
    "classification labels"
  );
  const model = "jina-embeddings-v5-text-small";
  const response = await jinaJson(
    env,
    `${JINA_API_BASE}/classify`,
    { input: [text], labels, model },
    ClassifierResponseSchema,
    30_000
  );
  const [prediction] = response.data;
  if (!prediction || typeof prediction.prediction !== "string") {
    throw new TestLabError(
      "Jina returned an unsupported classifier result",
      502
    );
  }
  return {
    model,
    output: { [resultKey]: prediction.prediction, score: prediction.score },
    provenance: { endpoint: `${JINA_API_BASE}/classify`, provider: "jina" },
    usage: response.usage,
  } satisfies JinaExecutionResult;
}

function matchingClassifierCase(testCase: TestLabCase): TestLabCase {
  return {
    ...testCase,
    input: {
      labels: ["match", "review", "exclude"],
      text: `Candidate facts: ${requiredString(testCase.input.candidate, "candidate facts")}\nListing requirements: ${requiredString(testCase.input.listing, "listing requirements")}`,
    },
  };
}

async function rerank(env: AppEnv, testCase: TestLabCase) {
  const query = requiredString(testCase.input.query, "reranking query");
  const documents = documentCandidates(testCase.input.documents);
  const model = "jina-reranker-v3";
  const response = await jinaJson(
    env,
    `${JINA_API_BASE}/rerank`,
    {
      documents: documents.map((document) => document.text),
      model,
      query,
      return_documents: false,
    },
    RerankerResponseSchema,
    45_000
  );
  const orderedIds = response.results
    .map((result) => documents[result.index]?.id)
    .filter(isString);
  return {
    model: response.model || model,
    output: {
      orderedIds,
      scores: response.results.map((result) => ({
        id: documents[result.index]?.id ?? "",
        score: result.relevance_score,
      })),
    },
    provenance: { endpoint: `${JINA_API_BASE}/rerank`, provider: "jina" },
    usage: response.usage,
  } satisfies JinaExecutionResult;
}

async function nearestEmbedding(env: AppEnv, testCase: TestLabCase) {
  const anchor = requiredString(testCase.input.anchor, "deduplication anchor");
  const candidates = documentCandidates(testCase.input.candidates);
  const model = "jina-embeddings-v5-text-small";
  const response = await jinaJson(
    env,
    `${JINA_API_BASE}/embeddings`,
    {
      dimensions: 256,
      embedding_type: "float",
      input: [anchor, ...candidates.map((candidate) => candidate.text)],
      model,
      normalized: true,
      task: "text-matching",
    },
    EmbeddingResponseSchema,
    45_000
  );
  const ordered = response.data.toSorted(
    (left, right) => left.index - right.index
  );
  const anchorEmbedding = ordered[0]?.embedding;
  if (!anchorEmbedding) {
    throw new TestLabError("Jina did not return the anchor embedding", 502);
  }
  const similarities = candidates
    .map((candidate, index) => ({
      id: candidate.id,
      score: cosineSimilarity(
        anchorEmbedding,
        ordered[index + 1]?.embedding ?? []
      ),
    }))
    .toSorted((left, right) => right.score - left.score);
  return {
    model: response.model || model,
    output: { nearestId: similarities[0]?.id ?? "", similarities },
    provenance: {
      dimensions: 256,
      endpoint: `${JINA_API_BASE}/embeddings`,
      provider: "jina",
      task: "text-matching",
    },
    usage: response.usage,
  } satisfies JinaExecutionResult;
}

async function readUrl(env: AppEnv, testCase: TestLabCase) {
  const url = requiredString(testCase.input.url, "Reader URL");
  const endpoint = `https://r.jina.ai/${url}`;
  const text = await jinaText(env, endpoint, 45_000);
  return {
    model: "jina-reader",
    output: { answer: text, sources: [{ title: url, url }] },
    provenance: { endpoint: "https://r.jina.ai", provider: "jina", url },
    usage: { outputCharacters: text.length },
  } satisfies JinaExecutionResult;
}

async function searchWeb(env: AppEnv, testCase: TestLabCase) {
  const query = requiredString(testCase.input.query, "search query");
  const endpoint = `https://s.jina.ai/${encodeURIComponent(query)}`;
  const text = await jinaText(env, endpoint, 45_000);
  const urls = [...new Set(text.match(URL_PATTERN) ?? [])].slice(0, 20);
  return {
    model: "jina-search",
    output: { answer: text, sources: urls.map((url) => ({ title: url, url })) },
    provenance: { endpoint: "https://s.jina.ai", provider: "jina", query },
    usage: { outputCharacters: text.length },
  } satisfies JinaExecutionResult;
}

async function deepSearch(env: AppEnv, testCase: TestLabCase) {
  const question = requiredString(
    testCase.input.question,
    "DeepSearch question"
  );
  const boostHostnames = optionalStringArray(testCase.input.goodDomains);
  const response = await fetch(JINA_DEEPSEARCH_URL, {
    body: JSON.stringify({
      boost_hostnames: boostHostnames,
      messages: [{ content: question, role: "user" }],
      model: "jina-deepsearch-v1",
      reasoning_effort: "low",
      stream: true,
    }),
    headers: jinaHeaders(env, "text/event-stream"),
    method: "POST",
    signal: AbortSignal.timeout(150_000),
  });
  if (!(response.ok && response.body)) {
    throw providerFailure("DeepSearch", response.status);
  }
  const result = await parseDeepSearchStream(response.body);
  return {
    model: "jina-deepsearch-v1",
    output: {
      answer: result.answer,
      sources: result.urls.map((url) => ({ title: url, url })),
    },
    provenance: {
      boostHostnames,
      endpoint: JINA_DEEPSEARCH_URL,
      provider: "jina",
      reasoningEffort: "low",
    },
    usage: result.usage,
  } satisfies JinaExecutionResult;
}

async function jinaJson<T>(
  env: AppEnv,
  url: string,
  body: unknown,
  schema: z.ZodType<T>,
  timeoutMs: number
) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: jinaHeaders(env, "application/json"),
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw providerFailure("Jina", response.status);
  }
  const text = await boundedText(response);
  try {
    return schema.parse(JSON.parse(text));
  } catch (error) {
    // biome-ignore lint/style/useErrorCause: TestLabError forwards this ErrorOptions cause through its constructor.
    throw new TestLabError(
      "Jina returned a response outside its documented schema",
      502,
      {
        cause: error,
      }
    );
  }
}

async function jinaText(env: AppEnv, url: string, timeoutMs: number) {
  const response = await fetch(url, {
    headers: jinaHeaders(env, "text/plain"),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw providerFailure("Jina", response.status);
  }
  return boundedText(response);
}

function jinaHeaders(env: AppEnv, accept: string) {
  return {
    accept,
    authorization: `Bearer ${env.JINA_API_KEY}`,
    "content-type": "application/json",
    "x-no-cache": "true",
  };
}

async function boundedText(response: Response) {
  const text = await response.text();
  if (text.length > MAX_PROVIDER_RESPONSE_CHARACTERS) {
    throw new TestLabError(
      "Jina response exceeded the Test Lab size limit",
      502
    );
  }
  return text;
}

async function parseDeepSearchStream(stream: ReadableStream<Uint8Array>) {
  const state: DeepSearchState = {
    answer: "",
    buffer: "",
    urls: new Set<string>(),
    usage: {},
  };
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    state.buffer += decoder.decode(chunk, { stream: true });
    const lines = state.buffer.split("\n");
    state.buffer = lines.pop() ?? "";
    consumeDeepSearchLines(lines, state);
    if (state.answer.length > MAX_PROVIDER_RESPONSE_CHARACTERS) {
      throw new TestLabError(
        "DeepSearch answer exceeded the Test Lab size limit",
        502
      );
    }
  }
  state.buffer += decoder.decode();
  consumeDeepSearchLines([state.buffer], state);
  for (const url of state.answer.match(URL_PATTERN) ?? []) {
    state.urls.add(url);
  }
  return {
    answer: state.answer,
    urls: [...state.urls].slice(0, 100),
    usage: state.usage,
  };
}

interface DeepSearchState {
  answer: string;
  buffer: string;
  urls: Set<string>;
  usage: Record<string, unknown>;
}

function consumeDeepSearchLines(lines: string[], state: DeepSearchState) {
  for (const line of lines) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") {
      continue;
    }
    const raw = line.slice(6).trim();
    if (!raw) {
      continue;
    }
    const event = DeepSearchChunkSchema.parse(JSON.parse(raw));
    state.answer += event.choices?.[0]?.delta.content ?? "";
    for (const url of event.visitedURLs ?? []) {
      state.urls.add(url);
    }
    const { usage } = event;
    if (usage) {
      state.usage = usage;
    }
  }
}

function providerFailure(provider: string, status: number) {
  return new TestLabError(
    `${provider} benchmark request failed with status ${status}`,
    502
  );
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TestLabError(`Test case is missing ${label}`, 400);
  }
  return value;
}

function optionalStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

function requiredStringArray(value: unknown, label: string) {
  const values = optionalStringArray(value);
  if (values.length === 0) {
    throw new TestLabError(`Test case is missing ${label}`, 400);
  }
  return values;
}

function documentCandidates(
  value: unknown
): Array<{ id: string; text: string }> {
  if (!Array.isArray(value)) {
    throw new TestLabError("Test case candidates are invalid", 400);
  }
  const candidates = value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as Record<string, unknown>;
    return typeof record.id === "string" && typeof record.text === "string"
      ? [{ id: record.id, text: record.text }]
      : [];
  });
  if (candidates.length === 0) {
    throw new TestLabError("Test case candidates are empty", 400);
  }
  return candidates;
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) {
    return -1;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
    leftNorm += (left[index] ?? 0) ** 2;
    rightNorm += (right[index] ?? 0) ** 2;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm) || 1);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
