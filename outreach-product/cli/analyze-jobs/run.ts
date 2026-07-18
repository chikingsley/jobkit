// Local job-requirements analyzer: pulls unanalyzed jobs from the deployed
// worker, runs the worker's exact fact-extraction prompt on a locally-selected
// model, and posts validated facts back through /api/job-match-facts.
//
// Usage:
//   bun run jobkit -- analyze jobs [--limit 5]
//     [--ids id1,id2] [--model gemini-3.5-flash] [--base https://...]
//
// Requires JOBKIT_RUNNER_TOKEN and GOOGLE_GENERATIVE_AI_API_KEY in the env.
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { createCerebras } from "@ai-sdk/cerebras";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { JobMatchFacts } from "../../src/features/matching/schema";
import {
  JOB_FACT_EXTRACTION_INSTRUCTIONS,
  jobFactSource,
  jobSourceHash,
  ProviderJobMatchFactsSchema,
  validateProviderJobMatchFacts,
} from "../../worker/ai/job-fact-extraction";

const QUOTA_ERROR_PATTERN = /quota|rate.?limit|429/iu;
const TIMEOUT_ERROR_PATTERN = /timed out/iu;

const { values: args } = parseArgs({
  options: {
    base: {
      default: "https://outreach-product.peacockery.studio",
      type: "string",
    },
    concurrency: { default: "1", type: "string" },
    ids: { default: "", type: "string" },
    limit: { default: "5", type: "string" },
    model: { default: "gemini-3.5-flash", type: "string" },
    provider: { default: "google", type: "string" },
    rpm: { default: "17", type: "string" },
    variant: { default: "", type: "string" },
  },
});

const runnerToken = process.env.JOBKIT_RUNNER_TOKEN ?? "";
if (!runnerToken) {
  throw new Error("JOBKIT_RUNNER_TOKEN is not set");
}

function createModel(modelId: string) {
  if (args.provider === "cerebras") {
    if (!process.env.CEREBRAS_API_KEY) {
      throw new Error("CEREBRAS_API_KEY is not set");
    }
    return createCerebras()(modelId);
  }
  if (args.provider === "mistral") {
    if (!process.env.MISTRAL_API_KEY) {
      throw new Error("MISTRAL_API_KEY is not set");
    }
    return createMistral()(modelId);
  }
  if (args.provider !== "google") {
    throw new Error(`Unsupported provider: ${args.provider}`);
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
  }
  return createGoogleGenerativeAI()(modelId);
}

