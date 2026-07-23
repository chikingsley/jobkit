import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("private jobs list query", () => {
  it("filters, sorts, and paginates before returning a bounded page", async () => {
    const user = await createAuthenticatedUser("jobs-page@example.test");
    const timestamp = "2026-07-22T12:00:00.000Z";
    await testEnv.DB.batch([
      jobStatement("georgia-high", "tefl", "Georgia", 3000, timestamp),
      jobStatement("georgia-low", "tefl", "Georgia", 1500, timestamp),
      jobStatement("poland", "tefl", "Poland", 4000, timestamp),
      jobStatement("intermediary", "anesl", "Georgia", 9000, timestamp),
      jobStatement("already-applied", "tefl", "Georgia", 8000, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO user_listing_states (
            id,user_id,job_id,status,priority,created_at,updated_at
          ) VALUES (?,?,?,'applied',0,?,?)`
      ).bind(
        "state:already-applied",
        user.userId,
        "already-applied",
        timestamp,
        timestamp
      ),
    ]);

    const first = await jobsRequest(
      user.cookie,
      "excludeBoard=anesl&country=Georgia&sort=monthly-pay&excluded=true&limit=1"
    );
    expect(first.jobs.map(({ id }) => id)).toEqual(["georgia-high"]);
    expect(first.countries).toEqual(["Georgia", "Poland"]);
    expect(first.page).toEqual({
      appliedCount: 1,
      hasMore: true,
      limit: 1,
      offset: 0,
      totalAvailable: 4,
      totalCount: 2,
    });
    expect(Object.keys(first.matches)).toEqual(["georgia-high"]);

    const second = await jobsRequest(
      user.cookie,
      "excludeBoard=anesl&country=Georgia&sort=monthly-pay&excluded=true&limit=1&offset=1"
    );
    expect(second.jobs.map(({ id }) => id)).toEqual(["georgia-low"]);
    expect(second.page).toMatchObject({ hasMore: false, offset: 1 });
  });
});

function jobStatement(
  id: string,
  board: string,
  country: string,
  monthlyUsd: number,
  timestamp: string
) {
  return testEnv.DB.prepare(
    `INSERT INTO job_listings (
        id,board,title,company,country,location,apply_url,
        compensation_display,compensation_amount_min,
        compensation_amount_max,compensation_currency,compensation_period,
        first_seen_at,updated_at
      ) VALUES (?,?,?,?,?,?,'https://example.test/apply',?,?,?,?,?,?,?)`
  ).bind(
    id,
    board,
    `${id} teacher`,
    `${id} school`,
    country,
    country,
    `$${monthlyUsd} monthly`,
    monthlyUsd,
    monthlyUsd,
    "USD",
    "month",
    timestamp,
    timestamp
  );
}

async function jobsRequest(cookie: string, search: string) {
  const response = await exports.default.fetch(
    `https://outreach.test/api/jobs?${search}`,
    { headers: { cookie } }
  );
  if (response.status !== 200) {
    throw new Error(`Jobs query returned ${response.status}`);
  }
  return (await response.json()) as {
    countries: string[];
    jobs: Array<{ id: string }>;
    matches: Record<string, unknown>;
    page: {
      appliedCount: number;
      hasMore: boolean;
      limit: number;
      offset: number;
      totalAvailable: number;
      totalCount: number;
    };
  };
}
