import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CLASSIFICATION_LABEL_MODES,
  type ClassificationLabelMode,
} from "../../worker/services/test-lab/jina/classification";
import { classificationModels, findJinaExperimentModel } from "./catalog";
import { runClassificationExperiment } from "./classification";

const USAGE = `Run controlled Jina experiments and corpus operations.

Usage:
  bun run jobkit -- experiments jina classification [options]
  bun run jobkit -- experiments jina corpus <build|label|status> [options]
  bun run jobkit -- experiments jina entity [options]
  bun run jobkit -- experiments jina real [options]

Classification options:
  --models <ids>        Comma-separated model IDs (default: every classification model)
  --label-modes <modes> Comma-separated label modes (default: descriptive-v1)
  --repeats <count>     Runs per model and case (default: 1)
  --concurrency <count> Maximum simultaneous model requests (default: 1)
  --case-limit <count>  Limit the canonical corpus for a smoke run
  --output <path>       Write the complete JSON artifact to this path
  --help, -h            Show this help

Real-inventory options:
  --providers <ids>               Comma-separated jina,codex (default: jina)
  --capabilities <ids>            reader, search, reranking, or deduplication
  --embedding-models <ids>        Comma-separated Jina API model identifiers
  --embedding-dimensions <values> Comma-separated embedding dimensions
  --size <count>                  Cases per requested capability (default: 100)
  --repeats <count>               Embedding runs per model and dimension
  --concurrency <count>           Maximum simultaneous requests
  --output <path>                 Write the complete JSON artifact

Entity-resolution options:
  --size <count>                  Even case count, split match/no-match (default: 500)
  --model <id>                    Embedding API model (default: v5 text nano)
  --dimensions <count>            Embedding dimensions (default: 256)
  --concurrency <count>           Maximum simultaneous embedding requests
  --output <path>                 Write the complete JSON artifact
`;

const OPTION_NAMES = new Set([
  "case-limit",
  "concurrency",
  "label-modes",
  "models",
  "output",
  "repeats",
]);

const commandArguments = process.argv.slice(2);
if (commandArguments.includes("--help") || commandArguments.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

if (commandArguments[0] === "corpus") {
  const { runCorpusCommand } = await import("./corpus/command");
  await runCorpusCommand(commandArguments.slice(1));
} else if (commandArguments[0] === "entity") {
  const { runEntityResolutionCommand } = await import(
    "./entity-resolution/command"
  );
  await runEntityResolutionCommand(commandArguments.slice(1));
} else if (commandArguments[0] === "real") {
  const { runRealCapabilityCommand } = await import("./real/command");
  await runRealCapabilityCommand(commandArguments.slice(1));
} else {
  const classificationArguments =
    commandArguments[0] === "classification"
      ? commandArguments.slice(1)
      : commandArguments;
  await runClassificationCommand(classificationArguments);
}

async function runClassificationCommand(args: string[]) {
  const options = readOptions(args);
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    throw new Error("JINA_API_KEY is required for Jina experiments");
  }
  const models = options.models.map((id) => {
    const model = findJinaExperimentModel(id);
    if (!model) {
      throw new Error(`Unknown Jina experiment model: ${id}`);
    }
    if (!model.tracks.includes("text-classification")) {
      throw new Error(
        `${id} is not a text-classification model; use its embedding experiment track`
      );
    }
    return model;
  });
  const result = await runClassificationExperiment(apiKey, {
    caseLimit: options.caseLimit,
    concurrency: options.concurrency,
    labelModes: options.labelModes,
    models,
    repeats: options.repeats,
  });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) {
    const outputPath = resolve(options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, "utf8");
    console.log(`Wrote Jina experiment artifact to ${outputPath}`);
    return;
  }
  console.log(serialized);
}

interface ExperimentOptions {
  caseLimit?: number;
  concurrency: number;
  labelModes: ClassificationLabelMode[];
  models: string[];
  output?: string;
  repeats: number;
}

function readOptions(args: string[]): ExperimentOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!(flag?.startsWith("--") && value)) {
      throw new Error(`Expected --option value, received ${flag ?? "nothing"}`);
    }
    const name = flag.slice(2);
    if (!OPTION_NAMES.has(name)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    if (values.has(name)) {
      throw new Error(`Option supplied more than once: ${flag}`);
    }
    values.set(name, value);
  }
  const defaultModels = classificationModels().map((model) => model.id);
  return {
    caseLimit: optionalPositiveInteger(values.get("case-limit")),
    concurrency: positiveInteger(values.get("concurrency") ?? "1"),
    labelModes: labelModes(values.get("label-modes") ?? "descriptive-v1"),
    models: (values.get("models") ?? defaultModels.join(","))
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    output: values.get("output"),
    repeats: positiveInteger(values.get("repeats") ?? "1"),
  };
}

function labelModes(value: string): ClassificationLabelMode[] {
  const modes = value.split(",").map((mode) => mode.trim());
  for (const mode of modes) {
    if (!CLASSIFICATION_LABEL_MODES.includes(mode as ClassificationLabelMode)) {
      throw new Error(`Unknown classification label mode: ${mode}`);
    }
  }
  return modes as ClassificationLabelMode[];
}

function optionalPositiveInteger(value: string | undefined) {
  return value === undefined ? undefined : positiveInteger(value);
}

function positiveInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received ${value}`);
  }
  return parsed;
}
