import { resolve } from "node:path";
import { buildCorpus } from "./build";
import { CORPUS_VERSION } from "./contracts";
import { exportFrozenCorpus } from "./export-frozen";
import { exportClassificationReview } from "./export-review";
import { finalizeCorpus } from "./finalize";
import { labelCorpus } from "./label";
import { corpusStatus, openCorpusLedger } from "./ledger";
import {
  CLASSIFIER_MODELS,
  type ClassifierModel,
  evaluateFrozenZeroShot,
  trainAndEvaluatePrivateClassifier,
} from "./private-classifier";

const DEFAULT_DATABASE = resolve(import.meta.dir, `${CORPUS_VERSION}.sqlite`);
const USAGE = `Manage the retained real-listing classification corpus.

Usage:
  bun run jobkit -- experiments jina corpus build [--size 200] [--database path]
  bun run jobkit -- experiments jina corpus label --pass <codex-a|codex-b> [options]
  bun run jobkit -- experiments jina corpus export-review [--output path]
  bun run jobkit -- experiments jina corpus export-frozen [--output path]
  bun run jobkit -- experiments jina corpus finalize [--review-url url]
  bun run jobkit -- experiments jina corpus evaluate-zero-shot [--output path]
  bun run jobkit -- experiments jina corpus train-evaluate [--output path]
  bun run jobkit -- experiments jina corpus status [--database path]

Classifier options:
  --model <id>          v3, v4, v5 text small, or v5 text nano (default: v3)

Label options:
  --chunk-size <count>  Listings per isolated Codex call (default: 20)
  --model <id>          Codex model (default: gpt-5.6-sol)
  --effort <level>      low, medium, high, or xhigh (default: medium)
  --database <path>     Override the ignored local SQLite ledger
`;

export async function runCorpusCommand(args: string[]) {
  const [command, ...optionArguments] = args;
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return;
  }
  const options = readOptions(optionArguments);
  const databasePath = resolve(options.get("database") ?? DEFAULT_DATABASE);
  if (command === "build") {
    const result = await buildCorpus({
      databasePath,
      sampleSize: positiveInteger(options.get("size") ?? "200"),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "label") {
    const passId = options.get("pass");
    if (!(passId === "codex-a" || passId === "codex-b")) {
      throw new Error("--pass must be codex-a or codex-b");
    }
    const effort = effortLevel(options.get("effort") ?? "medium");
    const result = await labelCorpus({
      chunkSize: positiveInteger(options.get("chunk-size") ?? "20"),
      databasePath,
      effort,
      model: options.get("model") ?? "gpt-5.6-sol",
      passId,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "status") {
    const database = openCorpusLedger(databasePath);
    try {
      console.log(
        JSON.stringify(corpusStatus(database, CORPUS_VERSION), null, 2)
      );
    } finally {
      database.close();
    }
    return;
  }
  if (command === "finalize") {
    await runFinalize(databasePath, options);
    return;
  }
  if (command === "train-evaluate") {
    await runTrainEvaluate(databasePath, options);
    return;
  }
  if (command === "evaluate-zero-shot") {
    await runEvaluateZeroShot(databasePath, options);
    return;
  }
  if (command === "export-review") {
    const outputPath = resolve(
      options.get("output") ??
        resolve(
          import.meta.dir,
          "../../../src/test-lab/classification-review-corpus.json"
        )
    );
    const result = await exportClassificationReview({
      corpusVersion: CORPUS_VERSION,
      databasePath,
      outputPath,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "export-frozen") {
    await runExportFrozen(databasePath, options);
    return;
  }
  throw new Error(`Unknown corpus command: ${command}`);
}

async function runExportFrozen(
  databasePath: string,
  options: Map<string, string>
) {
  const result = await exportFrozenCorpus({
    corpusVersion: CORPUS_VERSION,
    databasePath,
    outputPath: resolve(
      options.get("output") ??
        resolve(import.meta.dir, `${CORPUS_VERSION}.parquet`)
    ),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runFinalize(databasePath: string, options: Map<string, string>) {
  const result = await finalizeCorpus({
    corpusVersion: CORPUS_VERSION,
    databasePath,
    reviewUrl:
      options.get("review-url") ??
      "http://127.0.0.1:4173/api/test-lab/classification-review",
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runTrainEvaluate(
  databasePath: string,
  options: Map<string, string>
) {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    throw new Error("JINA_API_KEY is required for private classifier training");
  }
  const result = await trainAndEvaluatePrivateClassifier({
    apiKey,
    artifactPath: options.get("output"),
    corpusVersion: CORPUS_VERSION,
    databasePath,
    labelMode: "descriptive-v1",
    model: classifierModel(options.get("model")),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runEvaluateZeroShot(
  databasePath: string,
  options: Map<string, string>
) {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    throw new Error("JINA_API_KEY is required for zero-shot evaluation");
  }
  const result = await evaluateFrozenZeroShot({
    apiKey,
    artifactPath: options.get("output"),
    corpusVersion: CORPUS_VERSION,
    databasePath,
    labelMode: "descriptive-v1",
    model: classifierModel(options.get("model")),
  });
  console.log(JSON.stringify(result, null, 2));
}

function classifierModel(value: string | undefined): ClassifierModel {
  const model = value ?? "jina-embeddings-v3";
  if (CLASSIFIER_MODELS.includes(model as ClassifierModel)) {
    return model as ClassifierModel;
  }
  throw new Error(`Unknown Jina classifier model: ${model}`);
}

function readOptions(args: string[]) {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!(flag?.startsWith("--") && value)) {
      throw new Error(`Expected --option value, received ${flag ?? "nothing"}`);
    }
    const name = flag.slice(2);
    if (options.has(name)) {
      throw new Error(`Option supplied more than once: ${flag}`);
    }
    options.set(name, value);
  }
  return options;
}

function effortLevel(value: string) {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  throw new Error(`Unknown reasoning effort: ${value}`);
}

function positiveInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received ${value}`);
  }
  return parsed;
}
