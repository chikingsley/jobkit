import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runStructuredAgent } from "../../cli/lib/structured-agent";
import {
  parseTestLabOutput,
  testLabModel,
  testLabOutputJsonSchema,
  testLabPrompt,
} from "../../src/agent-tasks/test-lab";
import { TEST_LAB_CASES, type TestLabCase } from "../../src/test-lab/corpus";
import { mapConcurrent } from "../jina/real/concurrency";
import { rerankCase } from "../jina/real/jina-client";

interface ProviderRun {
  error?: string;
  id: string;
  latencyMs: number;
  orderedIds?: string[];
}

export async function runProfileReranking(commandArguments: string[]) {
  const { values } = parseArgs({
    args: commandArguments,
    options: {
      concurrency: { default: "3", type: "string" },
      count: { default: "20", type: "string" },
      output: { type: "string" },
    },
    strict: true,
  });
  const count = positiveInteger(values.count, "count");
  const concurrency = positiveInteger(values.concurrency, "concurrency");
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    throw new Error("JINA_API_KEY is required for reranking evaluation");
  }
  const cases = TEST_LAB_CASES.filter(
    (testCase) => testCase.capability === "reranking"
  ).slice(0, count);
  if (cases.length !== count) {
    throw new Error(
      `Only ${cases.length} profile reranking cases are available`
    );
  }
  const [jina, codex] = await Promise.all([
    mapConcurrent(cases, concurrency, (testCase) =>
      runJinaCase(apiKey, testCase)
    ),
    mapConcurrent(cases, concurrency, runCodexCase),
  ]);
  const summary = {
    codex: summarize(cases, codex),
    jina: summarize(cases, jina),
  };
  const outputPath = resolve(
    values.output ??
      `experiments/onboarding/artifacts/profile-reranking-${count}-${Date.now()}.json`
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        cases,
        generatedAt: new Date().toISOString(),
        protocol: { concurrency, count },
        providers: { codex, jina },
        summary,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  console.log(JSON.stringify({ outputPath, summary }, null, 2));
}

async function runJinaCase(
  apiKey: string,
  testCase: TestLabCase
): Promise<ProviderRun> {
  const documents = Array.isArray(testCase.input.documents)
    ? testCase.input.documents.flatMap((document) => {
        if (
          document &&
          typeof document === "object" &&
          "id" in document &&
          "text" in document &&
          typeof document.id === "string" &&
          typeof document.text === "string"
        ) {
          return [{ id: document.id, text: document.text }];
        }
        return [];
      })
    : [];
  const query =
    typeof testCase.input.query === "string" ? testCase.input.query : "";
  const result = await rerankCase(apiKey, {
    documents,
    expectedId: "",
    id: testCase.id,
    query,
  });
  if ("error" in result) {
    return {
      error: result.error,
      id: result.id,
      latencyMs: result.latencyMs,
    };
  }
  return {
    id: result.id,
    latencyMs: result.latencyMs,
    orderedIds: result.output.orderedIds,
  };
}

async function runCodexCase(testCase: TestLabCase): Promise<ProviderRun> {
  const started = performance.now();
  const configuration = testLabModel(testCase);
  try {
    const raw = await runStructuredAgent({
      effort: configuration.reasoningEffort,
      model: configuration.model,
      outputSchema: testLabOutputJsonSchema(testCase),
      prompt: testLabPrompt(testCase, null),
      timeoutMs: 300_000,
      webSearch: configuration.webSearch,
    });
    const output = parseTestLabOutput(testCase, JSON.parse(raw)) as {
      orderedIds: string[];
    };
    return {
      id: testCase.id,
      latencyMs: Math.round(performance.now() - started),
      orderedIds: output.orderedIds,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      id: testCase.id,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

function summarize(cases: TestLabCase[], runs: ProviderRun[]) {
  const expectedById = new Map(
    cases.map((testCase) => [
      testCase.id,
      Array.isArray(testCase.expected.orderedIds)
        ? testCase.expected.orderedIds.filter(
            (value): value is string => typeof value === "string"
          )
        : [],
    ])
  );
  const scored = runs.map((run) => {
    const expected = expectedById.get(run.id) ?? [];
    const ordered = run.orderedIds ?? [];
    const expectedFirst = expected[0] ?? "";
    const rank = ordered.indexOf(expectedFirst);
    return {
      exactOrder:
        expected.length === ordered.length &&
        expected.every((id, index) => ordered[index] === id),
      id: run.id,
      latencyMs: run.latencyMs,
      topRank: rank < 0 ? null : rank + 1,
    };
  });
  return {
    exactOrder: scored.filter((item) => item.exactOrder).length,
    meanLatencyMs: mean(scored.map((item) => item.latencyMs)),
    top1: scored.filter((item) => item.topRank === 1).length,
    top3: scored.filter((item) => item.topRank !== null && item.topRank <= 3)
      .length,
    total: scored.length,
  };
}

function mean(values: number[]) {
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function positiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}
