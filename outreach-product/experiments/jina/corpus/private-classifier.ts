import type { Database } from "bun:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { AppEnv } from "../../../worker/env";
import {
  type ClassificationLabelMode,
  classifyTexts,
} from "../../../worker/services/test-lab/jina/classification";
import {
  JINA_API_BASE,
  jinaHeaders,
  jinaJson,
} from "../../../worker/services/test-lab/jina/client";
import { classificationMetrics } from "../metrics";
import { CORPUS_LABELS, type CorpusLabel } from "./contracts";
import { SPLIT_VERSION } from "./grouping";
import { openCorpusLedger, saveClassifierExperiment } from "./ledger";

export const CLASSIFIER_MODELS = [
  "jina-embeddings-v3",
  "jina-embeddings-v4",
  "jina-embeddings-v5-text-small",
  "jina-embeddings-v5-text-nano",
] as const;
export type ClassifierModel = (typeof CLASSIFIER_MODELS)[number];
const DEFAULT_MODEL: ClassifierModel = "jina-embeddings-v3";
const NUM_ITERS = 10;
const TrainingResponseSchema = z.object({
  classifier_id: z.string().min(1),
  num_samples: z.number().int().positive(),
  usage: z.object({ total_tokens: z.number().int().nonnegative() }).optional(),
});
const TrainingErrorSchema = z.object({
  detail: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    request_id: z.string().optional(),
  }),
});
const ClassificationResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      prediction: z.union([z.string(), z.record(z.string(), z.string())]),
      score: z.union([z.number(), z.record(z.string(), z.number())]),
    })
  ),
  usage: z.object({ total_tokens: z.number().int().nonnegative() }),
});

interface DatasetRow {
  board: string;
  company: string;
  country: string;
  description: string;
  item_id: string;
  label: CorpusLabel;
  split: "held_out" | "train";
  title: string;
}

export async function evaluateFrozenZeroShot(input: {
  apiKey: string;
  artifactPath?: string;
  corpusVersion: string;
  databasePath: string;
  labelMode: ClassificationLabelMode;
  model?: ClassifierModel;
}) {
  const database = openCorpusLedger(input.databasePath);
  try {
    const heldOut = readDataset(database, input.corpusVersion).filter(
      (item) => item.split === "held_out"
    );
    const env = { JINA_API_KEY: input.apiKey } as AppEnv;
    const started = performance.now();
    const model = input.model ?? DEFAULT_MODEL;
    const response = await classifyTexts(
      env,
      {
        labels: [...CORPUS_LABELS],
        texts: heldOut.map(classifierText),
      },
      model,
      input.labelMode
    );
    const latencyMs = Math.round(performance.now() - started);
    const observations = heldOut.map((item, index) => ({
      actual: response.predictions[index]?.label ?? "",
      expected: item.label,
    }));
    const metrics = classificationMetrics(observations);
    const experimentId = `jina-zero-shot-real-${model.replace("jina-embeddings-", "")}-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}`;
    const artifactPath = resolve(
      input.artifactPath ??
        resolve(import.meta.dir, `../artifacts/${experimentId}.json`)
    );
    const artifact = {
      corpusVersion: input.corpusVersion,
      experimentId,
      generatedAt: new Date().toISOString(),
      heldOut: heldOut.map((item, index) => ({
        board: item.board,
        company: item.company,
        country: item.country,
        expected: item.label,
        itemId: item.item_id,
        prediction: response.predictions[index],
        title: item.title,
      })),
      model,
      protocol: {
        labelMode: input.labelMode,
        splitVersion: SPLIT_VERSION,
      },
      results: { latencyMs, metrics, usage: response.usage },
    };
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8"
    );
    return {
      artifactPath,
      experimentId,
      heldOutSamples: heldOut.length,
      latencyMs,
      metrics,
      usage: response.usage,
    };
  } finally {
    database.close();
  }
}

