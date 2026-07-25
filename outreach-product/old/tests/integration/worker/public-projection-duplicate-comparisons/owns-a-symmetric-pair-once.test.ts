import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  duplicateComparisonId,
  finalizeStableDuplicateComparisons,
  shadowDuplicateMemberKey,
} from "../../../../worker/services/public-projection/duplicate-comparisons";
import {
  batchRow,
  comparisonCount,
  comparisonRows,
  publicExposureCounts,
  publicGraphCounts,
} from "./support/jobfixture";
import {
  advancePublicVersion,
  seedListing,
  seedListingItem,
  seedPositionItem,
  seedPublicJob,
  seedRun,
  seedStablePosition,
  testEnv,
  timestamp,
} from "./support/model";

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare(
    `DELETE FROM public_projection_duplicate_work
      WHERE run_id NOT IN (
        SELECT run_id FROM public_projection_duplicate_batches
      )`
  ).run();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `DELETE FROM public_projection_position_items
        WHERE run_id NOT IN (
          SELECT run_id FROM public_projection_duplicate_work
        )`
    ),
    testEnv.DB.prepare(
      `DELETE FROM public_projection_listing_items
        WHERE run_id NOT IN (
          SELECT run_id FROM public_projection_duplicate_work
        )`
    ),
    testEnv.DB.prepare(
      `DELETE FROM public_projection_runs
        WHERE id NOT IN (
          SELECT run_id FROM public_projection_duplicate_work
        )`
    ),
  ]);
});

