import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
import {
  formatStatedHourly,
  type JobEconomics,
  statedHourlyValue,
} from "../src/features/jobs/economics";
import { extractJobEconomicsWithFallback } from "../worker/ai/job-economics-extraction";
import { extractJobMatchFactsWithFallback } from "../worker/ai/job-fact-extraction";
import type {
  AiModelProvider,
  AiModelSelection,
  AiProviderEnv,
} from "../worker/ai/model-catalog";
import type { JobImport } from "../worker/schemas";

interface SourceJobRow {
  apply_email: string;
  apply_url: string;
  board: string;
  company: string;
  country: string;
  description: string;
  job_id: string;
  location: string;
  raw: string;
  raw_json: string;
  salary: string;
  title: string;
  url: string;
}

interface Options {
  concurrency: number;
  details: "all" | "issues" | "none";
  ids: string[];
  limit: number;
  mode: "economics" | "pipeline";
  model: AiModelSelection;
  offset: number;
}

const options = parseOptions(process.argv.slice(2));
const providerEnv = readProviderEnv();
const databasePath = fileURLToPath(
  new URL("../../job-search/job-data/jobs.sqlite", import.meta.url)
);
const database = new Database(databasePath, {
  readonly: true,
  strict: true,
});

try {
  const rows = selectJobs(database, options);
  const results: Record<string, unknown>[] = [];
  for (let index = 0; index < rows.length; index += options.concurrency) {
    const batch = rows.slice(index, index + options.concurrency);
    const batchResults = await Promise.all(
      batch.map(async (row) => evaluateRow(row, providerEnv, options))
    );
    results.push(...batchResults);
    for (const result of batchResults) {
      const hasIssues = (result.issues as string[]).length > 0;
      if (
        options.details === "all" ||
        (options.details === "issues" && hasIssues)
      ) {
        console.log(JSON.stringify(result));
      }
    }
  }
  console.error(
    JSON.stringify({
      calculatedHourly: results.filter((result) => result.hourly).length,
      extractedCompensation: results.filter(
        (result) =>
          (result.economics as { compensation: { kind: string } }).compensation
            .kind === "amount"
      ).length,
      fallbackUsed: results.filter((result) => result.fallbackUsed).length,
      issues: results.filter((result) => (result.issues as string[]).length > 0)
        .length,
      jobs: results.length,
      mode: options.mode,
      model: options.model,
    })
  );
} finally {
  database.close();
}

async function evaluateRow(
  row: SourceJobRow,
  env: AiProviderEnv,
  evaluation: Options
) {
  const job = sourceJob(row);
  try {
    const result =
      evaluation.mode === "economics"
        ? await extractJobEconomicsWithFallback(
            env,
            evaluation.model,
            listingSource(job)
          )
        : await extractJobMatchFactsWithFallback(env, evaluation.model, job);
    const economics =
      "facts" in result ? result.facts.economics : result.economics;
    const hourly = statedHourlyValue(economics);
    return {
      economics,
      fallbackUsed:
        result.provider !== evaluation.model.provider ||
        result.modelId !== evaluation.model.modelId,
      hourly: hourly ? formatStatedHourly(hourly) : null,
      issues: economicsIssues(economics, job.salary),
      jobId: job.id,
      title: job.title,
    };
  } catch (error) {
    return {
      economics: {
        compensation: { kind: "unstated" },
      },
      error: error instanceof Error ? error.message : String(error),
      hourly: null,
      issues: ["provider-error"],
      jobId: job.id,
      title: job.title,
    };
  }
}

function economicsIssues(economics: JobEconomics, salaryField: string) {
  const issues: string[] = [];
  const { compensation } = economics;
  if (compensation.kind === "conflict") {
    issues.push("compensation-conflict");
  }
  if (
    compensation.kind === "amount" &&
    (compensation.currency === null || compensation.period === null)
  ) {
    issues.push("incomplete-amount");
  }
  if (
    compensation.kind === "negotiable" &&
    [...salaryField].some(isAsciiDigit)
  ) {
    issues.push("numeric-negotiable");
  }
  return issues;
}

function isAsciiDigit(value: string) {
  return value >= "0" && value <= "9";
}

