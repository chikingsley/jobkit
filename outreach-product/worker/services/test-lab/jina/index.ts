import type { TestLabCase } from "../../../../src/test-lab/corpus";
import type { AppEnv } from "../../../env";
import { TestLabError } from "../errors";
import { classifyCase, classifyMatchingCase } from "./classification";
import { readUrlCase, searchWebCase } from "./content";
import type { JinaExecutionResult } from "./contracts";
import { deepSearchCase } from "./deep-search";
import { nearestEmbeddingCase } from "./embeddings";
import { rerankCase } from "./reranking";

export type { JinaExecutionResult } from "./contracts";

export function executeJinaCase(
  env: AppEnv,
  testCase: TestLabCase
): Promise<JinaExecutionResult> {
  if (!env.JINA_API_KEY) {
    throw new TestLabError("Jina is not configured for this environment", 503);
  }
  switch (testCase.capability) {
    case "classification":
      return classifyCase(env, testCase, "label");
    case "matching":
      return classifyMatchingCase(env, testCase);
    case "reranking":
      return rerankCase(env, testCase);
    case "deduplication":
      return nearestEmbeddingCase(env, testCase);
    case "reader":
      return readUrlCase(env, testCase);
    case "search":
      return searchWebCase(env, testCase);
    case "deepsearch":
      return deepSearchCase(env, testCase);
    default:
      throw new TestLabError(
        `Jina does not have a promoted adapter for ${testCase.capability}`,
        409
      );
  }
}