describe("same-run public projection duplicate comparisons", () => {
  it("owns a symmetric pair once and replays independently of insertion order", async () => {
    const runId = "duplicate-order-run";
    await seedRun(runId);
    const right = await seedStablePosition({
      itemId: "position-z",
      listingId: "duplicate-order-z",
      positionKey: "direct",
      runId,
      sourcePositionId: "source-position-z",
      sourceReference: "shared-reference",
    });
    const left = await seedStablePosition({
      itemId: "position-a",
      listingId: "duplicate-order-a",
      positionKey: "direct",
      runId,
      sourcePositionId: "source-position-a",
      sourceReference: "shared-reference",
    });

    const forwardId = await duplicateComparisonId(
      shadowDuplicateMemberKey({
        inputHash: left.inputHash,
        positionItemId: left.itemId,
        runId,
      }),
      shadowDuplicateMemberKey({
        inputHash: right.inputHash,
        positionItemId: right.itemId,
        runId,
      })
    );
    const reverseId = await duplicateComparisonId(
      shadowDuplicateMemberKey({
        inputHash: right.inputHash,
        positionItemId: right.itemId,
        runId,
      }),
      shadowDuplicateMemberKey({
        inputHash: left.inputHash,
        positionItemId: left.itemId,
        runId,
      })
    );
    expect(reverseId).toBe(forwardId);

    await expect(
      finalizeStableDuplicateComparisons(testEnv.DB, runId, timestamp)
    ).resolves.toEqual({
      comparisonCount: 1,
      comparisonsCreated: 1,
      replayed: false,
      state: "complete",
    });
    await expect(
      finalizeStableDuplicateComparisons(
        testEnv.DB,
        runId,
        "2099-01-01T00:00:00.000Z"
      )
    ).resolves.toEqual({
      comparisonCount: 1,
      comparisonsCreated: 0,
      replayed: true,
      state: "complete",
    });
    await expect(comparisonRows(runId)).resolves.toEqual([
      expect.objectContaining({
        id: forwardId,
        owner_position_item_id: "position-a",
        reason_code: "same_source_reference_position",
        relation: "same",
        target_kind: "same_run",
        target_position_item_id: "position-z",
      }),
    ]);
    await expect(batchRow(runId)).resolves.toMatchObject({
      canonical_identity_state: "pending",
      comparison_count: 1,
      position_member_count: 2,
    });
    await expect(publicExposureCounts()).resolves.toEqual({
      browse: 0,
      jobPosting: 0,
      organic: 0,
    });
    await expect(publicGraphCounts()).resolves.toEqual({
      heads: 0,
      jobs: 0,
      mappings: 0,
      versions: 0,
    });
  });

  it("separates multi-position siblings with deterministic evidence", async () => {
    const runId = "duplicate-sibling-run";
    await seedRun(runId);
    const listingId = "duplicate-sibling-listing";
    await seedListing(listingId, "sibling-reference");
    await seedListingItem(runId, listingId);
    await seedPositionItem({
      itemId: "sibling-physics",
      listingId,
      positionKey: "position-physics",
      runId,
      sourcePositionId: "source-physics",
      sourceReference: "sibling-reference",
    });
    await seedPositionItem({
      itemId: "sibling-chemistry",
      listingId,
      positionKey: "position-chemistry",
      runId,
      sourcePositionId: "source-chemistry",
      sourceReference: "sibling-reference",
    });

    await finalizeStableDuplicateComparisons(testEnv.DB, runId, timestamp);
    const [comparison] = await comparisonRows(runId);
    expect(comparison).toMatchObject({
      owner_position_item_id: "sibling-chemistry",
      reason_code: "same_listing_distinct_position",
      relation: "different",
      target_position_item_id: "sibling-physics",
    });
    expect(JSON.parse(String(comparison?.conflicting_signals_json))).toEqual([
      expect.objectContaining({ kind: "position_key_v1" }),
    ]);
  });

  it("pins an existing public mapping and keeps its observed version on replay", async () => {
    const runId = "duplicate-public-run";
    await seedRun(runId);
    const position = await seedStablePosition({
      itemId: "mapped-position-item",
      listingId: "mapped-listing",
      positionKey: "direct",
      runId,
      sourcePositionId: "mapped-source-position",
      sourceReference: "mapped-reference",
    });
    await seedPublicJob(position);
    const before = await publicGraphCounts();

    await finalizeStableDuplicateComparisons(testEnv.DB, runId, timestamp);
    await advancePublicVersion();
    await finalizeStableDuplicateComparisons(
      testEnv.DB,
      runId,
      "2099-01-01T00:00:00.000Z"
    );

    await expect(comparisonRows(runId)).resolves.toEqual([
      expect.objectContaining({
        reason_code: "same_source_position",
        relation: "same",
        target_kind: "existing_public",
        target_public_job_id: "existing-public-job",
        target_public_job_version: 1,
        target_redirect_root_id: "existing-public-job",
      }),
    ]);
    expect(await publicGraphCounts()).toEqual({ ...before, versions: 2 });
    await expect(publicExposureCounts()).resolves.toEqual({
      browse: 0,
      jobPosting: 0,
      organic: 0,
    });
  });

  it("resumes a 1,035-pair collision through an expired lease in fixed pages", async () => {
    const runId = "duplicate-bounded-run";
    await seedRun(runId);
    for (let index = 0; index < 46; index += 1) {
      const suffix = index.toString().padStart(2, "0");
      // biome-ignore lint/performance/noAwaitInLoops: Ordered fixtures produce one deterministic collision cohort.
      await seedStablePosition({
        itemId: `bounded-position-${suffix}`,
        listingId: `bounded-listing-${suffix}`,
        positionKey: "direct",
        runId,
        sourcePositionId: `bounded-source-${suffix}`,
        sourceReference: "bounded-shared-reference",
      });
    }

    const first = await finalizeStableDuplicateComparisons(
      testEnv.DB,
      runId,
      timestamp
    );
    expect(first).toMatchObject({ comparisonsCreated: 0, state: "pending" });
    await testEnv.DB.prepare(
      `UPDATE public_projection_duplicate_work
          SET status='processing',lease_token='abandoned-lease',
              lease_expires_at='2000-01-01T00:00:00.000Z',updated_at=?
        WHERE run_id=? AND status='queued'`
    )
      .bind(timestamp, runId)
      .run();

    let totalCreated = 0;
    let calls = 0;
    let finalState: "complete" | "pending" = "pending";
    while (finalState !== "complete" && calls < 50) {
      // biome-ignore lint/performance/noAwaitInLoops: The test proves cursor resumption across bounded invocations.
      const result = await finalizeStableDuplicateComparisons(
        testEnv.DB,
        runId,
        "2026-07-23T12:00:00.000Z"
      );
      expect(result.comparisonsCreated).toBeLessThanOrEqual(25);
      totalCreated += result.comparisonsCreated;
      finalState = result.state;
      calls += 1;
    }

    expect(finalState).toBe("complete");
    expect(calls).toBeGreaterThan(1);
    expect(totalCreated).toBe(1035);
    await expect(comparisonCount(runId)).resolves.toBe(1035);
    await expect(batchRow(runId)).resolves.toMatchObject({
      comparison_count: 1035,
      position_member_count: 46,
    });
    await expect(
      finalizeStableDuplicateComparisons(
        testEnv.DB,
        runId,
        "2099-01-01T00:00:00.000Z"
      )
    ).resolves.toMatchObject({
      comparisonCount: 1035,
      comparisonsCreated: 0,
      replayed: true,
      state: "complete",
    });
  });

  it("seals a high-cardinality no-match cohort through indexed empty pages", async () => {
    const runId = "duplicate-sparse-run";
    await seedRun(runId);
    for (let index = 0; index < 250; index += 1) {
      const suffix = index.toString().padStart(3, "0");
      // biome-ignore lint/performance/noAwaitInLoops: Ordered fixtures exercise the persistent member cursor.
      await seedStablePosition({
        itemId: `sparse-position-${suffix}`,
        listingId: `sparse-listing-${suffix}`,
        positionKey: "direct",
        runId,
        sourcePositionId: `sparse-source-${suffix}`,
        sourceReference: `sparse-reference-${suffix}`,
      });
    }

    let calls = 0;
    let state: "complete" | "pending" = "pending";
    while (state !== "complete" && calls < 12) {
      // biome-ignore lint/performance/noAwaitInLoops: Completion proves bounded cursor progression over the cohort.
      const result = await finalizeStableDuplicateComparisons(
        testEnv.DB,
        runId,
        timestamp
      );
      ({ state } = result);
      calls += 1;
    }
    expect(state).toBe("complete");
    expect(calls).toBe(10);
    await expect(comparisonCount(runId)).resolves.toBe(0);
    await expect(batchRow(runId)).resolves.toMatchObject({
      comparison_count: 0,
      position_member_count: 250,
    });
  }, 30_000);
});