export async function trainAndEvaluatePrivateClassifier(input: {
  apiKey: string;
  artifactPath?: string;
  corpusVersion: string;
  databasePath: string;
  labelMode: ClassificationLabelMode;
  model?: ClassifierModel;
}) {
  const database = openCorpusLedger(input.databasePath);
  try {
    const dataset = readDataset(database, input.corpusVersion);
    const train = dataset.filter((item) => item.split === "train");
    const heldOut = dataset.filter((item) => item.split === "held_out");
    const env = { JINA_API_KEY: input.apiKey } as AppEnv;
    const trainingStarted = performance.now();
    const model = input.model ?? DEFAULT_MODEL;
    const training = await trainPrivateClassifier(
      env,
      model,
      train.map((item) => ({
        label: item.label,
        text: classifierText(item),
      }))
    );
    const trainingLatencyMs = Math.round(performance.now() - trainingStarted);
    if (training.num_samples !== train.length) {
      throw new Error(
        `Jina trained on ${training.num_samples} samples; expected ${train.length}`
      );
    }
    const texts = heldOut.map(classifierText);
    const fewShotStarted = performance.now();
    const fewShotResponse = await jinaJson(
      env,
      `${JINA_API_BASE}/classify`,
      { classifier_id: training.classifier_id, input: texts },
      ClassificationResponseSchema,
      60_000
    );
    const fewShotLatencyMs = Math.round(performance.now() - fewShotStarted);
    const zeroShotStarted = performance.now();
    const zeroShotResponse = await classifyTexts(
      env,
      { labels: [...CORPUS_LABELS], texts },
      model,
      input.labelMode
    );
    const zeroShotLatencyMs = Math.round(performance.now() - zeroShotStarted);
    const fewShotPredictions = orderedFewShotPredictions(
      fewShotResponse.data,
      heldOut.length
    );
    const fewShotObservations = heldOut.map((item, index) => ({
      actual: fewShotPredictions[index]?.label ?? "",
      expected: item.label,
    }));
    const zeroShotObservations = heldOut.map((item, index) => ({
      actual: zeroShotResponse.predictions[index]?.label ?? "",
      expected: item.label,
    }));
    const fewShotMetrics = classificationMetrics(fewShotObservations);
    const zeroShotMetrics = classificationMetrics(zeroShotObservations);
    const experimentId = `jina-private-${model.replace("jina-embeddings-", "")}-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}`;
    const artifactPath = resolve(
      input.artifactPath ??
        resolve(import.meta.dir, `../artifacts/${experimentId}.json`)
    );
    const artifact = {
      classifierId: training.classifier_id,
      corpusVersion: input.corpusVersion,
      experimentId,
      generatedAt: new Date().toISOString(),
      heldOut: heldOut.map((item, index) => ({
        board: item.board,
        company: item.company,
        country: item.country,
        expected: item.label,
        fewShot: fewShotPredictions[index],
        itemId: item.item_id,
        title: item.title,
        zeroShot: zeroShotResponse.predictions[index],
      })),
      model,
      protocol: {
        access: "private",
        labelMode: input.labelMode,
        num_iters: NUM_ITERS,
        splitVersion: SPLIT_VERSION,
      },
      results: {
        fewShot: {
          latencyMs: fewShotLatencyMs,
          metrics: fewShotMetrics,
          usage: fewShotResponse.usage,
        },
        training: {
          latencyMs: trainingLatencyMs,
          samples: training.num_samples,
          usage: training.usage,
        },
        zeroShot: {
          latencyMs: zeroShotLatencyMs,
          metrics: zeroShotMetrics,
          usage: zeroShotResponse.usage,
        },
      },
    };
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8"
    );
    saveClassifierExperiment(database, {
      artifactPath,
      classifierId: training.classifier_id,
      corpusVersion: input.corpusVersion,
      experimentId,
      fewShotMetrics,
      heldOutSamples: heldOut.length,
      model,
      numIters: NUM_ITERS,
      splitVersion: SPLIT_VERSION,
      trainingSamples: train.length,
      zeroShotMetrics,
    });
    return {
      artifactPath,
      experimentId,
      heldOutSamples: heldOut.length,
      metrics: { fewShot: fewShotMetrics, zeroShot: zeroShotMetrics },
      timingsMs: {
        fewShot: fewShotLatencyMs,
        training: trainingLatencyMs,
        zeroShot: zeroShotLatencyMs,
      },
      trainingSamples: train.length,
      usage: {
        fewShot: fewShotResponse.usage,
        training: training.usage,
        zeroShot: zeroShotResponse.usage,
      },
    };
  } finally {
    database.close();
  }
}

async function trainPrivateClassifier(
  env: AppEnv,
  model: ClassifierModel,
  examples: Array<{ label: CorpusLabel; text: string }>
) {
  const response = await fetch(`${JINA_API_BASE}/train`, {
    body: JSON.stringify({
      access: "private",
      input: examples,
      model,
      num_iters: NUM_ITERS,
    }),
    headers: jinaHeaders(env, "application/json"),
    method: "POST",
    signal: AbortSignal.timeout(120_000),
  });
  const responseText = await response.text();
  if (!response.ok) {
    const providerError = TrainingErrorSchema.safeParse(safeJson(responseText));
    const requestId = providerError.success
      ? providerError.data.detail.request_id
      : undefined;
    throw new Error(
      `Jina private training failed with status ${response.status}${requestId ? ` (request ${requestId})` : ""}`
    );
  }
  return TrainingResponseSchema.parse(safeJson(responseText));
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readDataset(database: Database, corpusVersion: string) {
  const rows = database
    .query(
      `SELECT i.item_id,i.board,i.title,i.company,i.country,i.description,
              f.label,s.split
         FROM corpus_items i
         JOIN corpus_final_labels f
           ON f.corpus_version=i.corpus_version AND f.item_id=i.item_id
         JOIN corpus_split_assignments s
           ON s.corpus_version=i.corpus_version AND s.item_id=i.item_id
          AND s.split_version=?
        WHERE i.corpus_version=?
        ORDER BY i.item_id`
    )
    .all(SPLIT_VERSION, corpusVersion) as DatasetRow[];
  const total = database
    .query("SELECT COUNT(*) count FROM corpus_items WHERE corpus_version=?")
    .get(corpusVersion) as { count: number };
  if (rows.length !== total.count) {
    throw new Error(
      `Frozen dataset contains ${rows.length} of ${total.count} corpus items`
    );
  }
  return rows;
}

function classifierText(item: DatasetRow) {
  return [
    `Title: ${item.title}`,
    `Organization: ${item.company}`,
    `Country: ${item.country}`,
    `Listing: ${item.description}`,
  ].join("\n");
}

function orderedFewShotPredictions(
  predictions: z.infer<typeof ClassificationResponseSchema>["data"],
  expectedCount: number
) {
  const ordered = predictions.toSorted(
    (left, right) => left.index - right.index
  );
  if (ordered.length !== expectedCount) {
    throw new Error(
      `Jina returned ${ordered.length} predictions; expected ${expectedCount}`
    );
  }
  return ordered.map((prediction) => {
    if (
      typeof prediction.prediction !== "string" ||
      !CORPUS_LABELS.includes(prediction.prediction as CorpusLabel)
    ) {
      throw new Error("Jina returned an unknown private-classifier label");
    }
    return {
      label: prediction.prediction as CorpusLabel,
      score: prediction.score,
    };
  });
}
