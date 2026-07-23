import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../../src/features/matching/version";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

interface JobsPageBody {
  countries: string[];
  jobs: Array<{ id: string; statedHourly: { minimum: number | null } | null }>;
  matches: Record<string, { label: string }>;
  nextCursor: string | null;
  page: {
    appliedCount: number;
    hasMore: boolean;
    limit: number;
    offset: number;
    totalAvailable: number;
    totalCount: number;
  };
}

const testEnv = env as TestEnv;
const timestamp = "2026-07-22T12:00:00.000Z";

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.batch([
    testEnv.DB.prepare("DELETE FROM job_match_facts"),
    testEnv.DB.prepare("DELETE FROM user_listing_states"),
    testEnv.DB.prepare("DELETE FROM job_listings"),
  ]);
});

describe("private jobs keyset pagination", () => {
  it("respects the page size and keeps cursor pages stable under insertion", async () => {
    const user = await createAuthenticatedUser("jobs-keyset@example.test");
    await testEnv.DB.batch([
      monthlyJob("alpha", "Georgia", 9000),
      monthlyJob("bravo", "Georgia", 7000),
      monthlyJob("charlie", "Georgia", 5000),
      monthlyJob("delta", "Georgia", 3000),
      monthlyJob("echo", "Georgia", 1000),
    ]);

    const first = await jobsRequest(user.cookie, "sort=monthly-pay&limit=2");
    expect(first.jobs.map(({ id }) => id)).toEqual(["alpha", "bravo"]);
    expect(first.page).toMatchObject({
      hasMore: true,
      limit: 2,
      totalCount: 5,
    });
    expect(typeof first.nextCursor).toBe("string");

    await testEnv.DB.batch([monthlyJob("inserted", "Georgia", 8000)]);

    const second = await jobsRequest(
      user.cookie,
      `sort=monthly-pay&limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`
    );
    expect(second.jobs.map(({ id }) => id)).toEqual(["charlie", "delta"]);
    expect(second.page.totalCount).toBe(6);
    expect(second.page.hasMore).toBe(true);

    const third = await jobsRequest(
      user.cookie,
      `sort=monthly-pay&limit=2&cursor=${encodeURIComponent(second.nextCursor ?? "")}`
    );
    expect(third.jobs.map(({ id }) => id)).toEqual(["echo"]);
    expect(third.page.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();

    const refreshed = await jobsRequest(
      user.cookie,
      "sort=monthly-pay&limit=6"
    );
    expect(refreshed.jobs.map(({ id }) => id)).toEqual([
      "alpha",
      "inserted",
      "bravo",
      "charlie",
      "delta",
      "echo",
    ]);
  });

  it("combines country filters with the stated-hourly sort across pages", async () => {
    const user = await createAuthenticatedUser("jobs-filter-sort@example.test");
    await testEnv.DB.batch([
      hourlyJob("listed-high", "Georgia", 40),
      monthlyJob("facts-mid", "Georgia", 4000),
      monthlyJob("no-hourly", "Georgia", 2500),
      hourlyJob("other-country", "Poland", 90),
      testEnv.DB.prepare(
        `INSERT INTO job_match_facts (
          job_id,facts_json,schema_version,model_provider,model_id,
          source_hash,updated_at
        ) VALUES (?,?,?,?,?,?,?)`
      ).bind(
        "facts-mid",
        JSON.stringify(monthlyCnyFacts()),
        JOB_MATCH_FACTS_SCHEMA_VERSION,
        "cerebras",
        "zai-glm-4.7",
        "facts-mid-source",
        timestamp
      ),
    ]);

    const first = await jobsRequest(
      user.cookie,
      "country=Georgia&sort=stated-hourly&limit=2"
    );
    expect(first.jobs.map(({ id }) => id)).toEqual([
      "listed-high",
      "facts-mid",
    ]);
    expect(first.jobs[1]?.statedHourly?.minimum).toBeCloseTo(
      (25_000 * 12) / (42.5 * 52) / 7.2,
      5
    );
    expect(first.page).toMatchObject({
      hasMore: true,
      totalAvailable: 4,
      totalCount: 3,
    });
    expect(first.countries).toEqual(["Georgia", "Poland"]);

    const second = await jobsRequest(
      user.cookie,
      `country=Georgia&sort=stated-hourly&limit=2&cursor=${encodeURIComponent(
        first.nextCursor ?? ""
      )}`
    );
    expect(second.jobs.map(({ id }) => id)).toEqual(["no-hourly"]);
    expect(second.page.hasMore).toBe(false);
  });

  it("returns exact totals while page rows drop ineligible matches", async () => {
    const user = await createAuthenticatedUser("jobs-totals@example.test");
    await testEnv.DB.batch([
      monthlyJob("open-one", "Georgia", 6000),
      monthlyJob("open-two", "Georgia", 4000),
      monthlyJob("restricted", "Georgia", 5000, '["language_center"]'),
      monthlyJob("applied-job", "Georgia", 9000),
      testEnv.DB.prepare(
        `INSERT INTO user_listing_states (
          id,user_id,job_id,status,priority,created_at,updated_at
        ) VALUES ('state:applied-job',?, 'applied-job','applied',0,?,?)`
      ).bind(user.userId, timestamp, timestamp),
    ]);

    const page = await jobsRequest(user.cookie, "sort=monthly-pay&limit=10");
    expect(page.jobs.map(({ id }) => id)).toEqual(["open-one", "open-two"]);
    expect(page.matches.restricted).toBeUndefined();
    expect(page.page).toMatchObject({
      appliedCount: 1,
      hasMore: false,
      totalAvailable: 4,
      totalCount: 3,
    });

    const excluded = await jobsRequest(
      user.cookie,
      "sort=monthly-pay&limit=10&excluded=true"
    );
    expect(excluded.jobs.map(({ id }) => id)).toEqual([
      "open-one",
      "restricted",
      "open-two",
    ]);
    expect(excluded.matches.restricted).toMatchObject({
      label: "Ineligible",
    });
  });

  it("ignores malformed cursors and falls back to the offset page", async () => {
    const user = await createAuthenticatedUser("jobs-bad-cursor@example.test");
    await testEnv.DB.batch([
      monthlyJob("solo-one", "Georgia", 4000),
      monthlyJob("solo-two", "Georgia", 2000),
    ]);
    const page = await jobsRequest(
      user.cookie,
      "sort=monthly-pay&limit=1&offset=1&cursor=not-a-cursor"
    );
    expect(page.jobs.map(({ id }) => id)).toEqual(["solo-two"]);
    expect(page.page).toMatchObject({ hasMore: false, offset: 1 });
  });
});

function monthlyJob(
  id: string,
  country: string,
  monthlyUsd: number,
  marketSegmentsJson = "[]"
) {
  return testEnv.DB.prepare(
    `INSERT INTO job_listings (
      id,board,title,company,country,location,apply_url,market_segments_json,
      compensation_display,compensation_amount_min,compensation_amount_max,
      compensation_currency,compensation_period,first_seen_at,updated_at
    ) VALUES (?,?,?,?,?,?,'https://example.test/apply',?,?,?,?,?,?,?,?)`
  ).bind(
    id,
    "tefl",
    `${id} teacher`,
    `${id} school`,
    country,
    country,
    marketSegmentsJson,
    `$${monthlyUsd} monthly`,
    monthlyUsd,
    monthlyUsd,
    "USD",
    "month",
    timestamp,
    timestamp
  );
}

function hourlyJob(id: string, country: string, hourlyUsd: number) {
  return testEnv.DB.prepare(
    `INSERT INTO job_listings (
      id,board,title,company,country,location,apply_url,
      compensation_display,compensation_amount_min,compensation_amount_max,
      compensation_currency,compensation_period,first_seen_at,updated_at
    ) VALUES (?,?,?,?,?,?,'https://example.test/apply',?,?,?,?,?,?,?)`
  ).bind(
    id,
    "tefl",
    `${id} teacher`,
    `${id} school`,
    country,
    country,
    `$${hourlyUsd} hourly`,
    hourlyUsd,
    hourlyUsd,
    "USD",
    "hour",
    timestamp,
    timestamp
  );
}

function monthlyCnyFacts() {
  return {
    audiences: [],
    benefits: [],
    economics: {
      compensation: {
        amountMaximum: 30_000,
        amountMinimum: 25_000,
        currency: "CNY",
        evidence: ["25,000-30,000 CNY per month"],
        kind: "amount",
        period: "month",
        qualifier: "range",
        taxBasis: "net",
      },
      workload: {
        basis: "onsite",
        evidence: ["Monday-Friday, 8:00-4:30"],
        maximum: 42.5,
        minimum: 42.5,
        period: "week",
      },
    },
    employmentTypes: [],
    marketSegments: [],
    requirements: [],
    reviewNotes: [],
  };
}

async function jobsRequest(cookie: string, search: string) {
  const response = await exports.default.fetch(
    `https://outreach.test/api/jobs?excludeBoard=anesl&${search}`,
    { headers: { cookie } }
  );
  if (response.status !== 200) {
    throw new Error(`Jobs query returned ${response.status}`);
  }
  return (await response.json()) as JobsPageBody;
}
