import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { embedCandidateRetrievalCorpus } from "../real/jina-client";
import { buildEntityLinkCorpus } from "./corpus";
import { summarizeEntityRetrieval } from "./metrics";

const DEFAULT_OUTPUT = `experiments/jina/artifacts/entity-link-${new Date()
  .toISOString()
  .replaceAll(/[:.]/gu, "-")}.json`;

export async function runEntityResolutionCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      concurrency: { default: "5", type: "string" },
      "database-path": { type: "string" },
      dimensions: { default: "256", type: "string" },
      model: { default: "jina-embeddings-v5-text-nano", type: "string" },
      output: { default: DEFAULT_OUTPUT, type: "string" },
      size: { default: "500", type: "string" },
    },
    strict: true,
  });
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "JINA_API_KEY is required for entity-resolution evaluation"
    );
  }
  const size = positiveInteger(values.size, "size");
  const concurrency = positiveInteger(values.concurrency, "concurrency");
  const dimensions = positiveInteger(values.dimensions, "dimensions");
  const corpus = buildEntityLinkCorpus({
    databasePath: values["database-path"],
    size,
  });
  const run = await embedCandidateRetrievalCorpus(apiKey, corpus.cases, {
    concurrency,
    dimensions,
    model: values.model,
    repeat: 1,
  });
  const result = {
    corpus,
    generatedAt: new Date().toISOString(),
    protocol: {
      concurrency,
      dimensions,
      model: values.model,
      size,
    },
    provider: { jina: run },
    summary: summarizeEntityRetrieval(corpus, run.results),
  };
  const outputPath = resolve(values.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const { cases: _cases, ...summary } = result.summary;
  console.log(JSON.stringify({ outputPath, summary }, null, 2));
}

function positiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}
