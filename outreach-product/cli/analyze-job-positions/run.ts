import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  jobFactSource,
  jobSourceHash,
} from "../../worker/ai/job-fact-extraction";
import {
  JOB_POSITION_EXTRACTION_INSTRUCTIONS,
  ProviderJobPositionAnalysisSchema,
  unsupportedPositionEvidence,
  validateProviderJobPositionAnalysis,
} from "../../worker/ai/job-position-extraction";
import {
  runStructuredAgent,
  type StructuredAgentProvider,
} from "../lib/structured-agent";

const { values: args } = parseArgs({
  options: {
    all: { default: false, type: "boolean" },
    base: {
      default: "https://outreach-product.peacockery.studio",
      type: "string",
    },
    concurrency: { default: "1", type: "string" },
    drain: { default: false, type: "boolean" },
    effort: { default: "medium", type: "string" },
    ids: { default: "", type: "string" },
    limit: { default: "10", type: "string" },
    model: { default: "", type: "string" },
    provider: { default: "opencode", type: "string" },
    record: { default: false, type: "boolean" },
    variant: { default: "", type: "string" },
  },
});

if (!(args.provider === "codex" || args.provider === "opencode")) {
  throw new Error(`Unsupported agent provider: ${args.provider}`);
}
const provider: StructuredAgentProvider = args.provider;
const model =
  args.model ||
  (provider === "codex" ? "gpt-5.6-terra" : "opencode-go/deepseek-v4-flash");
const runnerToken = process.env.JOBKIT_RUNNER_TOKEN ?? "";
if (!runnerToken) {
  throw new Error("JOBKIT_RUNNER_TOKEN is not set");
}
if (args.drain && !args.record) {
  throw new Error(
    "--drain requires --record so completed jobs leave the queue"
  );
}

interface PendingJob {
  company: string;
  country: string;
  description: string;
  id: string;
  location: string;
  salary: string;
  title: string;
}

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${args.base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${runnerToken}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

const providerJsonSchema = z.toJSONSchema(ProviderJobPositionAnalysisSchema);
const providerSchemaText = JSON.stringify(providerJsonSchema);

async function analyze(job: PendingJob) {
  const source = jobFactSource(job);
  const prompt = `${JOB_POSITION_EXTRACTION_INSTRUCTIONS}

Return ONLY one JSON object, without markdown or commentary, matching this JSON Schema:
${providerSchemaText}

<job-listing>
${source}
</job-listing>`;
  let feedback = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: The second attempt receives exact validation feedback from the first.
    const output = await runStructuredAgent({
      cwd: resolve(import.meta.dir, "../.."),
      effort: args.effort,
      model,
      outputSchema: providerJsonSchema,
      prompt: prompt + feedback,
      provider,
      timeoutMs: provider === "codex" ? 600_000 : 180_000,
      variant: args.variant,
    });
    const parsed = parseAgentJson(output);
    if (!parsed.ok) {
      feedback = `\n\nYour previous response was invalid: ${parsed.error}. Return only corrected JSON.`;
      continue;
    }
    const validated = ProviderJobPositionAnalysisSchema.safeParse(parsed.value);
    if (!validated.success) {
      feedback = `\n\nYour previous JSON failed validation: ${JSON.stringify(z.treeifyError(validated.error)).slice(0, 1200)}. Return only corrected JSON.`;
      continue;
    }
    const analysis = validateProviderJobPositionAnalysis(validated.data);
    const unsupported = unsupportedPositionEvidence(analysis, source);
    if (unsupported.length > 0) {
      feedback = `\n\nThese evidence quotes are not exact listing substrings: ${JSON.stringify(unsupported.slice(0, 10))}. Return corrected JSON using exact continuous quotes.`;
      continue;
    }
    return analysis;
  }
  throw new Error(`${provider} output failed position validation twice`);
}

function parseAgentJson(
  output: string
): { error: string; ok: false } | { ok: true; value: unknown } {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { error: "no JSON object was returned", ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(output.slice(start, end + 1)) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "JSON parse error",
      ok: false,
    };
  }
}

function pendingPath() {
  const query = new URLSearchParams();
  if (args.ids) {
    query.set("ids", args.ids);
  } else {
    query.set("limit", args.limit);
  }
  if (args.all) {
    query.set("mode", "all");
  }
  return `/api/job-position-analyses/pending?${query}`;
}

async function processBatch(jobs: PendingJob[]) {
  const queue = [...jobs];
  const failures: string[] = [];
  let recorded = 0;
  async function worker() {
    for (let job = queue.shift(); job; job = queue.shift()) {
      // biome-ignore lint/performance/noAwaitInLoops: Each worker is serial; the worker pool supplies bounded concurrency.
      const result = await processJob(job);
      if (result.failure) {
        failures.push(result.failure);
      } else if (result.recorded) {
        recorded += 1;
      }
    }
  }
  const concurrency = Math.min(Math.max(Number(args.concurrency) || 1, 1), 8);
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { failures, recorded };
}

async function processJob(job: PendingJob) {
  const startedAt = Date.now();
  try {
    const analysis = await analyze(job);
    console.log(
      `\n${job.id} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)\n${job.title}\nscope: ${analysis.scope}`
    );
    for (const position of analysis.positions) {
      console.log(
        `  - ${position.title} [${position.roleFamily}]${position.subjects.length ? ` subjects=${position.subjects.map((subject) => subject.value).join(",")}` : ""}`
      );
      console.log(`    evidence: ${position.evidence.join(" | ")}`);
    }
    for (const note of analysis.reviewNotes) {
      console.log(`  review: ${note}`);
    }
    if (args.record) {
      await api("/api/job-position-analyses", {
        body: JSON.stringify({
          analysis,
          jobId: job.id,
          modelId: model,
          provider,
          sourceHash: await jobSourceHash(job),
        }),
        method: "POST",
      });
      console.log("  recorded");
    }
    return { failure: "", recorded: args.record };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = `${job.id} ${job.title}: ${message}`;
    console.error(`FAIL ${failure}`);
    return { failure, recorded: false };
  }
}

let totalAnalyzed = 0;
let totalRecorded = 0;
let shouldContinue = true;
while (shouldContinue) {
  // biome-ignore lint/performance/noAwaitInLoops: --drain completes each durable server batch before claiming the next.
  const response = (await api(pendingPath())) as { pending: PendingJob[] };
  if (response.pending.length === 0) {
    if (totalAnalyzed === 0) {
      console.log("No pending position analyses.");
    }
    break;
  }
  console.log(
    `${response.pending.length} position-analysis job(s) via ${provider}/${model}`
  );
  const result = await processBatch(response.pending);
  totalAnalyzed += response.pending.length;
  totalRecorded += result.recorded;
  if (result.failures.length > 0) {
    console.error(result.failures.join("\n"));
    process.exitCode = 1;
    shouldContinue = false;
  } else {
    shouldContinue = args.drain && !args.ids;
  }
}

console.log(
  `Position analysis finished: ${totalAnalyzed} analyzed, ${totalRecorded} recorded`
);
