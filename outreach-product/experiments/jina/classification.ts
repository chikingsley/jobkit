import {
  TEST_LAB_CASES,
  TEST_LAB_CORPUS_VERSION,
} from "../../src/test-lab/corpus";
import type { AppEnv } from "../../worker/env";
import {
  type ClassificationLabelMode,
  classifyTexts,
} from "../../worker/services/test-lab/jina/classification";
import {
  requiredString,
  requiredStringArray,
} from "../../worker/services/test-lab/jina/inputs";
import type { JinaExperimentModel } from "./catalog";
import {
  type ClassificationObservation,
  classificationMetrics,
  timingMetrics,
} from "./metrics";

interface ClassificationExperimentOptions {
  caseLimit?: number;
  concurrency: number;
  labelModes: ClassificationLabelMode[];
  models: JinaExperimentModel[];
  repeats: number;
}

interface ClassificationResult extends ClassificationObservation {
  caseId: string;
  latencyMs: number;
  repeat: number;
  score: unknown;
}

interface ClassificationFailure {
  error: string;
  latencyMs: number;
  repeat: number;
}

export async function runClassificationExperiment(
  apiKey: string,
  options: ClassificationExperimentOptions
) {
  const classificationCases = TEST_LAB_CASES.filter(
    (testCase) => testCase.capability === "classification"
  ).slice(0, options.caseLimit);
  const env = { JINA_API_KEY: apiKey } as AppEnv;
  const labels = requiredStringArray(
    classificationCases[0]?.input.labels,
    "classification labels"
  );
  const texts = classificationCases.map((testCase) =>
    requiredString(testCase.input.text, "classification text")
  );
  const experimentRuns = options.models.flatMap((model) =>
    options.labelModes.map((labelMode) => ({ labelMode, model }))
  );
  const modelResults = await mapInBatches(
    experimentRuns,
    options.concurrency,
    async ({ labelMode, model }) => {
      const failures: ClassificationFailure[] = [];
      const results: ClassificationResult[] = [];
      const batchLatencies: number[] = [];
      for (let repeat = 0; repeat < options.repeats; repeat += 1) {
        const started = performance.now();
        try {
          // biome-ignore lint/performance/noAwaitInLoops: Repeats are deliberately sequential so one model does not burst the hosted API.
          const response = await classifyTexts(
            env,
            { labels, texts },
            model.apiModel,
            labelMode
          );
          const latencyMs = Math.round(performance.now() - started);
          batchLatencies.push(latencyMs);
          for (const [index, testCase] of classificationCases.entries()) {
            const prediction = response.predictions[index];
            if (!prediction) {
              throw new Error(`Missing prediction for ${testCase.id}`);
            }
            results.push({
              actual: prediction.label,
              caseId: testCase.id,
              expected: String(testCase.expected.label ?? ""),
              latencyMs,
              repeat: repeat + 1,
              score: prediction.score,
            });
          }
        } catch (error) {
          failures.push({
            error: error instanceof Error ? error.message : String(error),
            latencyMs: Math.round(performance.now() - started),
            repeat: repeat + 1,
          });
        }
      }
      return {
        batchTimingMs: timingMetrics(batchLatencies),
        failures,
        labelMode,
        metrics: classificationMetrics(results),
        model,
        results,
      };
    }
  );
  return {
    caseCount: classificationCases.length,
    corpusVersion: TEST_LAB_CORPUS_VERSION,
    experiment: "jina-zero-shot-classification",
    generatedAt: new Date().toISOString(),
    models: modelResults,
    protocol: {
      concurrency: options.concurrency,
      labelModes: options.labelModes,
      repeats: options.repeats,
      requestShape: "one batch per model and repeat",
    },
  };
}

async function mapInBatches<Input, Output>(
  inputs: Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>
) {
  const results: Output[] = [];
  for (let offset = 0; offset < inputs.length; offset += concurrency) {
    const batch = inputs.slice(offset, offset + concurrency);
    // biome-ignore lint/performance/noAwaitInLoops: Provider concurrency is deliberately bounded per batch.
    results.push(...(await Promise.all(batch.map(operation))));
  }
  return results;
}
