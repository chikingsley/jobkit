import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { InventoryJob } from "../../../src/features/inventory/schema";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("hosted inventory runs", () => {
  it("requires an explicitly paired operations runner", async () => {
    const runner = await pairRunner("inventory-no-operations@example.test", [
      "research",
    ]);
    const response = await agentPost("/api/inventory/runs", runner.token, {
      snapshotKey: "inventory-no-operations-v1",
      sourceActiveCount: 0,
      sourceClosedCount: 0,
      sourceId: "job-search-sqlite",
      sourceName: "Job search source inventory",
      sourceTotalCount: 0,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      message: "Paired runner does not have inventory operations capability",
      ok: false,
    });
  });

  it("resumes idempotent batches, preserves unchanged jobs, and closes missing jobs", async () => {
    const sourceId = `inventory-complete-${crypto.randomUUID()}`;
    await createInventorySource(sourceId, "complete_snapshot");
    const runner = await pairRunner("inventory-complete@example.test", [
      "operations",
    ]);
    const firstJob = inventoryJob(`${sourceId}:first`, {
      applyEmail: "inventory-contact@example.test",
      title: "First inventory job",
    });
    const removedJob = inventoryJob(`${sourceId}:removed`, {
      applyUrl: "https://example.test/jobs/removed",
      board: "tefl",
      title: "Job removed in the next snapshot",
    });

    const firstRun = await startRun(runner.token, sourceId, "snapshot-1", 2, 0);
    const batchBody = {
      batchKey: "snapshot-1-batch-0",
      jobs: [firstJob, removedJob],
      ordinal: 0,
    };
    const firstBatch = await agentPost(
      `/api/inventory/runs/${firstRun}/batches`,
      runner.token,
      batchBody
    );
    expect(firstBatch.status).toBe(200);
    await expect(firstBatch.json()).resolves.toMatchObject({
      run: { processedCount: 2, upsertedCount: 2 },
    });

    const repeatedBatch = await agentPost(
      `/api/inventory/runs/${firstRun}/batches`,
      runner.token,
      batchBody
    );
    await expect(repeatedBatch.json()).resolves.toMatchObject({
      run: { processedCount: 2, upsertedCount: 2 },
    });
    await completeRun(runner.token, firstRun, 1);

    const firstTimestamp = await jobUpdatedAt(firstJob.id);
    const viewer = await createAuthenticatedUser(
      "inventory-global-viewer@example.test"
    );
    const globalJobs = await sessionRequest("/api/jobs", viewer.cookie);
    expect(globalJobs.status).toBe(200);
    await expect(globalJobs.json()).resolves.toMatchObject({
      jobs: expect.arrayContaining([
        expect.objectContaining({ id: firstJob.id, status: "new" }),
        expect.objectContaining({ id: removedJob.id, status: "new" }),
      ]),
    });
    const generate = await sessionRequest(
      `/api/jobs/${firstJob.id}/generate`,
      viewer.cookie,
      "POST",
      {}
    );
    expect(generate.status).toBe(202);
    await expect(
      testEnv.DB.prepare(
        "SELECT status FROM user_listing_states WHERE user_id=? AND job_id=?"
      )
        .bind(viewer.userId, firstJob.id)
        .first()
    ).resolves.toEqual({ status: "new" });

    const { userId } = await createAuthenticatedUser(
      "inventory-state-owner@example.test"
    );
    await testEnv.DB.prepare(
      `INSERT INTO user_listing_states
        (id,user_id,job_id,status,priority,created_at,updated_at)
       VALUES (?,?,?,'review',0,?,?)`
    )
      .bind(
        crypto.randomUUID(),
        userId,
        removedJob.id,
        "2026-07-18T12:00:00.000Z",
        "2026-07-18T12:00:00.000Z"
      )
      .run();

    const secondRun = await startRun(
      runner.token,
      sourceId,
      "snapshot-2",
      1,
      1
    );
    await expect(
      agentPost(`/api/inventory/runs/${secondRun}/batches`, runner.token, {
        batchKey: "snapshot-2-batch-0",
        jobs: [firstJob],
        ordinal: 0,
      }).then((response) => response.json())
    ).resolves.toMatchObject({
      run: { processedCount: 1, unchangedCount: 1, upsertedCount: 0 },
    });
    await completeRun(runner.token, secondRun, 1);

    expect(await jobUpdatedAt(firstJob.id)).toBe(firstTimestamp);
    await expect(
      testEnv.DB.prepare("SELECT inventory_status FROM job_listings WHERE id=?")
        .bind(removedJob.id)
        .first()
    ).resolves.toEqual({ inventory_status: "closed" });
    await expect(
      testEnv.DB.prepare("SELECT status FROM application_routes WHERE job_id=?")
        .bind(removedJob.id)
        .first()
    ).resolves.toEqual({ status: "closed" });
    await expect(
      testEnv.DB.prepare(
        "SELECT status FROM user_listing_states WHERE user_id=? AND job_id=?"
      )
        .bind(userId, removedJob.id)
        .first()
    ).resolves.toEqual({ status: "review" });

    const changedJob = { ...firstJob, title: "Changed inventory title" };
    const thirdRun = await startRun(runner.token, sourceId, "snapshot-3", 1, 1);
    await agentPost(`/api/inventory/runs/${thirdRun}/batches`, runner.token, {
      batchKey: "snapshot-3-batch-0",
      jobs: [changedJob],
      ordinal: 0,
    });
    await completeRun(runner.token, thirdRun, 1);
    expect(await jobUpdatedAt(firstJob.id)).not.toBe(firstTimestamp);
    await expect(
      testEnv.DB.prepare("SELECT title FROM job_listings WHERE id=?")
        .bind(firstJob.id)
        .first()
    ).resolves.toEqual({ title: "Changed inventory title" });
  });

  it("does not close missing records for an append-only source", async () => {
    const sourceId = `inventory-append-${crypto.randomUUID()}`;
    await createInventorySource(sourceId, "append_only");
    const runner = await pairRunner("inventory-append@example.test", [
      "operations",
    ]);
    const job = inventoryJob(`${sourceId}:first`);
    const firstRun = await startRun(runner.token, sourceId, "append-1", 1, 0);
    await agentPost(`/api/inventory/runs/${firstRun}/batches`, runner.token, {
      batchKey: "append-1-batch-0",
      jobs: [job],
      ordinal: 0,
    });
    await completeRun(runner.token, firstRun, 1);

    const emptyRun = await startRun(runner.token, sourceId, "append-2", 0, 0);
    await completeRun(runner.token, emptyRun, 0);
    await expect(
      testEnv.DB.prepare("SELECT inventory_status FROM job_listings WHERE id=?")
        .bind(job.id)
        .first()
    ).resolves.toEqual({ inventory_status: "active" });
  });
});

