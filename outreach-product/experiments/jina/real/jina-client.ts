import { createHash } from "node:crypto";
import { mapConcurrent } from "./concurrency";
import type {
  DeduplicationCase,
  ReaderCase,
  RealCapability,
  RealCapabilityCorpus,
  SearchCase,
  TimedResult,
} from "./contracts";
import { cosineSimilarity } from "./text";

const API_BASE = "https://api.jina.ai/v1";
const URL_PATTERN = /https?:\/\/[^\s)\]}>"']+/giu;
const MAX_TEXT_CHARACTERS = 1_000_000;

export interface JinaRunOptions {
  apiKey: string;
  capabilities: Set<RealCapability>;
  concurrency: number;
  embeddingDimensions: number[];
  embeddingModels: string[];
  repeats: number;
}

export async function runJinaEvaluation(
  corpus: RealCapabilityCorpus,
  options: JinaRunOptions
) {
  const reader = options.capabilities.has("reader")
    ? await mapConcurrent(corpus.reader, options.concurrency, (testCase) =>
        readCase(options.apiKey, testCase)
      )
    : [];
  const search = options.capabilities.has("search")
    ? await mapConcurrent(corpus.search, options.concurrency, (testCase) =>
        searchCase(options.apiKey, testCase)
      )
    : [];
  const reranking = options.capabilities.has("reranking")
    ? await mapConcurrent(corpus.reranking, options.concurrency, (testCase) =>
        rerankCase(options.apiKey, testCase)
      )
    : [];
  const embeddingRuns = options.embeddingModels.flatMap((model) =>
    options.embeddingDimensions.flatMap((dimensions) =>
      Array.from({ length: options.repeats }, (_, index) => ({
        dimensions,
        model,
        repeat: index + 1,
      }))
    )
  );
  const deduplication = options.capabilities.has("deduplication")
    ? await mapConcurrent(embeddingRuns, 1, ({ dimensions, model, repeat }) =>
        embedCandidateRetrievalCorpus(options.apiKey, corpus.deduplication, {
          concurrency: options.concurrency,
          dimensions,
          model,
          repeat,
        })
      )
    : [];
  return { deduplication, reader, reranking, search };
}

async function readCase(apiKey: string, testCase: ReaderCase) {
  const started = performance.now();
  try {
    const text = await getText(
      apiKey,
      `https://r.jina.ai/${testCase.url}`,
      60_000
    );
    return {
      id: testCase.id,
      latencyMs: Math.round(performance.now() - started),
      output: { text },
    } satisfies TimedResult<{ text: string }>;
  } catch (error) {
    return failed(testCase.id, started, error);
  }
}

async function searchCase(apiKey: string, testCase: SearchCase) {
  const started = performance.now();
  try {
    const text = await getText(
      apiKey,
      `https://s.jina.ai/${encodeURIComponent(testCase.query)}`,
      60_000
    );
    return {
      id: testCase.id,
      latencyMs: Math.round(performance.now() - started),
      output: {
        text,
        urls: [...new Set(text.match(URL_PATTERN) ?? [])].slice(0, 20),
      },
    } satisfies TimedResult<{ text: string; urls: string[] }>;
  } catch (error) {
    return failed(testCase.id, started, error);
  }
}

export async function rerankCase(
  apiKey: string,
  testCase: RealCapabilityCorpus["reranking"][number]
) {
  const started = performance.now();
  try {
    const response = await postJson<{
      model?: string;
      results?: Array<{ index: number; relevance_score: number }>;
      usage?: Record<string, unknown>;
    }>(apiKey, `${API_BASE}/rerank`, {
      documents: testCase.documents.map((document) => document.text),
      model: "jina-reranker-v3",
      query: testCase.query,
      return_documents: false,
    });
    const scores = (response.results ?? []).map((result) => ({
      id: testCase.documents[result.index]?.id ?? "",
      score: result.relevance_score,
    }));
    return {
      id: testCase.id,
      latencyMs: Math.round(performance.now() - started),
      output: {
        model: response.model ?? "jina-reranker-v3",
        orderedIds: scores.map((item) => item.id),
        scores,
        usage: response.usage ?? {},
      },
    } satisfies TimedResult<{
      model: string;
      orderedIds: string[];
      scores: Array<{ id: string; score: number }>;
      usage: Record<string, unknown>;
    }>;
  } catch (error) {
    return failed(testCase.id, started, error);
  }
}

export async function embedCandidateRetrievalCorpus(
  apiKey: string,
  cases: Pick<DeduplicationCase, "anchor" | "candidates" | "id">[],
  options: {
    concurrency: number;
    dimensions: number;
    model: string;
    repeat: number;
  }
) {
  const documents = uniqueDeduplicationDocuments(cases);
  const chunks = chunk(documents, 64);
  const started = performance.now();
  const responses = await mapConcurrent(
    chunks,
    options.concurrency,
    async (items) => {
      const response = await postJson<{
        data?: Array<{ embedding: number[]; index: number }>;
        model?: string;
        usage?: Record<string, unknown>;
      }>(apiKey, `${API_BASE}/embeddings`, {
        dimensions: options.dimensions,
        embedding_type: "float",
        input: items.map((item) => item.text),
        model: options.model,
        normalized: true,
        task: "text-matching",
      });
      return {
        items,
        model: response.model ?? options.model,
        values: response.data ?? [],
      };
    }
  );
  const vectors = new Map<string, number[]>();
  for (const response of responses) {
    for (const value of response.values) {
      const item = response.items[value.index];
      if (item) {
        vectors.set(item.key, value.embedding);
      }
    }
  }
  return {
    dimensions: options.dimensions,
    latencyMs: Math.round(performance.now() - started),
    model: options.model,
    repeat: options.repeat,
    results: cases.map((testCase) => {
      const anchor = vectors.get(documentKey(testCase.anchor.text)) ?? [];
      const scores = testCase.candidates
        .map((candidate) => ({
          id: candidate.id,
          score: cosineSimilarity(
            anchor,
            vectors.get(documentKey(candidate.text)) ?? []
          ),
        }))
        .toSorted((left, right) => right.score - left.score);
      return { id: testCase.id, nearestId: scores[0]?.id ?? "", scores };
    }),
  };
}

function uniqueDeduplicationDocuments(
  cases: Pick<DeduplicationCase, "anchor" | "candidates">[]
) {
  const documents = new Map<string, { key: string; text: string }>();
  for (const testCase of cases) {
    for (const document of [testCase.anchor, ...testCase.candidates]) {
      const key = documentKey(document.text);
      documents.set(key, { key, text: document.text });
    }
  }
  return [...documents.values()];
}

function documentKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function getText(apiKey: string, url: string, timeoutMs: number) {
  const response = await fetch(url, {
    headers: headers(apiKey, "text/plain"),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Jina HTTP ${response.status}`);
  }
  const text = await response.text();
  if (text.length > MAX_TEXT_CHARACTERS) {
    throw new Error(`Jina output exceeded ${MAX_TEXT_CHARACTERS} characters`);
  }
  return text;
}

async function postJson<T>(apiKey: string, url: string, body: unknown) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: headers(apiKey, "application/json"),
    method: "POST",
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    throw new Error(
      `Jina HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`
    );
  }
  return (await response.json()) as T;
}

function headers(apiKey: string, accept: string) {
  return {
    accept,
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "x-no-cache": "true",
  };
}

function failed(id: string, started: number, error: unknown) {
  return {
    error: error instanceof Error ? error.message : String(error),
    id,
    latencyMs: Math.round(performance.now() - started),
  };
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
