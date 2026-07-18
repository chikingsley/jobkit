import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { runStructuredAgent } from "./lib/structured-agent";

interface SweepTask {
  countryCode: string;
  countryName: string;
  id: string;
  input: unknown;
  phase: "coverage_audit" | "discovery" | "verification";
  scopeKey: string;
  sweepId: string;
}

interface TaskResponse {
  task: SweepTask | null;
}

const baseUrl = (
  process.env.JOBKIT_BASE_URL ?? "https://outreach-product.peacockery.studio"
).replace(/\/$/u, "");
const token = process.env.JOBKIT_COUNTRY_RUNNER_TOKEN ?? "";
const workerId = process.env.JOBKIT_COUNTRY_RUNNER_ID ?? `${hostname()}-codex`;
const once = process.argv.includes("--once");
const schemaPath = resolve(import.meta.dir, "country-sweep-output.schema.json");
const repoRoot = resolve(import.meta.dir, "../..");
const outputSchema = JSON.parse(await readFile(schemaPath, "utf8")) as object;

if (!token) {
  throw new Error(
    "JOBKIT_COUNTRY_RUNNER_TOKEN is required. Create one on the Automation page."
  );
}

await main();

async function main() {
  do {
    // biome-ignore lint/performance/noAwaitInLoops: The next task claim depends on completing or failing the current leased task.
    const { task } = await api<TaskResponse>("/api/country-sweep-tasks/claim", {
      workerId,
    });
    if (!task) {
      if (once) {
        console.log("No country sweep tasks are queued.");
        return;
      }
      await sleep(15_000);
      continue;
    }

    console.log(
      `Running ${task.phase} for ${task.countryName} (${task.scopeKey})`
    );
    try {
      const output = await runCodex(task);
      await api(`/api/country-sweep-tasks/${task.id}/complete`, {
        output,
        workerId,
      });
      console.log(`Completed ${task.phase} task ${task.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await api(`/api/country-sweep-tasks/${task.id}/fail`, {
        error: message.slice(0, 4000),
        workerId,
      });
      console.error(`Failed ${task.phase} task ${task.id}: ${message}`);
    }
  } while (!once);
}

async function runCodex(task: SweepTask) {
  const { model, reasoning } = modelForPhase(task.phase);
  const output = await runStructuredAgent({
    cwd: repoRoot,
    effort: reasoning,
    model,
    outputSchema,
    prompt: promptForTask(task),
    provider: "codex",
    timeoutMs: 900_000,
    variant: "",
  });
  return JSON.parse(output) as unknown;
}

function sleep(milliseconds: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function modelForPhase(phase: SweepTask["phase"]) {
  if (phase === "discovery") {
    return {
      model: process.env.JOBKIT_DISCOVERY_MODEL ?? "gpt-5.6-terra",
      reasoning: process.env.JOBKIT_DISCOVERY_REASONING ?? "medium",
    };
  }
  if (phase === "verification") {
    return {
      model: process.env.JOBKIT_VERIFICATION_MODEL ?? "gpt-5.6-luna",
      reasoning: process.env.JOBKIT_VERIFICATION_REASONING ?? "medium",
    };
  }
  return {
    model: process.env.JOBKIT_COVERAGE_MODEL ?? "gpt-5.6-sol",
    reasoning: process.env.JOBKIT_COVERAGE_REASONING ?? "high",
  };
}

function promptForTask(task: SweepTask) {
  const common = `You are executing one JobKit country-research task.

Country: ${task.countryName} (${task.countryCode})
Phase: ${task.phase}
Scope: ${task.scopeKey}
Input JSON: ${JSON.stringify(task.input)}

Research the live web. Return only facts supported by the URLs you actually checked. Never invent a school, vacancy, email address, phone number, status, or verification date. Use an empty string when a URL or location is unavailable and null when no verification time is justified. Set lastVerifiedAt to the current ISO timestamp only for an organization whose current website or current listing you opened during this run.

Classify language centers and training centers accurately; do not hide them by relabeling. They may be stored but should normally use outreachEligibility "excluded". A real school, kindergarten, university, public school, or international school with a current official contact route may be "eligible". Use "review" when identity or suitability is unclear.

Every active email, phone number, form, or careers page must include the exact evidence URL where it was found. Prefer official organization sites over directories. coverageSummary must include citiesChecked, gaps, needsAnotherPass, queriesChecked, resultCount, and sourcesChecked. The final response must follow the supplied JSON schema.`;

  if (task.phase === "discovery") {
    return `${common}

Discover organizations through the assigned source class. Aim for breadth without duplicates. Record current vacancies when they help establish that the organization is active, but the output is an organization and contact catalog, not prose. Use coverageSummary to report queries or directories checked and useful counts.`;
  }
  if (task.phase === "verification") {
    return `${common}

Verify the single supplied organization against its official current web presence. Return exactly one organization with corrected identity, school type, operating status, outreach eligibility, and current contact points. If it is closed or invalid, say so in status and return only supported contact points.`;
  }
  return `${common}

Audit coverage for the country sweep described by the input. Search for important directories, cities, school categories, or organizations that a broad sweep could miss. Return newly found supported organizations when applicable. In coverageSummary, describe the coverage checked, material gaps, and whether another discovery pass is warranted.`;
}

async function api<T = unknown>(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`JobKit API ${response.status}: ${detail.slice(0, 1000)}`);
  }
  return (await response.json()) as T;
}
