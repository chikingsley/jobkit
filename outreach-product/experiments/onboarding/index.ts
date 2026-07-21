import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runStructuredAgent } from "../../cli/lib/structured-agent";
import {
  PROFILE_IMPORT_OUTPUT_JSON_SCHEMA,
  profileImportPrompt,
} from "../../src/agent-tasks/profile-import";
import { ProfileImportProposalSchema } from "../../src/features/onboarding/schema";
import { mapConcurrent } from "../jina/real/concurrency";
import type {
  ProfileImportCaseResult,
  ProfileImportFixture,
} from "./contracts";
import { buildProfileImportFixtures } from "./fixtures";
import { summarizeProfileImports } from "./metrics";

const USAGE = `JobKit onboarding experiments

Usage:
  bun run jobkit -- experiments onboarding profiles [options]
  bun run jobkit -- experiments onboarding reranking [options]

Options:
  --count <n>          Synthetic profiles to evaluate (default: 10)
  --concurrency <n>    Concurrent Codex tasks (default: 2)
  --model <id>         Codex model (default: gpt-5.6-luna)
  --effort <level>     low, medium, high, or xhigh (default: medium)
  --output <path>      Artifact path
`;

const args = process.argv.slice(2);
if (args[0] === "profiles") {
  await runProfiles(args.slice(1));
} else if (args[0] === "reranking") {
  const { runProfileReranking } = await import("./reranking");
  await runProfileReranking(args.slice(1));
} else {
  console.log(USAGE);
}

async function runProfiles(commandArguments: string[]) {
  const { values } = parseArgs({
    args: commandArguments,
    options: {
      concurrency: { default: "2", type: "string" },
      count: { default: "10", type: "string" },
      effort: { default: "medium", type: "string" },
      model: { default: "gpt-5.6-luna", type: "string" },
      output: { type: "string" },
    },
    strict: true,
  });
  const count = positiveInteger(values.count, "count");
  const concurrency = positiveInteger(values.concurrency, "concurrency");
  const effort = reasoningEffort(values.effort);
  const fixtures = buildProfileImportFixtures(count);
  const results = await mapConcurrent(fixtures, concurrency, (fixture) =>
    extractProfile(fixture, values.model, effort)
  );
  const summary = summarizeProfileImports(fixtures, results);
  const outputPath = resolve(
    values.output ??
      `experiments/onboarding/artifacts/profile-import-${values.model}-${count}-${Date.now()}.json`
  );
  const artifact = {
    fixtures,
    generatedAt: new Date().toISOString(),
    protocol: { concurrency, count, effort, model: values.model },
    results,
    summary,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  const { cases: _cases, ...compactSummary } = summary;
  console.log(JSON.stringify({ outputPath, summary: compactSummary }, null, 2));
}

async function extractProfile(
  fixture: ProfileImportFixture,
  model: string,
  effort: "high" | "low" | "medium" | "xhigh"
): Promise<ProfileImportCaseResult> {
  const started = performance.now();
  try {
    const output = await runStructuredAgent({
      effort,
      model,
      outputSchema: PROFILE_IMPORT_OUTPUT_JSON_SCHEMA,
      prompt: profileImportPrompt(fixture.resume),
      timeoutMs: 300_000,
      webSearch: "disabled",
    });
    return {
      fixtureId: fixture.id,
      latencyMs: Math.round(performance.now() - started),
      proposal: ProfileImportProposalSchema.parse(JSON.parse(output)),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      fixtureId: fixture.id,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

function positiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function reasoningEffort(value: string) {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  ) {
    return value;
  }
  throw new Error("effort must be low, medium, high, or xhigh");
}
