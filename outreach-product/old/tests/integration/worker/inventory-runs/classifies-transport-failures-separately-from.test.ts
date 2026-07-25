import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { isTransientInventoryStorageError } from "../../../../src/pipeline/01_ingest/run-ingestion";
import { createAuthenticatedUser } from ".././auth";
import {
  agentPost,
  completeRun,
  createInventorySource,
  inventoryJob,
  jobUpdatedAt,
  pairRunner,
  sessionRequest,
  startRun,
  testEnv,
} from "./support/model";

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
});