async function pairRunner(email: string, capabilities: string[]) {
  const { cookie } = await createAuthenticatedUser(email);
  const pairing = await sessionRequest(
    "/api/agent-runner-pairings",
    cookie,
    "POST",
    { capabilities }
  );
  const pairingPayload = (await pairing.json()) as {
    pairing: { code: string };
  };
  const exchange = await publicPost("/api/agent-runner-pairings/exchange", {
    code: pairingPayload.pairing.code,
    codexVersion: "codex-cli inventory-test",
    runnerName: "Inventory test runner",
  });
  if (!exchange.ok) {
    throw new Error(`Test runner could not pair (${exchange.status})`);
  }
  return ((await exchange.json()) as { runner: { token: string } }).runner;
}

async function createInventorySource(
  sourceId: string,
  policy: "append_only" | "complete_snapshot"
) {
  const timestamp = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO inventory_sources
      (id,name,completeness_policy,status,created_at,updated_at)
     VALUES (?,?,'${policy}','active',?,?)`
  )
    .bind(sourceId, sourceId, timestamp, timestamp)
    .run();
}

async function startRun(
  token: string,
  sourceId: string,
  snapshotKey: string,
  active: number,
  closed: number
) {
  const response = await agentPost("/api/inventory/runs", token, {
    snapshotKey,
    sourceActiveCount: active,
    sourceClosedCount: closed,
    sourceId,
    sourceName: sourceId,
    sourceTotalCount: active + closed,
  });
  if (response.status !== 202) {
    throw new Error(`Inventory test run could not start (${response.status})`);
  }
  return ((await response.json()) as { run: { id: string } }).run.id;
}

async function completeRun(
  token: string,
  runId: string,
  expectedBatchCount: number
) {
  const response = await agentPost(
    `/api/inventory/runs/${runId}/complete`,
    token,
    { expectedBatchCount }
  );
  const payload = (await response.json()) as { run?: { status?: string } };
  if (response.status !== 200 || payload.run?.status !== "completed") {
    throw new Error(
      `Inventory test run could not complete (${response.status})`
    );
  }
}

async function jobUpdatedAt(jobId: string) {
  const row = await testEnv.DB.prepare(
    "SELECT updated_at FROM job_listings WHERE id=?"
  )
    .bind(jobId)
    .first<{ updated_at: string }>();
  return row?.updated_at;
}

function inventoryJob(
  id: string,
  overrides: Partial<InventoryJob> = {}
): InventoryJob {
  return {
    applyEmail: "",
    applyUrl: "https://example.test/jobs/default",
    board: "example-board",
    company: "Example School",
    compensation: {
      amountMaximum: 3000,
      amountMinimum: 2500,
      confidence: "exact",
      currency: "USD",
      display: "$2,500-$3,000 / month",
      period: "month",
      qualifier: "range",
    },
    contactName: "Hiring Manager",
    country: "Georgia",
    description:
      "A complete source listing used by the inventory integration test.",
    id,
    lastSeenAt: "2026-07-18T12:00:00.000Z",
    location: "Tbilisi",
    marketSegments: ["school"],
    salary: "$2,500-$3,000 / month",
    sourceReference: id,
    sourceUrl: "https://example.test/source",
    title: "English teacher",
    ...overrides,
  };
}

function sessionRequest(
  path: string,
  cookie: string,
  method = "GET",
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
