// Rank analyzed jobs by money using the product's own evaluator: pull every
// job with match facts, run evaluateJob against the real profile, preferences,
// and qualification claims, convert pay to USD with live FX, and print the top
// qualified jobs by monthly and hourly USD plus fun-country inventory.
//
// Usage: bun scripts/job-ranking/rank.ts [--top 20] [--countries "Thailand,..."]
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  compensationFromEconomics,
  type FxData,
  statedHourlyUsd,
} from "../../src/features/jobs/economics";
import type { Job } from "../../src/features/jobs/types";
import { evaluateJob } from "../../src/features/matching/evaluate";
import { JobMatchFactsSchema } from "../../src/features/matching/schema";
import { PreferencesSchema } from "../../src/features/preferences/schema";
import { ProfileSchema } from "../../src/features/profile/schema";
import { compensationFromRow } from "../../worker/repositories/jobs";

const { values: args } = parseArgs({
  options: {
    countries: { default: "", type: "string" },
    top: { default: "20", type: "string" },
  },
});

function d1(query: string): Record<string, unknown>[] {
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
      maxBuffer: 512 * 1024 * 1024,
    }
  );
  if (result.status !== 0) {
    throw new Error(`d1 query failed: ${result.stderr.slice(0, 300)}`);
  }
  const raw = result.stdout;
  const payloads = JSON.parse(raw.slice(raw.indexOf("["))) as {
    results: Record<string, unknown>[];
  }[];
  return payloads.length > 0 ? payloads[0].results : [];
}

const [profileRow] = d1("SELECT profile_json FROM user_profiles LIMIT 1");
const [preferencesRow] = d1(
  "SELECT preferences_json FROM user_preferences LIMIT 1"
);
const claimRows = d1("SELECT claim_key, answer FROM user_qualification_claims");
const jobRows = d1(
  `SELECT j.*, mf.facts_json
     FROM jobs j
     JOIN job_match_facts mf ON mf.job_id=j.id
     JOIN user_jobs uj ON uj.job_id=j.id
    WHERE uj.status IN ('new','review')`
);

if (!(profileRow && preferencesRow)) {
  throw new Error("Missing profile or preferences");
}
const profile = ProfileSchema.parse(
  JSON.parse(String(profileRow.profile_json))
);
const preferences = PreferencesSchema.parse(
  JSON.parse(String(preferencesRow.preferences_json))
);
const claims = Object.fromEntries(
  claimRows.map((row) => [String(row.claim_key), String(row.answer)])
) as Record<string, "no" | "yes">;

const fxResponse = await fetch("https://open.er-api.com/v6/latest/USD");
const fxRaw = (await fxResponse.json()) as { rates: Record<string, number> };
const fx: FxData = { asOf: new Date().toISOString(), rates: fxRaw.rates };

const MONTHLY_MULTIPLIER: Record<string, number> = {
  fortnight: 2.17,
  month: 1,
  week: 4.33,
  year: 1 / 12,
};

interface Ranked {
  company: string;
  country: string;
  hourlyUsd: number | null;
  jobId: string;
  label: string;
  monthlyUsd: number | null;
  title: string;
}

const ranked: Ranked[] = [];
const funCountries = args.countries
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const funCounts = new Map<string, { qualified: number; total: number }>();

