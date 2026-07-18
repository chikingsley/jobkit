import { spawn } from "node:child_process";
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

const { values: args } = parseArgs({
  options: {
    base: {
      default: "https://outreach-product.peacockery.studio",
      type: "string",
    },
    ids: { default: "", type: "string" },
    limit: { default: "10", type: "string" },
    model: { default: "opencode-go/deepseek-v4-flash", type: "string" },
    record: { default: false, type: "boolean" },
    variant: { default: "", type: "string" },
  },
});

const runnerToken = process.env.JOBKIT_RUNNER_TOKEN ?? "";
if (!runnerToken) {
  throw new Error("JOBKIT_RUNNER_TOKEN is not set");
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

function runOpencode(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "opencode",
      [
        "run",
        "--pure",
        "--agent",
        "jobkit-extractor",
        "--model",
        args.model,
        ...(args.variant ? ["--variant", args.variant] : []),
        prompt,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error("OpenCode position extraction timed out after 3 minutes")
      );
    }, 180_000);
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
        return;
      }
      reject(
        new Error(
          `OpenCode exited ${code}: ${stderr.slice(-500) || "no stderr"}`
        )
      );
    });
  });
}

const providerSchemaJson = JSON.stringify(
  z.toJSONSchema(ProviderJobPositionAnalysisSchema)
);

async function analyze(job: PendingJob) {
  const source = jobFactSource(job);
  const prompt = `${JOB_POSITION_EXTRACTION_INSTRUCTIONS}

Return ONLY one JSON object, without markdown or commentary, matching this JSON Schema:
${providerSchemaJson}

<job-listing>
${source}
</job-listing>`;
  let feedback = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: The second attempt receives validation feedback from the first.
    const output = await runOpencode(prompt + feedback);
    const start = output.indexOf("{");
    const end = output.lastIndexOf("}");
    if (start < 0 || end <= start) {
      feedback =
        "\n\nYour previous response contained no JSON object. Return only valid JSON.";
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(output.slice(start, end + 1));
    } catch (error) {
      feedback = `\n\nYour previous response was invalid JSON: ${error instanceof Error ? error.message : "parse error"}. Return only corrected JSON.`;
      continue;
    }
    const validated = ProviderJobPositionAnalysisSchema.safeParse(parsed);
    if (!validated.success) {
      feedback = `\n\nYour previous JSON failed validation: ${JSON.stringify(z.treeifyError(validated.error)).slice(0, 1200)}. Return only corrected JSON.`;
      continue;
    }
    const analysis = validateProviderJobPositionAnalysis(validated.data);
    const unsupported = unsupportedPositionEvidence(analysis, source);
    if (unsupported.length > 0) {
      feedback = `\n\nThese evidence quotes from your previous JSON are not exact substrings of the listing: ${JSON.stringify(unsupported.slice(0, 10))}. Return corrected JSON using only exact continuous quotes.`;
      continue;
    }
    return analysis;
  }
  throw new Error("OpenCode output failed position schema validation twice");
}

const query = args.ids
  ? `ids=${encodeURIComponent(args.ids)}`
  : `limit=${encodeURIComponent(args.limit)}`;
const response = (await api(`/api/job-position-analyses/pending?${query}`)) as {
  pending: PendingJob[];
};
if (response.pending.length === 0) {
  console.log("No position-analysis candidates were returned.");
}

for (const job of response.pending) {
  // biome-ignore lint/performance/noAwaitInLoops: Pilot runs intentionally stay serial for reviewable output and model isolation.
  const analysis = await analyze(job);
  console.log(`\n${job.id}\n${job.title}\nscope: ${analysis.scope}`);
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
        modelId: args.model,
        provider: "opencode",
        sourceHash: await jobSourceHash(job),
      }),
      method: "POST",
    });
    console.log("  recorded");
  }
}
