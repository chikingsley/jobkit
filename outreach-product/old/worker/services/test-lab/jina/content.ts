import type { TestLabCase } from "../../../../src/test-lab/corpus";
import type { AppEnv } from "../../../env";
import { jinaText } from "./client";
import type { JinaExecutionResult } from "./contracts";
import { requiredString } from "./inputs";

const URL_PATTERN = /https?:\/\/[^\s)\]}>"']+/giu;

export async function readUrlCase(env: AppEnv, testCase: TestLabCase) {
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

export async function searchWebCase(env: AppEnv, testCase: TestLabCase) {
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

export function urlsFromText(text: string) {
  return text.match(URL_PATTERN) ?? [];
}