interface PendingJob {
  description: string;
  id: string;
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

// The Gemini free tier allows ~20 requests/minute. A shared gate spaces
// request starts so concurrent workers never breach it.
const requestIntervalMs = Math.ceil(
  60_000 / Math.max(Number(args.rpm) || 17, 1)
);
let nextRequestAt = 0;

async function acquireRequestSlot() {
  const now = Date.now();
  const wait = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt) + requestIntervalMs;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

function isQuotaError(message: string) {
  return QUOTA_ERROR_PATTERN.test(message);
}

const providerSchemaJson = JSON.stringify(
  z.toJSONSchema(ProviderJobMatchFactsSchema)
);

// opencode run hangs until stdin reaches EOF, so stdin must be closed
// ("ignore"), which execFile cannot express.
function runOpencode(cliArgs: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("opencode", cliArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`opencode run timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            `opencode run exited ${code}: ${stderr.slice(-400) || "no stderr"}`
          )
        );
      }
    });
  });
}

async function analyzeWithOpencode(job: PendingJob): Promise<JobMatchFacts> {
  const source = jobFactSource(job);
  const basePrompt = `${JOB_FACT_EXTRACTION_INSTRUCTIONS}

Return ONLY a single JSON object, with no markdown fences and no commentary, that validates against this JSON Schema:
${providerSchemaJson}

<job-listing>
${source}
</job-listing>`;
  let feedback = "";
  const attempts = 2;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: Each retry incorporates validation feedback from the previous response.
    const stdout = await runOpencode(
      [
        "run",
        "--pure",
        "--agent",
        "jobkit-extractor",
        "-m",
        args.model,
        ...(args.variant ? ["--variant", args.variant] : []),
        basePrompt + feedback,
      ],
      180_000
    );
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start === -1 || end <= start) {
      feedback =
        "\n\nYour previous reply contained no JSON object. Reply with only the JSON object.";
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout.slice(start, end + 1));
    } catch (error) {
      feedback = `\n\nYour previous reply was not valid JSON (${error instanceof Error ? error.message : "parse error"}). Reply with only the corrected JSON object.`;
      continue;
    }
    const result = ProviderJobMatchFactsSchema.safeParse(parsed);
    if (!result.success) {
      feedback = `\n\nYour previous JSON failed schema validation: ${JSON.stringify(z.treeifyError(result.error)).slice(0, 800)}. Reply with only the corrected JSON object.`;
      continue;
    }
    return validateProviderJobMatchFacts(result.data, source);
  }
  throw new Error(`opencode output failed validation ${attempts} times`);
}

async function analyze(job: PendingJob): Promise<JobMatchFacts> {
  await acquireRequestSlot();
  if (args.provider === "opencode") {
    return analyzeWithOpencode(job);
  }
  const source = jobFactSource(job);
  const result = await generateText({
    instructions: JOB_FACT_EXTRACTION_INSTRUCTIONS,
    maxOutputTokens: 5000,
    maxRetries: 2,
    model: createModel(args.model),
    output: Output.object({
      description: "Evidence-backed facts used to match a job and candidate",
      name: "job_match_facts",
      schema: ProviderJobMatchFactsSchema,
    }),
    prompt: `<job-listing>\n${source}\n</job-listing>`,
    temperature: 0,
    timeout: { totalMs: 60_000 },
  });
  return validateProviderJobMatchFacts(result.output, source);
}

function describeFacts(facts: JobMatchFacts) {
  const lines: string[] = [];
  for (const requirement of facts.requirements) {
    const detail = [
      requirement.minimumDegreeLevel,
      requirement.minimumLanguageLevel,
      requirement.minimumYears === null ? null : `${requirement.minimumYears}y`,
      requirement.values.join("/") || null,
      requirement.alternativeGroup
        ? `alt:${requirement.alternativeGroup}`
        : null,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(
      `    [${requirement.importance}] ${requirement.kind}: ${requirement.label}${detail ? ` (${detail})` : ""}`
    );
  }
  if (facts.audiences.length > 0) {
    lines.push(
      `    audiences: ${facts.audiences.map((fact) => fact.value).join(", ")}`
    );
  }
  const { compensation } = facts.economics;
  if (compensation.kind === "amount") {
    lines.push(
      `    pay: ${compensation.amountMinimum ?? "?"}-${compensation.amountMaximum ?? "?"} ${compensation.currency ?? "?"} per ${compensation.period ?? "?"}`
    );
  } else {
    lines.push(`    pay: ${compensation.kind}`);
  }
  for (const note of facts.reviewNotes) {
    lines.push(`    note: ${note}`);
  }
  return lines.join("\n");
}

const query = args.ids
  ? `ids=${encodeURIComponent(args.ids)}`
  : `limit=${encodeURIComponent(args.limit)}`;
const pending = (await api(`/api/job-match-facts/pending?${query}`)) as {
  pending: PendingJob[];
  remaining: number;
};
console.log(
  `${pending.pending.length} job(s) to analyze, ${pending.remaining} unanalyzed overall\n`
);

let recorded = 0;
const failures: string[] = [];
const queue = [...pending.pending];
const quotaRequeues = new Map<string, number>();
const MAX_QUOTA_REQUEUES = 5;

async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const startedAt = Date.now();
    try {
      // biome-ignore lint/performance/noAwaitInLoops: Each worker processes one job at a time; the outer worker pool supplies bounded concurrency.
      const facts = await analyze(job);
      await api("/api/job-match-facts", {
        body: JSON.stringify({
          facts,
          jobId: job.id,
          modelId: args.model,
          provider: args.provider,
          sourceHash: await jobSourceHash(job),
        }),
        method: "POST",
      });
      recorded += 1;
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `OK ${job.id} (${seconds}s, ${recorded + failures.length}/${pending.pending.length}) ${job.title}\n${describeFacts(facts)}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const requeues = quotaRequeues.get(job.id) ?? 0;
      // A timed-out opencode call may succeed on retry.
      const retryable =
        isQuotaError(message) || TIMEOUT_ERROR_PATTERN.test(message);
      if (retryable && requeues < MAX_QUOTA_REQUEUES) {
        quotaRequeues.set(job.id, requeues + 1);
        queue.push(job);
        console.log(
          `RETRY ${job.id} (attempt ${requeues + 1}): ${message.slice(0, 100)}`
        );
        if (isQuotaError(message)) {
          nextRequestAt = Math.max(nextRequestAt, Date.now() + 60_000);
        }
      } else {
        failures.push(`${job.id} ${job.title}: ${message}`);
        console.error(`FAIL ${job.id} ${job.title}: ${message}`);
      }
    }
  }
}

const concurrency = Math.min(Math.max(Number(args.concurrency) || 1, 1), 16);
await Promise.all(Array.from({ length: concurrency }, worker));

console.log(
  `\nRecorded ${recorded}/${pending.pending.length}; ${failures.length} failure(s)`
);
if (failures.length > 0) {
  process.exitCode = 1;
}