function listingSource(job: JobImport) {
  return [
    `Title: ${job.title}`,
    `Salary field: ${job.salary || "Not supplied"}`,
    "Description:",
    job.description,
  ].join("\n");
}

function selectJobs(
  sourceDatabase: Database,
  selection: Options
): SourceJobRow[] {
  const columns = `apply_email,apply_url,board,company,country,description,
    job_id,location,raw,raw_json,salary,title,url`;
  if (selection.ids.length > 0) {
    const placeholders = selection.ids.map(() => "?").join(",");
    return sourceDatabase
      .query(
        `SELECT ${columns} FROM jobs
         WHERE job_id IN (${placeholders})
         ORDER BY board,job_id`
      )
      .all(...selection.ids) as SourceJobRow[];
  }
  return sourceDatabase
    .query(
      `SELECT ${columns} FROM jobs
       WHERE status='active' AND description<>''
       ORDER BY last_present_at DESC,board,job_id
       LIMIT ? OFFSET ?`
    )
    .all(selection.limit, selection.offset) as SourceJobRow[];
}

function sourceJob(row: SourceJobRow): JobImport {
  return {
    applyEmail: row.apply_email,
    applyUrl: row.apply_url || row.url || "https://example.invalid/apply",
    board: row.board,
    company: row.company,
    country: row.country,
    description: row.raw || row.description,
    employerId: "",
    id:
      row.board === "seriousteachers"
        ? row.job_id
        : `${row.board}:${row.job_id}`,
    location: row.location,
    marketSegments: [],
    messageRoute: "advertised_position",
    opportunityScope: "unknown",
    priority: 0,
    salary: sourceSalary(row),
    sourceUrl: row.url,
    title: row.title,
  };
}

function sourceSalary(row: SourceJobRow) {
  try {
    const source = JSON.parse(row.raw_json) as {
      fields?: Partial<Record<string, string>>;
    };
    const monthly = source.fields?.["Salary/M"]?.trim();
    if (monthly) {
      const lower = monthly.toLocaleLowerCase("en");
      return lower.includes("month") || lower.includes("/m")
        ? monthly
        : `${monthly} / month`;
    }
    return source.fields?.Salary?.trim() || row.salary;
  } catch {
    return row.salary;
  }
}

function readProviderEnv(): AiProviderEnv {
  const { CEREBRAS_API_KEY, MISTRAL_API_KEY } = process.env;
  if (!(CEREBRAS_API_KEY && MISTRAL_API_KEY)) {
    throw new Error(
      "CEREBRAS_API_KEY and MISTRAL_API_KEY are required; load .dev.vars"
    );
  }
  return { CEREBRAS_API_KEY, MISTRAL_API_KEY };
}

function parseOptions(args: string[]): Options {
  const values = new Map(
    args.map((argument) => {
      const [key, ...rest] = argument.split("=");
      return [key, rest.join("=")];
    })
  );
  const provider = (values.get("--provider") ?? "cerebras") as AiModelProvider;
  return {
    concurrency: positiveInteger(values.get("--concurrency"), 3),
    details: detailMode(values.get("--details")),
    ids: (values.get("--ids") ?? "").split(",").filter(Boolean),
    limit: positiveInteger(values.get("--limit"), 10),
    mode: evaluationMode(values.get("--mode")),
    model: {
      modelId: values.get("--model") ?? "gemma-4-31b",
      provider,
    },
    offset: nonnegativeInteger(values.get("--offset"), 0),
  };
}

function detailMode(value: string | undefined): Options["details"] {
  const mode = value ?? "all";
  if (mode === "all" || mode === "issues" || mode === "none") {
    return mode;
  }
  throw new Error(
    `Expected all, issues, or none for --details; received ${value}`
  );
}

function evaluationMode(value: string | undefined): Options["mode"] {
  const mode = value ?? "pipeline";
  if (mode === "economics" || mode === "pipeline") {
    return mode;
  }
  throw new Error(
    `Expected economics or pipeline for --mode; received ${value}`
  );
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!(Number.isInteger(parsed) && parsed > 0)) {
    throw new Error(`Expected a positive integer, received ${value}`);
  }
  return parsed;
}

function nonnegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!(Number.isInteger(parsed) && parsed >= 0)) {
    throw new Error(`Expected a nonnegative integer, received ${value}`);
  }
  return parsed;
}
