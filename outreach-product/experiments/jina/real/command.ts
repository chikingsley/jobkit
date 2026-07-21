import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { JINA_EXPERIMENT_MODELS } from "../catalog";
import { runCodexEvaluation } from "./codex-client";
import type { RealCapability } from "./contracts";
import { buildRealCapabilityCorpus } from "./corpus";
import { runJinaEvaluation } from "./jina-client";
import { summarizeCodexEvaluation, summarizeJinaEvaluation } from "./metrics";

const DEFAULT_OUTPUT = `experiments/jina/artifacts/real-capabilities-${new Date()
  .toISOString()
  .replaceAll(/[:.]/gu, "-")}.json`;
const REAL_CAPABILITIES = [
  "deduplication",
  "reader",
  "reranking",
  "search",
] as const;

export async function runRealCapabilityCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      capabilities: {
        default: "reader,search,reranking,deduplication",
        type: "string",
      },
      concurrency: { default: "5", type: "string" },
      "database-path": { type: "string" },
      "embedding-dimensions": { default: "256", type: "string" },
      "embedding-models": {
        default: JINA_EXPERIMENT_MODELS.map((model) => model.apiModel).join(
          ","
        ),
        type: "string",
      },
      output: { default: DEFAULT_OUTPUT, type: "string" },
      providers: { default: "jina", type: "string" },
      repeats: { default: "3", type: "string" },
      size: { default: "100", type: "string" },
    },
    strict: true,
  });
  const providers = new Set(
    values.providers.split(",").map((value) => value.trim())
  );
  const capabilities = new Set(
    values.capabilities.split(",").map((value) => value.trim())
  ) as Set<RealCapability>;
  for (const capability of capabilities) {
    if (!new Set<string>(REAL_CAPABILITIES).has(capability)) {
      throw new Error(`Unknown real-evaluation capability: ${capability}`);
    }
  }
  for (const provider of providers) {
    if (!(provider === "codex" || provider === "jina")) {
      throw new Error(`Unknown real-evaluation provider: ${provider}`);
    }
  }
  const apiKey = process.env.JINA_API_KEY;
  if (providers.has("jina") && !apiKey) {
    throw new Error("JINA_API_KEY is required for Jina evaluation");
  }
  const size = positiveInteger(values.size, "size");
  const concurrency = positiveInteger(values.concurrency, "concurrency");
  const repeats = positiveInteger(values.repeats, "repeats");
  const corpus = buildRealCapabilityCorpus({
    databasePath: values["database-path"],
    size,
  });
  assertCorpusSize(corpus, size, capabilities);
  const jina = providers.has("jina")
    ? await runJinaEvaluation(corpus, {
        apiKey: apiKey as string,
        capabilities,
        concurrency,
        embeddingDimensions: values["embedding-dimensions"]
          .split(",")
          .map((value) => positiveInteger(value.trim(), "embedding dimension")),
        embeddingModels: values["embedding-models"]
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        repeats,
      })
    : undefined;
  const codex = providers.has("codex")
    ? await runCodexEvaluation(corpus, concurrency, capabilities)
    : undefined;
  const result = {
    corpus,
    generatedAt: new Date().toISOString(),
    protocol: {
      capabilities: [...capabilities],
      concurrency,
      embeddingDimensions: values["embedding-dimensions"]
        .split(",")
        .map((value) => positiveInteger(value.trim(), "embedding dimension")),
      repeats,
      requestedCasesPerCapability: size,
      requestedProviders: [...providers],
    },
    providers: { codex, jina },
    summary: {
      codex: codex ? summarizeCodexEvaluation(corpus, codex) : undefined,
      jina: jina ? summarizeJinaEvaluation(corpus, jina) : undefined,
    },
  };
  const outputPath = resolve(values.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, summary: result.summary }, null, 2));
}

function positiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function assertCorpusSize(
  corpus: ReturnType<typeof buildRealCapabilityCorpus>,
  expected: number,
  capabilities: Set<RealCapability>
) {
  const counts = {
    deduplication: corpus.deduplication.length,
    reader: corpus.reader.length,
    reranking: corpus.reranking.length,
    search: corpus.search.length,
  };
  const entries = Object.entries(counts) as [RealCapability, number][];
  const incomplete = entries.filter(
    ([capability, count]) => capabilities.has(capability) && count !== expected
  );
  if (incomplete.length > 0) {
    throw new Error(
      `Real corpus is incomplete: ${incomplete.map(([name, count]) => `${name}=${count}/${expected}`).join(", ")}`
    );
  }
}
