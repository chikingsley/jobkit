import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  claimDuplicateWork,
  initializeDuplicateWork,
  PUBLIC_DUPLICATE_MAX_BINDING_BYTES,
  readDuplicateBatch,
  readDuplicateWork,
  type SameRunDuplicateComparison,
  sealDuplicateBatch,
  storeDuplicateComparisonPage,
  storeDuplicateMemberPage,
} from "../../../../worker/repositories/public-projection-duplicate-comparisons";
import {
  DuplicateComparisonSnapshotError,
  finalizeStableDuplicateComparisons,
} from "../../../../worker/services/public-projection/duplicate-comparisons";
import {
  batchRow,
  comparisonCount,
  comparisonRows,
  memberCount,
} from "./support/jobfixture";
import {
  seedBlockedPosition,
  seedIdentityPosition,
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
  it("rolls back partial pages and stale-token writes inside their D1 batch", async () => {
    const runId = "duplicate-atomic-page-run";
    await seedRun(runId);
    const position = await seedStablePosition({
      itemId: "atomic-position",
      listingId: "atomic-listing",
      positionKey: "direct",
      runId,
      sourcePositionId: "atomic-source-position",
      sourceReference: "atomic-reference",
    });
    const material = await testEnv.DB.prepare(
      "SELECT material_hash FROM job_listings WHERE id=?"
    )
      .bind(position.listingId)
      .first<{ material_hash: string }>();
    await initializeDuplicateWork(testEnv.DB, {
      comparisonDigest: "b".repeat(64),
      expectedMemberCount: 1,
      memberDigest: "a".repeat(64),
      runId,
      timestamp,
    });
    const originalLease = await claimDuplicateWork(testEnv.DB, {
      leaseToken: "original-page-lease",
      runId,
      timestamp,
    });
    expect(originalLease?.leaseToken).toBe("original-page-lease");

    await expect(
      testEnv.DB.batch([
        testEnv.DB.prepare(
          `INSERT INTO public_projection_duplicate_batch_members (
            run_id,ordinal,position_item_id,source_position_id,input_hash,
            listing_id,source_key,position_key,source_reference,
            source_reference_signal_hash,material_signal_hash,created_at
          ) VALUES (?,0,?,?,? ,?,'tefl','direct','atomic-reference',NULL,?,?)`
        ).bind(
          runId,
          position.itemId,
          position.sourcePositionId,
          position.inputHash,
          position.listingId,
          material?.material_hash,
          timestamp
        ),
        testEnv.DB.prepare(
          `INSERT INTO public_projection_duplicate_assertions (
            expected_changes,actual_changes
          ) VALUES (2,changes())`
        ),
      ])
    ).rejects.toThrow();
    await expect(memberCount(runId)).resolves.toBe(0);

    await testEnv.DB.prepare(
      `UPDATE public_projection_duplicate_work
          SET lease_expires_at='2000-01-01T00:00:00.000Z'
        WHERE run_id=?`
    )
      .bind(runId)
      .run();
    const reclaimed = await claimDuplicateWork(testEnv.DB, {
      leaseToken: "reclaimed-page-lease",
      runId,
      timestamp,
    });
    expect(reclaimed?.leaseToken).toBe("reclaimed-page-lease");
    await expect(
      storeDuplicateMemberPage(testEnv.DB, {
        digest: "c".repeat(64),
        leaseToken: "original-page-lease",
        members: [
          {
            inputHash: position.inputHash,
            listingId: position.listingId,
            materialSignalHash: material?.material_hash ?? "",
            ordinal: 0,
            positionItemId: position.itemId,
            positionKey: "direct",
            runId,
            sourceKey: "tefl",
            sourcePositionId: position.sourcePositionId,
            sourceReference: "atomic-reference",
            sourceReferenceSignalHash: null,
          },
        ],
        nextCursor: position.itemId,
        nextPhase: "existing_public",
        runId,
        timestamp,
      })
    ).rejects.toThrow();
    await expect(memberCount(runId)).resolves.toBe(0);
    await expect(readDuplicateWork(testEnv.DB, runId)).resolves.toMatchObject({
      leaseToken: "reclaimed-page-lease",
      memberCount: 0,
      phase: "members",
      status: "processing",
    });
  });

  it("rolls back a final seal when a reclaimed lease rejects its cursor CAS", async () => {
    const runId = "duplicate-atomic-seal-run";
    await seedRun(runId);
    await initializeDuplicateWork(testEnv.DB, {
      comparisonDigest: "b".repeat(64),
      expectedMemberCount: 0,
      memberDigest: "a".repeat(64),
      runId,
      timestamp,
    });
    const memberLease = await claimDuplicateWork(testEnv.DB, {
      leaseToken: "empty-member-lease",
      runId,
      timestamp,
    });
    await storeDuplicateMemberPage(testEnv.DB, {
      digest: "a".repeat(64),
      leaseToken: memberLease?.leaseToken ?? "",
      members: [],
      nextCursor: "",
      nextPhase: "existing_public",
      runId,
      timestamp,
    });
    const existingLease = await claimDuplicateWork(testEnv.DB, {
      leaseToken: "empty-existing-lease",
      runId,
      timestamp,
    });
    await storeDuplicateComparisonPage(testEnv.DB, {
      comparisons: [],
      digest: "b".repeat(64),
      leaseToken: existingLease?.leaseToken ?? "",
      nextCursor: { owner: "", target: "" },
      nextPhase: "same_run",
      phase: "existing_public",
      runId,
      timestamp,
    });
    const sameRunLease = await claimDuplicateWork(testEnv.DB, {
      leaseToken: "empty-same-run-lease",
      runId,
      timestamp,
    });
    await storeDuplicateComparisonPage(testEnv.DB, {
      comparisons: [],
      digest: "b".repeat(64),
      leaseToken: sameRunLease?.leaseToken ?? "",
      nextCursor: { owner: "", target: "" },
      nextPhase: "ready",
      phase: "same_run",
      runId,
      timestamp,
    });
    const staleSealLease = await claimDuplicateWork(testEnv.DB, {
      leaseToken: "stale-seal-lease",
      runId,
      timestamp,
    });
    await testEnv.DB.prepare(
      `UPDATE public_projection_duplicate_work
          SET lease_expires_at='2000-01-01T00:00:00.000Z'
        WHERE run_id=?`
    )
      .bind(runId)
      .run();
    const currentSealLease = await claimDuplicateWork(testEnv.DB, {
      leaseToken: "current-seal-lease",
      runId,
      timestamp,
    });
    await expect(
      sealDuplicateBatch(testEnv.DB, {
        batch: {
          comparisonCount: 0,
          comparisonDigest: "b".repeat(64),
          createdAt: timestamp,
          inputHash: "c".repeat(64),
          memberDigest: "a".repeat(64),
          positionMemberCount: 0,
          runId,
        },
        leaseToken: staleSealLease?.leaseToken ?? "",
        timestamp,
      })
    ).rejects.toThrow();
    await expect(readDuplicateBatch(testEnv.DB, runId)).resolves.toBeNull();
    await expect(readDuplicateWork(testEnv.DB, runId)).resolves.toMatchObject({
      leaseToken: currentSealLease?.leaseToken,
      phase: "ready",
      status: "processing",
    });
  });

  it("rejects oversized records and exact canonical D1 payloads", async () => {
    expect(PUBLIC_DUPLICATE_MAX_BINDING_BYTES).toBe(1_000_000);
    const runId = "duplicate-oversized-run";
    await seedRun(runId);
    await seedStablePosition({
      itemId: "oversized-position",
      listingId: "oversized-listing",
      positionKey: "direct",
      runId,
      sourcePositionId: "oversized-source",
      sourceReference: "x".repeat(8193),
    });
    await expect(
      finalizeStableDuplicateComparisons(testEnv.DB, runId, timestamp)
    ).rejects.toBeInstanceOf(DuplicateComparisonSnapshotError);
    await expect(memberCount(runId)).resolves.toBe(0);
    await expect(comparisonCount(runId)).resolves.toBe(0);
    await expect(batchRow(runId)).resolves.toBeNull();

    const oversizedComparisons = Array.from(
      { length: 25 },
      (_, index): SameRunDuplicateComparison => ({
        conflictingSignals: [],
        createdAt: timestamp,
        id: `pdup_v1_${index.toString(16).padStart(64, "0")}`,
        matchingSignals: [
          { kind: "oversized_test", value: "x".repeat(50_000) },
        ],
        ownerInputHash: "a".repeat(64),
        ownerPositionItemId: `owner-${index}`,
        ownerSourcePositionId: `owner-source-${index}`,
        reasonCode: "canonical_identity_only",
        relation: "ambiguous",
        runId,
        target: {
          inputHash: "b".repeat(64),
          kind: "same_run",
          positionItemId: `target-${index}`,
          sourcePositionId: `target-source-${index}`,
        },
      })
    );
    await expect(
      storeDuplicateComparisonPage(testEnv.DB, {
        comparisons: oversizedComparisons,
        digest: "d".repeat(64),
        leaseToken: "unused-oversized-lease",
        nextCursor: { owner: "", target: "" },
        nextPhase: "ready",
        phase: "same_run",
        runId,
        timestamp,
      })
    ).rejects.toThrow(
      "The duplicate comparison payload exceeds the fixed D1 binding limit"
    );
    await expect(comparisonCount(runId)).resolves.toBe(0);
  });

  it("waits for active identity work, excludes blocked work, and rejects drift", async () => {
    const pendingRunId = "duplicate-pending-run";
    await seedRun(pendingRunId);
    await seedStablePosition({
      itemId: "stable-position",
      listingId: "stable-listing",
      positionKey: "direct",
      runId: pendingRunId,
      sourcePositionId: "stable-source-position",
      sourceReference: "stable-reference",
    });
    await seedBlockedPosition(pendingRunId);
    await expect(
      finalizeStableDuplicateComparisons(testEnv.DB, pendingRunId, timestamp)
    ).resolves.toMatchObject({ comparisonCount: 0, state: "complete" });

    const activeRunId = "duplicate-active-run";
    await seedRun(activeRunId);
    await seedIdentityPosition(activeRunId);
    await expect(
      finalizeStableDuplicateComparisons(testEnv.DB, activeRunId, timestamp)
    ).resolves.toMatchObject({ state: "pending" });

    const driftRunId = "duplicate-drift-run";
    await seedRun(driftRunId);
    const drift = await seedStablePosition({
      itemId: "drift-position",
      listingId: "drift-listing",
      positionKey: "direct",
      runId: driftRunId,
      sourcePositionId: "drift-source-position",
      sourceReference: "drift-reference",
    });
    await testEnv.DB.prepare(
      "UPDATE job_listings SET material_hash=? WHERE id=?"
    )
      .bind("0".repeat(64), drift.listingId)
      .run();
    await expect(
      finalizeStableDuplicateComparisons(testEnv.DB, driftRunId, timestamp)
    ).rejects.toBeInstanceOf(DuplicateComparisonSnapshotError);
    await expect(comparisonRows(driftRunId)).resolves.toEqual([]);
    await expect(batchRow(driftRunId)).resolves.toBeNull();
  });
});
