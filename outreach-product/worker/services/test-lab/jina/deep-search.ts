import { z } from "zod";
import type { TestLabCase } from "../../../../src/test-lab/corpus";
import type { AppEnv } from "../../../env";
import { TestLabError } from "../errors";
import {
  jinaHeaders,
  MAX_PROVIDER_RESPONSE_CHARACTERS,
  providerFailure,
} from "./client";
import { urlsFromText } from "./content";
import type { JinaExecutionResult } from "./contracts";
import { optionalStringArray, requiredString } from "./inputs";

const JINA_DEEPSEARCH_URL = "https://deepsearch.jina.ai/v1/chat/completions";
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

interface DeepSearchState {
  answer: string;
  buffer: string;
  urls: Set<string>;
  usage: Record<string, unknown>;
}

export async function deepSearchCase(env: AppEnv, testCase: TestLabCase) {
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
  for (const url of urlsFromText(state.answer)) {
    state.urls.add(url);
  }
  return {
    answer: state.answer,
    urls: [...state.urls].slice(0, 100),
    usage: state.usage,
  };
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
    if (event.usage) {
      state.usage = event.usage;
    }
  }
}
