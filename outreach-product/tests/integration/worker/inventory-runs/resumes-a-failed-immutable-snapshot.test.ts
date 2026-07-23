import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  agentPost,
  completeRun,
  createInventorySource,
  inventoryJob,
  pairRunner,
  startRun,
  testEnv,
} from "./support/model";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("hosted inventory runs", () => {
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
