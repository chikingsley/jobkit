import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

function sessionRequest(
  path: string,
  cookie: string,
  method = "GET",
  body?: unknown
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      cookie,
    },
    method,
  });
}

async function createInventorySource(label: string) {
  const sourceId = `inventory-${label}-${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO inventory_sources
      (id,name,completeness_policy,status,created_at,updated_at)
     VALUES (?,?,'complete_snapshot','active',?,?)`
  )
    .bind(sourceId, sourceId, timestamp, timestamp)
    .run();
  return sourceId;
}

function grantSourceOperator(userId: string, sourceId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO inventory_source_operators
      (source_id,user_id,role,created_at) VALUES (?,?,'operator',?)`
  )
    .bind(sourceId, userId, new Date().toISOString())
    .run();
}

const SWEEP_REQUEST = {
  includeDirectories: false,
  includeKnownSources: false,
  includeMaps: false,
  includeSearch: true,
};

describe("operator gates on global-state mutations", () => {
  it("rejects member mutations of inventory, sweep, and analysis state", async () => {
    const member = await createAuthenticatedUser(
      "operator-gate-member@example.test",
      "member"
    );

    const refresh = await sessionRequest(
      "/api/inventory/refreshes",
      member.cookie,
      "POST",
      { boards: [], mode: "latest", sourceId: "job-search-sqlite" }
    );
    expect(refresh.status).toBe(403);
    await expect(refresh.json()).resolves.toMatchObject({
      message: "Operator access is required for inventory mutations",
      ok: false,
    });

    const schedule = await sessionRequest(
      "/api/inventory/sources/job-search-sqlite/schedule",
      member.cookie,
      "PUT",
      { refreshIntervalMinutes: 60 }
    );
    expect(schedule.status).toBe(403);
    await expect(schedule.json()).resolves.toMatchObject({
      message: "Operator access is required for inventory mutations",
      ok: false,
    });

    const sweep = await sessionRequest(
      "/api/countries/TJ/sweeps",
      member.cookie,
      "POST",
      SWEEP_REQUEST
    );
    expect(sweep.status).toBe(403);
    await expect(sweep.json()).resolves.toMatchObject({
      message: "Operator access is required for country sweeps",
      ok: false,
    });

    const matchFacts = await sessionRequest(
      "/api/job-match-facts",
      member.cookie,
      "POST",
      {}
    );
    expect(matchFacts.status).toBe(403);

    const positionAnalyses = await sessionRequest(
      "/api/job-position-analyses",
      member.cookie,
      "POST",
      {}
    );
    expect(positionAnalyses.status).toBe(403);
  });

  it("keeps the operator inventory refresh and schedule flow working", async () => {
    const sourceId = await createInventorySource("operator-gate");
    const operator = await createAuthenticatedUser(
      "operator-gate-inventory@example.test"
    );
    await grantSourceOperator(operator.userId, sourceId);

    const refresh = await sessionRequest(
      "/api/inventory/refreshes",
      operator.cookie,
      "POST",
      { boards: [], mode: "latest", sourceId }
    );
    expect(refresh.status).toBe(202);
    await expect(refresh.json()).resolves.toMatchObject({ ok: true });

    const schedule = await sessionRequest(
      `/api/inventory/sources/${sourceId}/schedule`,
      operator.cookie,
      "PUT",
      { refreshIntervalMinutes: 45 }
    );
    expect(schedule.status).toBe(200);
    await expect(schedule.json()).resolves.toMatchObject({ ok: true });
  });

  it("keeps the operator country sweep flow working", async () => {
    const operator = await createAuthenticatedUser(
      "operator-gate-sweep@example.test"
    );
    const sweep = await sessionRequest(
      "/api/countries/TJ/sweeps",
      operator.cookie,
      "POST",
      SWEEP_REQUEST
    );
    expect(sweep.status).toBe(200);
    await expect(sweep.json()).resolves.toMatchObject({ ok: true });
    await expect(
      testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM country_sweeps WHERE requested_by_user_id=?"
      )
        .bind(operator.userId)
        .first<{ count: number }>()
    ).resolves.toEqual({ count: 1 });
  });
});
