import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { InventoryJob } from "../../../src/features/inventory/schema";
import { isTransientInventoryStorageError } from "../../../worker/services/inventory-runs/run-ingestion";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("hosted inventory runs", () => {
  it("classifies transport failures separately from source-data failures", () => {
    expect(
      isTransientInventoryStorageError(
        new Error("D1_ERROR: Network connection lost.")
      )
    ).toBe(true);
    expect(
      isTransientInventoryStorageError(
        new Error("D1_ERROR: no such column: inventory_source_id")
      )
    ).toBe(false);
  });

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
      employerId: "source-employer-42",
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
    await expect(
      testEnv.DB.prepare("SELECT employer_id FROM job_listings WHERE id=?")
        .bind(firstJob.id)
        .first()
    ).resolves.toEqual({ employer_id: "source-employer-42" });

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

  it("versions material changes while freshness-only observations preserve analysis freshness", async () => {
    const sourceId = `inventory-material-${crypto.randomUUID()}`;
    await createInventorySource(sourceId, "complete_snapshot");
    const runner = await pairRunner("inventory-material@example.test", [
      "operations",
    ]);
    const initial = inventoryJob(`${sourceId}:first`, {
      sourceDates: {
        expires: {
          date: null,
          provenance: "unresolved",
          raw: "next month",
        },
        posted: {
          date: null,
          provenance: "unresolved",
          raw: "2 days ago",
        },
      },
    });

    await publishSingleJobRun(runner.token, sourceId, "material-1", initial);
    const initialState = await listingMaterialState(initial.id);
    expect(initialState).toMatchObject({
      material_hash_version: 1,
      material_version: 1,
      source_expiry_date_raw: "next month",
      source_posted_date_raw: "2 days ago",
    });
    const preservedMaterialTime = "2026-07-01T12:00:00.000Z";
    const analysisTime = "2026-07-02T12:00:00.000Z";
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `UPDATE job_listings
            SET updated_at=?,material_changed_at=?
          WHERE id=?`
      ).bind(preservedMaterialTime, preservedMaterialTime, initial.id),
      testEnv.DB.prepare(
        `INSERT INTO job_content_analyses
          (job_id,content_json,schema_version,model_provider,model_id,
           source_hash,updated_at)
         VALUES (?,'{}',1,'test','test','test-source-hash',?)`
      ).bind(initial.id, analysisTime),
    ]);

    const refreshed: InventoryJob = {
      ...initial,
      lastSeenAt: "2026-07-21T12:00:00.000Z",
      sourceDates: {
        expires: {
          date: null,
          provenance: "unresolved",
          raw: "in 3 weeks",
        },
        posted: {
          date: null,
          provenance: "unresolved",
          raw: "1 day ago",
        },
      },
    };
    const freshnessResult = await publishSingleJobRun(
      runner.token,
      sourceId,
      "material-2",
      refreshed
    );
    expect(freshnessResult).toMatchObject({
      unchangedCount: 1,
      upsertedCount: 0,
    });
    const refreshedState = await listingMaterialState(initial.id);
    expect(refreshedState).toMatchObject({
      material_changed_at: preservedMaterialTime,
      material_hash: initialState?.material_hash,
      material_version: 1,
      source_expiry_date_raw: "in 3 weeks",
      source_last_seen_at: refreshed.lastSeenAt,
      source_posted_date_raw: "1 day ago",
      updated_at: preservedMaterialTime,
    });
    expect(refreshedState?.source_content_hash).not.toBe(
      initialState?.source_content_hash
    );
    await expect(versionRows(initial.id)).resolves.toHaveLength(1);
    await expect(
      testEnv.DB.prepare(
        `SELECT analysis.updated_at analysis_updated_at,
                listing.updated_at listing_updated_at,
                analysis.updated_at<listing.updated_at stale
           FROM job_content_analyses analysis
           JOIN job_listings listing ON listing.id=analysis.job_id
          WHERE listing.id=?`
      )
        .bind(initial.id)
        .first()
    ).resolves.toEqual({
      analysis_updated_at: analysisTime,
      listing_updated_at: preservedMaterialTime,
      stale: 0,
    });

    await publishSingleJobRun(runner.token, sourceId, "material-3", refreshed);
    await expect(versionRows(initial.id)).resolves.toHaveLength(1);

    const absoluteDate: InventoryJob = {
      ...refreshed,
      lastSeenAt: "2026-07-21T13:00:00.000Z",
      sourceDates: {
        ...refreshed.sourceDates,
        posted: {
          date: "2026-07-20",
          provenance: "board-published",
          raw: "2026-07-20 08:30",
        },
      },
    };
    const dateChangeResult = await publishSingleJobRun(
      runner.token,
      sourceId,
      "material-4",
      absoluteDate
    );
    expect(dateChangeResult).toMatchObject({
      unchangedCount: 0,
      upsertedCount: 1,
    });
    expect(await versionRows(initial.id)).toHaveLength(2);
    expect(await listingMaterialState(initial.id)).toMatchObject({
      material_version: 2,
      source_posted_date: "2026-07-20",
    });

    const retryRun = await startRun(runner.token, sourceId, "material-5", 1, 0);
    const retryBatch = {
      batchKey: "material-5-batch-0",
      jobs: [absoluteDate],
      ordinal: 0,
    };
    await agentPost(
      `/api/inventory/runs/${retryRun}/batches`,
      runner.token,
      retryBatch
    );
    await agentPost(
      `/api/inventory/runs/${retryRun}/batches`,
      runner.token,
      retryBatch
    );
    await completeRun(runner.token, retryRun, 1);
    expect(await versionRows(initial.id)).toHaveLength(2);

    const reverted: InventoryJob = {
      ...refreshed,
      lastSeenAt: "2026-07-21T14:00:00.000Z",
      sourceDates: {
        ...refreshed.sourceDates,
        posted: {
          date: null,
          provenance: "unresolved",
          raw: "today",
        },
      },
    };
    await publishSingleJobRun(runner.token, sourceId, "material-6", reverted);
    const versions = await versionRows(initial.id);
    expect(versions).toHaveLength(3);
    expect(versions.map((version) => version.material_version)).toEqual([
      1, 2, 3,
    ]);
    expect(versions[2]?.material_hash).toBe(versions[0]?.material_hash);
    expect(versions[1]?.material_hash).not.toBe(versions[0]?.material_hash);
  });

  it("upgrades legacy hash history without advancing material time", async () => {
    const sourceId = `inventory-legacy-${crypto.randomUUID()}`;
    await createInventorySource(sourceId, "complete_snapshot");
    const runner = await pairRunner("inventory-legacy@example.test", [
      "operations",
    ]);
    const job = inventoryJob(`${sourceId}:first`);
    const legacyMaterialTime = "2026-06-01T12:00:00.000Z";
    const legacyHash = "legacy-envelope-hash";
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO job_listings (
          id,board,title,company,country,location,salary,description,source_url,
          apply_url,source_reference,first_seen_at,updated_at,
          inventory_source_id,inventory_status,source_last_seen_at,
          source_content_hash,material_hash,material_hash_version,
          material_version,material_changed_at
        ) VALUES (
          ?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,0,1,?
        )`
      ).bind(
        job.id,
        job.board,
        job.title,
        job.company,
        job.country,
        job.location,
        job.salary,
        job.description,
        job.sourceUrl,
        job.applyUrl,
        job.sourceReference,
        legacyMaterialTime,
        legacyMaterialTime,
        sourceId,
        job.lastSeenAt,
        legacyHash,
        legacyHash,
        legacyMaterialTime
      ),
      testEnv.DB.prepare(
        `INSERT INTO job_listing_versions (
          listing_id,material_version,material_hash,material_hash_version,
          material_json,source_posted_date,source_posted_date_raw,
          source_posted_date_provenance,source_expiry_date,
          source_expiry_date_raw,source_expiry_date_provenance,
          inventory_run_id,created_at
        )
        SELECT id,1,source_content_hash,0,NULL,source_posted_date,
               source_posted_date_raw,source_posted_date_provenance,
               source_expiry_date,source_expiry_date_raw,
               source_expiry_date_provenance,inventory_run_id,?
          FROM job_listings WHERE id=?`
      ).bind(legacyMaterialTime, job.id),
    ]);

    await publishSingleJobRun(runner.token, sourceId, "legacy-1", {
      ...job,
      lastSeenAt: "2026-07-21T12:00:00.000Z",
    });
    expect(await listingMaterialState(job.id)).toMatchObject({
      material_changed_at: legacyMaterialTime,
      material_hash_version: 1,
      material_version: 2,
      updated_at: legacyMaterialTime,
    });
    const upgradedVersions = await versionRows(job.id);
    expect(upgradedVersions).toMatchObject([
      { material_hash_version: 0, material_json: null, material_version: 1 },
      { material_hash_version: 1, material_version: 2 },
    ]);
    expect(upgradedVersions[1]?.material_json).toBeTypeOf("string");

    await publishSingleJobRun(runner.token, sourceId, "legacy-2", {
      ...job,
      title: "Materially changed after hash upgrade",
    });
    const changedState = await listingMaterialState(job.id);
    expect(changedState).toMatchObject({
      material_hash_version: 1,
      material_version: 3,
    });
    expect(changedState?.material_changed_at).not.toBe(legacyMaterialTime);
    expect(changedState?.updated_at).not.toBe(legacyMaterialTime);
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

  it("resumes a failed immutable snapshot from its completed batches", async () => {
    const sourceId = `inventory-resume-${crypto.randomUUID()}`;
    await createInventorySource(sourceId, "complete_snapshot");
    const runner = await pairRunner("inventory-resume@example.test", [
      "operations",
    ]);
    const firstJob = inventoryJob(`${sourceId}:first`);
    const secondJob = inventoryJob(`${sourceId}:second`);
    const snapshotKey = "resume-snapshot-1";
    const firstRun = await startRun(runner.token, sourceId, snapshotKey, 2, 0);
    await agentPost(`/api/inventory/runs/${firstRun}/batches`, runner.token, {
      batchKey: "resume-batch-0",
      jobs: [firstJob],
      ordinal: 0,
    });
    const failed = await agentPost(
      `/api/inventory/runs/${firstRun}/fail`,
      runner.token,
      { error: "D1 transport interrupted the publisher" }
    );
    expect(failed.status).toBe(200);

    const resumedRun = await startRun(
      runner.token,
      sourceId,
      snapshotKey,
      2,
      0
    );
    expect(resumedRun).toBe(firstRun);
    await expect(
      testEnv.DB.prepare(
        "SELECT status,processed_count,completed_at FROM inventory_runs WHERE id=?"
      )
        .bind(firstRun)
        .first()
    ).resolves.toEqual({
      completed_at: null,
      processed_count: 1,
      status: "ingesting",
    });

    await agentPost(`/api/inventory/runs/${firstRun}/batches`, runner.token, {
      batchKey: "resume-batch-0",
      jobs: [firstJob],
      ordinal: 0,
    });
    await agentPost(`/api/inventory/runs/${firstRun}/batches`, runner.token, {
      batchKey: "resume-batch-1",
      jobs: [secondJob],
      ordinal: 1,
    });
    await completeRun(runner.token, firstRun, 2);
    await expect(
      testEnv.DB.prepare(
        "SELECT status,processed_count,failed_count FROM inventory_runs WHERE id=?"
      )
        .bind(firstRun)
        .first()
    ).resolves.toEqual({
      failed_count: 0,
      processed_count: 2,
      status: "completed",
    });
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
    employerId: "",
    id,
    lastSeenAt: "2026-07-18T12:00:00.000Z",
    location: "Tbilisi",
    marketSegments: ["school"],
    salary: "$2,500-$3,000 / month",
    sourceDates: {
      expires: { date: null, provenance: "unknown", raw: "" },
      posted: { date: null, provenance: "unknown", raw: "" },
    },
    sourceReference: id,
    sourceUrl: "https://example.test/source",
    title: "English teacher",
    ...overrides,
  };
}

async function publishSingleJobRun(
  token: string,
  sourceId: string,
  snapshotKey: string,
  job: InventoryJob
) {
  const runId = await startRun(token, sourceId, snapshotKey, 1, 0);
  const response = await agentPost(
    `/api/inventory/runs/${runId}/batches`,
    token,
    {
      batchKey: `${snapshotKey}-batch-0`,
      jobs: [job],
      ordinal: 0,
    }
  );
  const payload = (await response.json()) as {
    run?: {
      unchangedCount: number;
      upsertedCount: number;
    };
  };
  if (response.status !== 200 || !payload.run) {
    throw new Error(
      `Inventory test batch could not ingest (${response.status})`
    );
  }
  await completeRun(token, runId, 1);
  return payload.run;
}

function listingMaterialState(jobId: string) {
  return testEnv.DB.prepare(
    `SELECT material_hash,material_hash_version,material_version,
            material_changed_at,source_content_hash,source_last_seen_at,
            source_posted_date,source_posted_date_raw,
            source_expiry_date_raw,updated_at
       FROM job_listings WHERE id=?`
  )
    .bind(jobId)
    .first<{
      material_changed_at: string;
      material_hash: string;
      material_hash_version: number;
      material_version: number;
      source_content_hash: string;
      source_expiry_date_raw: string;
      source_last_seen_at: string;
      source_posted_date: string | null;
      source_posted_date_raw: string;
      updated_at: string;
    }>();
}

async function versionRows(jobId: string) {
  const versions = await testEnv.DB.prepare(
    `SELECT material_version,material_hash,material_hash_version,material_json
       FROM job_listing_versions
      WHERE listing_id=? ORDER BY material_version`
  )
    .bind(jobId)
    .all<{
      material_hash: string;
      material_hash_version: number;
      material_json: string | null;
      material_version: number;
    }>();
  return versions.results;
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
