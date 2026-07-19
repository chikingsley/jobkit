import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { queueDueInventoryRefreshes } from "../../../worker/services/inventory-refreshes";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const SOURCE_ID = "job-search-sqlite";
const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("hosted inventory refresh operations", () => {
  it("requires explicit source-operator access", async () => {
    const user = await createAuthenticatedUser("inventory-viewer@example.test");
    const response = await sessionRequest(
      "/api/inventory/refreshes",
      user.cookie,
      "POST",
      { boards: [], mode: "latest", sourceId: SOURCE_ID }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      message: "Inventory source operator access is required",
      ok: false,
    });
  });

  it("deduplicates active refreshes and reports operator status", async () => {
    const sourceId = await createInventorySource("dedup");
    const user = await createAuthenticatedUser(
      "inventory-operator@example.test"
    );
    await grantSourceOperator(user.userId, sourceId);
    const body = {
      boards: ["tefl", "ajarn"],
      mode: "latest",
      sourceId,
    };

    const first = await sessionRequest(
      "/api/inventory/refreshes",
      user.cookie,
      "POST",
      body
    );
    const second = await sessionRequest(
      "/api/inventory/refreshes",
      user.cookie,
      "POST",
      body
    );
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const firstPayload = (await first.json()) as { refresh: { id: string } };
    const secondPayload = (await second.json()) as { refresh: { id: string } };
    expect(secondPayload.refresh.id).toBe(firstPayload.refresh.id);

    const status = await sessionRequest(
      "/api/inventory/status",
      user.cookie,
      "GET"
    );
    await expect(status.json()).resolves.toMatchObject({
      refreshes: [
        expect.objectContaining({
          boards: ["ajarn", "tefl"],
          id: firstPayload.refresh.id,
          status: "queued",
        }),
      ],
      sources: expect.arrayContaining([
        expect.objectContaining({ canOperate: true, id: sourceId }),
      ]),
    });
  });

  it("leases work only to the source operator's runner and renews the lease", async () => {
    const sourceId = await createInventorySource("lease");
    const owner = await pairRunner("inventory-lease-owner@example.test");
    await grantSourceOperator(owner.userId, sourceId);
    const other = await pairRunner("inventory-lease-other@example.test");
    await queueRefresh(owner.cookie, sourceId, {
      boards: [],
      mode: "latest",
    });

    const otherClaim = await agentPost(
      "/api/inventory/operations/claim",
      other.token,
      {}
    );
    await expect(otherClaim.json()).resolves.toEqual({ operation: null });

    const claim = await agentPost(
      "/api/inventory/operations/claim",
      owner.token,
      {}
    );
    const { operation } = (await claim.json()) as {
      operation: { id: string; leaseExpiresAt: string };
    };
    const heartbeat = await agentPost(
      `/api/inventory/operations/${operation.id}/heartbeat`,
      owner.token,
      { status: "crawling" }
    );
    expect(heartbeat.status).toBe(200);
    await expect(heartbeat.json()).resolves.toMatchObject({
      operation: {
        leaseExpiresAt: expect.any(String),
        status: "crawling",
      },
    });

    const wrongHeartbeat = await agentPost(
      `/api/inventory/operations/${operation.id}/heartbeat`,
      other.token,
      { status: "crawling" }
    );
    expect(wrongHeartbeat.status).toBe(409);
  });

  it("completes only with the inventory run linked to the refresh lease", async () => {
    const sourceId = await createInventorySource("completion");
    const owner = await pairRunner("inventory-completion@example.test");
    await grantSourceOperator(owner.userId, sourceId);
    await queueRefresh(owner.cookie, sourceId, {
      boards: ["tefl"],
      mode: "latest",
    });
    const operation = await claimOperation(owner.token);

    const unrelatedRunId = await startRun(
      owner.token,
      sourceId,
      "unrelated-snapshot"
    );
    await completeRun(owner.token, unrelatedRunId);
    const rejected = await agentPost(
      `/api/inventory/operations/${operation.id}/complete`,
      owner.token,
      { inventoryRunId: unrelatedRunId }
    );
    expect(rejected.status).toBe(409);

    const linkedRunId = await startRun(
      owner.token,
      sourceId,
      "linked-snapshot",
      operation.id
    );
    await completeRun(owner.token, linkedRunId);
    const completed = await agentPost(
      `/api/inventory/operations/${operation.id}/complete`,
      owner.token,
      { inventoryRunId: linkedRunId }
    );
    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toMatchObject({
      operation: {
        id: operation.id,
        inventoryRunId: linkedRunId,
        status: "completed",
      },
    });
  });

  it("queues a due user-configured schedule once and advances its next due time", async () => {
    const sourceId = await createInventorySource("schedule");
    const user = await createAuthenticatedUser(
      "inventory-schedule@example.test"
    );
    await grantSourceOperator(user.userId, sourceId);
    const schedule = await sessionRequest(
      `/api/inventory/sources/${sourceId}/schedule`,
      user.cookie,
      "PUT",
      { refreshIntervalMinutes: 37 }
    );
    expect(schedule.status).toBe(200);
    await testEnv.DB.prepare(
      "UPDATE inventory_sources SET next_refresh_at=? WHERE id=?"
    )
      .bind("2026-01-01T00:00:00.000Z", sourceId)
      .run();
    const scheduledSource = await testEnv.DB.prepare(
      `SELECT source.status,source.refresh_interval_minutes,source.next_refresh_at,
              (SELECT COUNT(*) FROM inventory_source_operators operator
                WHERE operator.source_id=source.id) operator_count,
              (SELECT COUNT(*) FROM inventory_refresh_requests request
                WHERE request.source_id=source.id) request_count
         FROM inventory_sources source WHERE source.id=?`
    )
      .bind(sourceId)
      .first();
    expect(scheduledSource).toMatchObject({
      next_refresh_at: "2026-01-01T00:00:00.000Z",
      operator_count: 1,
      refresh_interval_minutes: 37,
      request_count: 0,
      status: "active",
    });

    await expect(queueDueInventoryRefreshes(testEnv.DB)).resolves.toEqual({
      queued: 1,
    });
    await expect(queueDueInventoryRefreshes(testEnv.DB)).resolves.toEqual({
      queued: 0,
    });
    const source = await testEnv.DB.prepare(
      "SELECT next_refresh_at FROM inventory_sources WHERE id=?"
    )
      .bind(sourceId)
      .first<{ next_refresh_at: string }>();
    expect(Date.parse(source?.next_refresh_at ?? "")).toBeGreaterThan(
      Date.now()
    );
  });
});

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

