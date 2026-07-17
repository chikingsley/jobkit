// One-time deterministic pass: re-normalize stored job_match_facts rows whose
// required credentials were left ungrouped before the evidence-alternatives
// rule existed. No LLM involved; facts are re-validated locally and re-posted
// through the writeback endpoint with their original model attribution.
//
// Usage: bun --env-file=.dev.vars scripts/analyze-jobs/regroup.ts
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  jobFactSource,
  jobSourceHash,
  ProviderJobMatchFactsSchema,
  validateProviderJobMatchFacts,
} from "../../worker/ai/job-fact-extraction";

const runnerToken = process.env.JOBKIT_RUNNER_TOKEN ?? "";
if (!runnerToken) {
  throw new Error("JOBKIT_RUNNER_TOKEN is not set");
}
const base =
  process.env.JOBKIT_URL ?? "https://outreach-product.peacockery.studio";

const query = `SELECT mf.job_id, mf.facts_json, mf.source_hash, mf.model_id, mf.model_provider,
       j.title, j.salary, j.description
  FROM job_match_facts mf JOIN jobs j ON j.id=mf.job_id
 WHERE (SELECT COUNT(*) FROM json_each(mf.facts_json,'$.requirements') je
         WHERE json_extract(je.value,'$.kind')='credential'
           AND json_extract(je.value,'$.importance')='required'
           AND json_extract(je.value,'$.alternativeGroup') IS NULL) >= 2`;

const result = spawnSync(
  "bunx",
  [
    "wrangler",
    "d1",
    "execute",
    "jobkit-outreach",
    "--remote",
    "--json",
    "--command",
    query,
  ],
  {
    cwd: resolve(import.meta.dir, "../.."),
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  }
);
if (result.status !== 0) {
  throw new Error(`d1 query failed: ${result.stderr.slice(0, 300)}`);
}
const raw = result.stdout;
const payloads = JSON.parse(raw.slice(raw.indexOf("["))) as {
  results: Record<string, string>[];
}[];
const rows = payloads.length > 0 ? payloads[0].results : [];
console.log(`${rows.length} rows to regroup`);

let updated = 0;
let skipped = 0;
for (const row of rows) {
  const fields = {
    description: String(row.description),
    salary: String(row.salary),
    title: String(row.title),
  };
  // biome-ignore lint/performance/noAwaitInLoops: This one-time remote writeback is intentionally sequential to avoid bursting D1.
  const hash = await jobSourceHash(fields);
  if (hash !== row.source_hash) {
    skipped += 1;
    console.log(`SKIP ${row.job_id}: listing changed since analysis`);
    continue;
  }
  const stored = ProviderJobMatchFactsSchema.parse(
    JSON.parse(String(row.facts_json))
  );
  const facts = validateProviderJobMatchFacts(stored, jobFactSource(fields));
  const grouped = facts.requirements.filter(
    (requirement) => requirement.alternativeGroup
  ).length;
  const response = await fetch(`${base}/api/job-match-facts`, {
    body: JSON.stringify({
      facts,
      jobId: row.job_id,
      modelId: row.model_id,
      provider: row.model_provider,
      sourceHash: hash,
    }),
    headers: {
      authorization: `Bearer ${runnerToken}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (response.ok) {
    updated += 1;
    console.log(`OK ${row.job_id}: ${grouped} grouped requirement(s)`);
  } else {
    skipped += 1;
    console.log(
      `FAIL ${row.job_id}: ${response.status} ${await response.text()}`
    );
  }
}
console.log(`Updated ${updated}, skipped ${skipped}`);
