import { z } from "zod";
import type { TestLabCase } from "../../../../src/test-lab/corpus";
import type { AppEnv } from "../../../env";
import { JINA_API_BASE, jinaJson } from "./client";
import type { JinaExecutionResult } from "./contracts";
import { documentCandidates, isString, requiredString } from "./inputs";

const UsageSchema = z
  .object({ total_tokens: z.number().nonnegative() })
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

export async function rerankCase(env: AppEnv, testCase: TestLabCase) {
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
  return {
    model: response.model || model,
    output: {
      orderedIds: response.results
        .map((result) => documents[result.index]?.id)
        .filter(isString),
      scores: response.results.map((result) => ({
        id: documents[result.index]?.id ?? "",
        score: result.relevance_score,
      })),
    },
    provenance: { endpoint: `${JINA_API_BASE}/rerank`, provider: "jina" },
    usage: response.usage,
  } satisfies JinaExecutionResult;
}
