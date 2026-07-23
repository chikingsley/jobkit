import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { InventoryJob } from "../../../../src/features/inventory/schema";
import {
  agentPost,
  completeRun,
  createInventorySource,
  inventoryJob,
  listingMaterialState,
  pairRunner,
  publishSingleJobRun,
  startRun,
  testEnv,
  versionRows,
} from "./support/model";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("hosted inventory runs", () => {
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
});
