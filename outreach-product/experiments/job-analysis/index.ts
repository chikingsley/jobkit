import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runStructuredAgent } from "../../cli/lib/structured-agent";
import {
  JOB_CONTENT_OUTPUT_JSON_SCHEMA,
  JOB_MATCH_FACTS_OUTPUT_JSON_SCHEMA,
  JOB_POSITION_OUTPUT_JSON_SCHEMA,
  jobContentAnalysisPrompt,
  jobMatchFactsPrompt,
  jobPositionAnalysisPrompt,
} from "../../src/agent-tasks/job-analysis";
import { JobContentAnalysisSchema } from "../../src/features/jobs/content-analysis";
import { JobPositionAnalysisSchema } from "../../src/features/jobs/position-variants";
import { JobMatchFactsSchema } from "../../src/features/matching/schema";
import {
  canonicalizeJobContentEvidence,
  unsupportedContentEvidence,
} from "../../worker/ai/job-content-extraction";
import {
  jobFactSource,
  unsupportedEvidence,
} from "../../worker/ai/job-fact-extraction";
import {
  canonicalizeJobPositionEvidence,
  unsupportedPositionEvidence,
} from "../../worker/ai/job-position-extraction";
import { mapConcurrent } from "../jina/real/concurrency";
import type {
  AnalysisCase,
  AnalysisRunResult,
  AnalysisTask,
  ModelConfiguration,
} from "./contracts";
import { readAnalysisCases } from "./corpus";
import { summarizeAnalysisRuns } from "./metrics";

const DEFAULT_MODELS: ModelConfiguration[] = [
  { effort: "low", model: "gpt-5.3-codex-spark" },
  { effort: "medium", model: "gpt-5.6-luna" },
  { effort: "medium", model: "gpt-5.6-terra" },
];

const { values } = parseArgs({
  options: {
    concurrency: { default: "3", type: "string" },
    count: { default: "3", type: "string" },
    output: { type: "string" },
  },
  strict: true,
});
const count = positiveInteger(values.count, "count");
const concurrency = positiveInteger(values.concurrency, "concurrency");
const cases = readAnalysisCases(count);
const work = DEFAULT_MODELS.flatMap((model) =>
  cases.flatMap((analysisCase) =>
    (["content", "facts", "positions"] as AnalysisTask[]).map((task) => ({
      analysisCase,
      model,
      task,
    }))
  )
);
const results = await mapConcurrent(
  work,
  concurrency,
  ({ analysisCase, model, task }) => runAnalysis(analysisCase, model, task)
);
const summary = summarizeAnalysisRuns(results, DEFAULT_MODELS, cases.length);
const outputPath = resolve(
  values.output ??
    `experiments/job-analysis/artifacts/bakeoff-${new Date().toISOString().replaceAll(":", "-")}.json`
);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      cases,
      generatedAt: new Date().toISOString(),
      protocol: { concurrency, models: DEFAULT_MODELS },
      results,
      summary,
    },
    null,
    2
  )}\n`,
  "utf8"
);
console.log(JSON.stringify({ outputPath, summary }, null, 2));

async function runAnalysis(
  analysisCase: AnalysisCase,
  configuration: ModelConfiguration,
  task: AnalysisTask
): Promise<AnalysisRunResult> {
  const started = performance.now();
  try {
    const raw = await runStructuredAgent({
      effort: configuration.effort,
      model: configuration.model,
      outputSchema: schemaFor(task),
      prompt: promptFor(task, analysisCase),
      timeoutMs: 300_000,
      webSearch: "disabled",
    });
    const source = jobFactSource(analysisCase);
    const output = parseOutput(task, JSON.parse(raw), source);
    const missingEvidence = unsupportedFor(task, output, source);
    return {
      caseId: analysisCase.id,
      evidenceQuotes: evidenceCount(task, output),
      latencyMs: Math.round(performance.now() - started),
      model: configuration.model,
      output,
      rejectedEvidence: missingEvidence,
      supportedEvidence: missingEvidence.length === 0,
      task,
    };
  } catch (error) {
    return {
      caseId: analysisCase.id,
      error: error instanceof Error ? error.message : String(error),
      evidenceQuotes: 0,
      latencyMs: Math.round(performance.now() - started),
      model: configuration.model,
      supportedEvidence: false,
      task,
    };
  }
}

function schemaFor(task: AnalysisTask) {
  if (task === "content") {
    return JOB_CONTENT_OUTPUT_JSON_SCHEMA;
  }
  return task === "facts"
    ? JOB_MATCH_FACTS_OUTPUT_JSON_SCHEMA
    : JOB_POSITION_OUTPUT_JSON_SCHEMA;
}

function promptFor(task: AnalysisTask, analysisCase: AnalysisCase) {
  if (task === "content") {
    return jobContentAnalysisPrompt(analysisCase);
  }
  return task === "facts"
    ? jobMatchFactsPrompt(analysisCase)
    : jobPositionAnalysisPrompt(analysisCase);
}

function parseOutput(task: AnalysisTask, value: unknown, source: string) {
  if (task === "content") {
    return canonicalizeJobContentEvidence(
      JobContentAnalysisSchema.parse(value),
      source
    );
  }
  if (task === "facts") {
    return JobMatchFactsSchema.parse(value);
  }
  return canonicalizeJobPositionEvidence(
    JobPositionAnalysisSchema.parse(value),
    source
  );
}

function unsupportedFor(
  task: AnalysisTask,
  output: ReturnType<typeof parseOutput>,
  source: string
) {
  if (task === "content") {
    return unsupportedContentEvidence(
      JobContentAnalysisSchema.parse(output),
      source
    );
  }
  if (task === "facts") {
    return unsupportedEvidence(JobMatchFactsSchema.parse(output), source);
  }
  return unsupportedPositionEvidence(
    JobPositionAnalysisSchema.parse(output),
    source
  );
}

function evidenceCount(
  task: AnalysisTask,
  output: ReturnType<typeof parseOutput>
) {
  if (task === "content") {
    const content = JobContentAnalysisSchema.parse(output);
    return (
      content.overview.flatMap((item) => item.evidence).length +
      content.responsibilities.flatMap((item) => item.evidence).length +
      content.teachingContext.flatMap((item) => item.evidence).length +
      content.scheduleAndContract.flatMap((item) => item.evidence).length +
      content.applicationProcess.flatMap((item) => item.evidence).length +
      content.additionalSections.flatMap((section) =>
        section.items.flatMap((item) => item.evidence)
      ).length
    );
  }
  if (task === "facts") {
    const facts = JobMatchFactsSchema.parse(output);
    return (
      facts.audiences.length +
      facts.benefits.length +
      facts.employmentTypes.length +
      facts.marketSegments.length +
      facts.requirements.length +
      facts.economics.compensation.evidence.length +
      (facts.economics.workload?.evidence.length ?? 0)
    );
  }
  const positions = JobPositionAnalysisSchema.parse(output);
  return positions.positions.reduce(
    (total, position) =>
      total +
      position.evidence.length +
      position.compensationEvidence.length +
      position.subjects.length +
      position.locations.length +
      position.audiences.length +
      position.employmentTypes.length +
      position.requirements.length,
    0
  );
}

function positiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}
