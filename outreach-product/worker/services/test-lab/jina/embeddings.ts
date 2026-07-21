import { z } from "zod";
import type { TestLabCase } from "../../../../src/test-lab/corpus";
import type { AppEnv } from "../../../env";
import { TestLabError } from "../errors";
import { JINA_API_BASE, jinaJson } from "./client";
import type { JinaExecutionResult } from "./contracts";
import { documentCandidates, requiredString } from "./inputs";

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

export async function nearestEmbeddingCase(env: AppEnv, testCase: TestLabCase) {
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