for (const row of jobRows) {
  const factsParsed = JobMatchFactsSchema.safeParse(
    JSON.parse(String(row.facts_json))
  );
  if (!factsParsed.success) {
    continue;
  }
  const matchFacts = factsParsed.data;
  const compensation = matchFacts
    ? compensationFromEconomics(matchFacts.economics)
    : compensationFromRow(row);
  const job = {
    applicationRoutes: [],
    applyUrl: String(row.apply_url),
    board: String(row.board),
    company: String(row.company),
    compensation,
    country: String(row.country),
    description: String(row.description),
    draft: null,
    emailAttempt: null,
    id: String(row.id),
    location: String(row.location),
    marketSegments: JSON.parse(String(row.market_segments_json)) as never,
    matchFacts,
    messageRoute: String(row.message_route) as never,
    opportunityScope: String(row.opportunity_scope) as never,
    priority: Number(row.priority),
    sourceUrl: String(row.source_url),
    status: String(row.status) as never,
    title: String(row.title),
  } as unknown as Job;

  const hourlyUsd = statedHourlyUsd(matchFacts.economics, fx);
  const { compensation: pay } = matchFacts.economics;
  let monthlyUsd: number | null = null;
  if (pay.kind === "amount" && pay.currency && pay.period) {
    const multiplier = MONTHLY_MULTIPLIER[pay.period];
    const rate = fx.rates[pay.currency];
    const amount = pay.amountMinimum ?? pay.amountMaximum;
    if (multiplier && rate && amount) {
      monthlyUsd = (amount * multiplier) / rate;
    }
  }
  const match = evaluateJob(
    job,
    profile,
    preferences,
    monthlyUsd ?? undefined,
    [],
    claims
  );
  const entry: Ranked = {
    company: String(row.company),
    country: String(row.country),
    hourlyUsd,
    jobId: String(row.id),
    label: match.label,
    monthlyUsd,
    title: String(row.title),
  };
  if (funCountries.includes(entry.country)) {
    const bucket = funCounts.get(entry.country) ?? { qualified: 0, total: 0 };
    bucket.total += 1;
    if (match.label !== "Ineligible") {
      bucket.qualified += 1;
    }
    funCounts.set(entry.country, bucket);
  }
  if (match.label === "Ineligible") {
    continue;
  }
  ranked.push(entry);
}

const top = Number(args.top) || 20;
const fmt = (entry: Ranked, money: string) =>
  `${money.padStart(9)}  [${entry.label}] ${entry.title} — ${entry.company || "?"} (${entry.country}) ${entry.jobId}`;

console.log(
  `\n=== TOP ${top} QUALIFIED BY MONTHLY USD (of ${ranked.length} eligible) ===`
);
for (const entry of [...ranked]
  .filter((item) => item.monthlyUsd)
  .sort((a, b) => (b.monthlyUsd ?? 0) - (a.monthlyUsd ?? 0))
  .slice(0, top)) {
  console.log(fmt(entry, `$${Math.round(entry.monthlyUsd ?? 0)}/mo`));
}

console.log(`\n=== TOP ${top} QUALIFIED BY HOURLY USD ===`);
for (const entry of [...ranked]
  .filter((item) => item.hourlyUsd)
  .sort((a, b) => (b.hourlyUsd ?? 0) - (a.hourlyUsd ?? 0))
  .slice(0, top)) {
  console.log(fmt(entry, `$${(entry.hourlyUsd ?? 0).toFixed(0)}/hr`));
}

if (funCounts.size > 0) {
  console.log("\n=== FUN-LANE INVENTORY (qualified/total analyzed) ===");
  for (const [country, bucket] of [...funCounts.entries()].sort(
    (a, b) => b[1].qualified - a[1].qualified
  )) {
    console.log(`  ${country}: ${bucket.qualified}/${bucket.total}`);
  }
  console.log("\n=== FUN-LANE TOP PICKS (by pay) ===");
  for (const country of funCountries) {
    const picks = ranked
      .filter((entry) => entry.country === country)
      .sort(
        (a, b) =>
          (b.monthlyUsd ?? (b.hourlyUsd ?? 0) * 100) -
          (a.monthlyUsd ?? (a.hourlyUsd ?? 0) * 100)
      )
      .slice(0, 3);
    for (const entry of picks) {
      let money = "pay n/a";
      if (entry.monthlyUsd) {
        money = `$${Math.round(entry.monthlyUsd)}/mo`;
      } else if (entry.hourlyUsd) {
        money = `$${Math.round(entry.hourlyUsd)}/hr`;
      }
      console.log(fmt(entry, money));
    }
  }
}