async function grantSourceOperator(userId: string, sourceId = SOURCE_ID) {
  await testEnv.DB.prepare(
    `INSERT INTO inventory_source_operators
      (source_id,user_id,role,created_at) VALUES (?,?,'operator',?)`
  )
    .bind(sourceId, userId, new Date().toISOString())
    .run();
}

async function pairRunner(email: string) {
  const user = await createAuthenticatedUser(email);
  const pairing = await sessionRequest(
    "/api/agent-runner-pairings",
    user.cookie,
    "POST",
    { capabilities: ["operations"] }
  );
  const pairingPayload = (await pairing.json()) as {
    pairing: { code: string };
  };
  const exchange = await publicPost("/api/agent-runner-pairings/exchange", {
    code: pairingPayload.pairing.code,
    codexVersion: "codex-cli inventory-refresh-test",
    runnerName: "Inventory refresh test runner",
  });
  const {
    runner: { token },
  } = (await exchange.json()) as { runner: { token: string } };
  return { ...user, token };
}

function queueRefresh(
  cookie: string,
  sourceId: string,
  input: { boards: string[]; mode: "full" | "latest" }
) {
  return sessionRequest("/api/inventory/refreshes", cookie, "POST", {
    ...input,
    sourceId,
  });
}

async function claimOperation(token: string) {
  const response = await agentPost(
    "/api/inventory/operations/claim",
    token,
    {}
  );
  return ((await response.json()) as { operation: { id: string } }).operation;
}

async function startRun(
  token: string,
  sourceId: string,
  snapshotKey: string,
  operationId?: string
) {
  const response = await agentPost("/api/inventory/runs", token, {
    ...(operationId ? { operationId } : {}),
    snapshotKey,
    sourceActiveCount: 0,
    sourceClosedCount: 0,
    sourceId,
    sourceName: "Job search source inventory",
    sourceTotalCount: 0,
  });
  if (response.status !== 202) {
    throw new Error(`Inventory run could not start (${response.status})`);
  }
  return ((await response.json()) as { run: { id: string } }).run.id;
}

async function completeRun(token: string, runId: string) {
  const response = await agentPost(
    `/api/inventory/runs/${runId}/complete`,
    token,
    { expectedBatchCount: 0 }
  );
  if (response.status !== 200) {
    throw new Error(`Inventory run could not complete (${response.status})`);
  }
}

function sessionRequest(
  path: string,
  cookie: string,
  method: string,
  body?: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      cookie,
    },
    method,
  });
}

function publicPost(path: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function agentPost(path: string, token: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}
