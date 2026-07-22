import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../src/features/inventory/content";
import type { InventoryJob } from "../../../src/features/inventory/schema";
import {
  materialCloneSignal,
  sourceReferenceSignal,
} from "../../../src/features/public/identity-signals";
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
} from "../../../worker/repositories/public-projection-duplicate-comparisons";
import {
  DuplicateComparisonSnapshotError,
  duplicateComparisonId,
  finalizeStableDuplicateComparisons,
  shadowDuplicateMemberKey,
} from "../../../worker/services/public-projection/duplicate-comparisons";
import { canonicalSha256 } from "../../../worker/services/public-projection/hash";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

interface PositionFixture {
  inputHash: string;
  itemId: string;
  listingId: string;
  positionKey: string;
  sourcePositionId: string;
}

const testEnv = env as TestEnv;
const timestamp = "2026-07-22T12:00:00.000Z";

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

async function seedRun(runId: string) {
  await testEnv.DB.prepare(
    `INSERT INTO public_projection_runs (
      id,mode,request_key,scope_json,contract_version,projector_version,
      policy_heads_hash,source_watermark_json,status,selection_complete,
      started_at,requested_at,updated_at
    ) VALUES (
      ?,'shadow',?,'{"boards":[],"listingIds":[]}',1,'projector-v1',?,
      '{"materialChangedAt":"2026-07-22T12:00:00.000Z",\
        "maxListingId":"z"}','running',1,?,?,?
    )`
  )
    .bind(
      runId,
      `request:${runId}`,
      "a".repeat(64),
      timestamp,
      timestamp,
      timestamp
    )
    .run();
}

async function seedStablePosition(input: {
  itemId: string;
  listingId: string;
  positionKey: string;
  runId: string;
  sourcePositionId: string;
  sourceReference: string;
}) {
  await seedListing(input.listingId, input.sourceReference);
  await seedListingItem(input.runId, input.listingId);
  return seedPositionItem(input);
}

async function seedListing(listingId: string, sourceReference: string) {
  const job = jobFixture(listingId, sourceReference);
  const materialJson = serializeInventoryJobMaterial(job);
  const materialHash = await inventoryJobMaterialHash(job);
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_listings (
        id,board,title,company,salary,description,apply_url,first_seen_at,
        updated_at,inventory_status,material_hash,material_hash_version,
        material_version,material_changed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'active',?,1,1,?)`
    ).bind(
      listingId,
      job.board,
      job.title,
      job.company,
      job.salary,
      job.description,
      job.applyUrl,
      timestamp,
      timestamp,
      materialHash,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO job_listing_versions (
        listing_id,material_version,material_hash,material_hash_version,
        material_json,created_at
      ) VALUES (?,1,?,1,?,?)`
    ).bind(listingId, materialHash, materialJson, timestamp),
  ]);
}

async function seedListingItem(runId: string, listingId: string) {
  const row = await testEnv.DB.prepare(
    "SELECT material_hash FROM job_listings WHERE id=?"
  )
    .bind(listingId)
    .first<{ material_hash: string }>();
  await testEnv.DB.prepare(
    `INSERT INTO public_projection_listing_items (
      id,run_id,listing_id,material_version,input_hash,stage,status,
      checkpoint_json,created_at,completed_at,updated_at
    ) VALUES (?, ?, ?, 1, ?, 'completed','completed','{}', ?, ?, ?)`
  )
    .bind(
      `listing-item:${runId}:${listingId}`,
      runId,
      listingId,
      row?.material_hash,
      timestamp,
      timestamp,
      timestamp
    )
    .run();
}

async function seedPositionItem(input: {
  itemId: string;
  listingId: string;
  positionKey: string;
  runId: string;
  sourcePositionId: string;
  sourceReference: string;
}) {
  const material = await testEnv.DB.prepare(
    `SELECT listing.material_hash,version.material_json
       FROM job_listings listing
       JOIN job_listing_versions version
         ON version.listing_id=listing.id
        AND version.material_version=listing.material_version
      WHERE listing.id=?`
  )
    .bind(input.listingId)
    .first<{ material_hash: string; material_json: string }>();
  if (!material) {
    throw new Error(`Missing listing fixture ${input.listingId}`);
  }
  const signals = await Promise.all([
    materialCloneSignal(material.material_hash),
    sourceReferenceSignal({
      sourceKey: "tefl",
      sourceReference: input.sourceReference,
    }),
  ]);
  signals.sort((left, right) => left.kind.localeCompare(right.kind, "en"));
  const inputHash = await canonicalSha256({
    itemId: input.itemId,
    listingId: input.listingId,
  });
  const checkpoint = JSON.stringify({
    identity: {
      signals,
      sourcePosition: {
        id: input.sourcePositionId,
        positionKey: input.positionKey,
      },
      state: "derived",
    },
    listingInputHash: material.material_hash,
  });
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_source_positions (
        id,listing_id,source_key,position_key,position_kind,created_at
      ) VALUES (?,?,'tefl',?, ?, ?)`
    ).bind(
      input.sourcePositionId,
      input.listingId,
      input.positionKey,
      input.positionKey === "direct" ? "direct" : "extracted",
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_position_items (
        id,run_id,listing_item_id,source_position_id,input_hash,stage,status,
        checkpoint_json,created_at,updated_at
      ) VALUES (?, ?, ?, ?, ?, 'canonical_resolution','queued',?, ?, ?)`
    ).bind(
      input.itemId,
      input.runId,
      `listing-item:${input.runId}:${input.listingId}`,
      input.sourcePositionId,
      inputHash,
      checkpoint,
      timestamp,
      timestamp
    ),
  ]);
  return {
    inputHash,
    itemId: input.itemId,
    listingId: input.listingId,
    positionKey: input.positionKey,
    sourcePositionId: input.sourcePositionId,
  } satisfies PositionFixture;
}

async function seedBlockedPosition(runId: string) {
  const listingId = `blocked-listing:${runId}`;
  await seedListing(listingId, "blocked-reference");
  await seedListingItem(runId, listingId);
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_source_positions (
        id,listing_id,source_key,position_key,position_kind,created_at
      ) VALUES (?,?,'tefl','direct','direct',?)`
    ).bind(`blocked-source:${runId}`, listingId, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_position_items (
        id,run_id,listing_item_id,source_position_id,input_hash,stage,status,
        checkpoint_json,error_code,error_detail,created_at,completed_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'identity','blocked',
        '{"identity":{"state":"blocked"}}','identity_seal_mismatch',
        'blocked fixture', ?, ?, ?)`
    ).bind(
      `blocked-item:${runId}`,
      runId,
      `listing-item:${runId}:${listingId}`,
      `blocked-source:${runId}`,
      "b".repeat(64),
      timestamp,
      timestamp,
      timestamp
    ),
  ]);
}

async function seedIdentityPosition(runId: string) {
  const listingId = `identity-listing:${runId}`;
  await seedListing(listingId, "identity-reference");
  await seedListingItem(runId, listingId);
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_source_positions (
        id,listing_id,source_key,position_key,position_kind,created_at
      ) VALUES (?,?,'tefl','direct','direct',?)`
    ).bind(`identity-source:${runId}`, listingId, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_position_items (
        id,run_id,listing_item_id,source_position_id,input_hash,stage,status,
        checkpoint_json,created_at,updated_at
      ) VALUES (?, ?, ?, ?, ?, 'identity','queued','{}', ?, ?)`
    ).bind(
      `identity-item:${runId}`,
      runId,
      `listing-item:${runId}:${listingId}`,
      `identity-source:${runId}`,
      "c".repeat(64),
      timestamp,
      timestamp
    ),
  ]);
}

async function seedPublicJob(position: PositionFixture) {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO public_jobs (id,created_at) VALUES ('existing-public-job',?)"
    ).bind(timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_aliases (public_job_id,slug,created_at)
       VALUES ('existing-public-job','existing-public-job',?)`
    ).bind(timestamp),
    publicVersionStatement(1, null, "public-content-v1"),
  ]);
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO public_job_heads (
        public_job_id,current_version,updated_at
      ) VALUES ('existing-public-job',1,?)`
    ).bind(timestamp),
    testEnv.DB.prepare(
      `INSERT INTO job_source_position_mapping_versions (
        source_position_id,version,predecessor_version,listing_id,
        listing_material_version,mapping_state,public_job_id,reason_code,
        mapping_hash,idempotency_key,created_at
      ) VALUES (?,1,NULL,?,1,'mapped','existing-public-job','initial',
        ?, 'mapping-v1', ?)`
    ).bind(
      position.sourcePositionId,
      position.listingId,
      "d".repeat(64),
      timestamp
    ),
  ]);
  await testEnv.DB.prepare(
    `INSERT INTO job_source_position_mapping_heads (
      source_position_id,current_version,updated_at
    ) VALUES (?,1,?)`
  )
    .bind(position.sourcePositionId, timestamp)
    .run();
}

async function advancePublicVersion() {
  await publicVersionStatement(2, 1, "public-content-v2").run();
  await testEnv.DB.prepare(
    `UPDATE public_job_heads SET current_version=2,updated_at=?
      WHERE public_job_id='existing-public-job'`
  )
    .bind("2026-07-22T13:00:00.000Z")
    .run();
}

function publicVersionStatement(
  version: number,
  predecessorVersion: number | null,
  idempotencyKey: string
) {
  return testEnv.DB.prepare(
    `INSERT INTO public_job_versions (
      public_job_id,version,predecessor_version,canonical_slug,title,
      organization_id,organization_name,organization_resolution_state,
      workplace_type,date_posted,date_posted_provenance,valid_through,
      valid_through_provenance,employment_types_json,compensation_json,
      description_html,public_content_hash,public_content_hash_version,
      material_changed_at,content_schema_version,producer_kind,producer_id,
      idempotency_key,created_at
    ) VALUES (
      'existing-public-job',?,?, 'existing-public-job','English Teacher',
      NULL,'Example School','unresolved','unknown',NULL,'unknown',NULL,
      'unknown','[]','{}','Description',?,1,?,1,'deterministic',
      'duplicate-test',?,?
    )`
  ).bind(
    version,
    predecessorVersion,
    version.toString(16).padStart(64, "0"),
    timestamp,
    idempotencyKey,
    timestamp
  );
}

function jobFixture(id: string, sourceReference: string): InventoryJob {
  return {
    applyEmail: "jobs@example.test",
    applyUrl: "https://example.test/apply",
    board: "tefl",
    company: "Example School",
    compensation: {
      amountMaximum: 3000,
      amountMinimum: 2500,
      confidence: "exact",
      currency: "USD",
      display: "$2,500-$3,000 monthly",
      period: "month",
      qualifier: "range",
    },
    contactName: "Hiring Team",
    country: "Georgia",
    description: "Teach English in Tbilisi.",
    employerId: "employer-42",
    id,
    lastSeenAt: timestamp,
    location: "Tbilisi, Georgia",
    marketSegments: ["school"],
    salary: "$2,500-$3,000 monthly",
    sourceDates: {
      expires: { date: null, provenance: "unknown", raw: "" },
      posted: { date: null, provenance: "unknown", raw: "" },
    },
    sourceReference,
    sourceUrl: `https://example.test/jobs/${id}`,
    title: "English Teacher",
  };
}

async function comparisonRows(runId: string) {
  const result = await testEnv.DB.prepare(
    `SELECT * FROM public_projection_duplicate_comparisons
      WHERE run_id=? ORDER BY id`
  )
    .bind(runId)
    .all<Record<string, unknown>>();
  return result.results;
}

async function comparisonCount(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT COUNT(*) count FROM public_projection_duplicate_comparisons
      WHERE run_id=?`
  )
    .bind(runId)
    .first<{ count: number }>();
  return row?.count ?? -1;
}

async function memberCount(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT COUNT(*) count FROM public_projection_duplicate_batch_members
      WHERE run_id=?`
  )
    .bind(runId)
    .first<{ count: number }>();
  return row?.count ?? -1;
}

function batchRow(runId: string) {
  return testEnv.DB.prepare(
    "SELECT * FROM public_projection_duplicate_batches WHERE run_id=?"
  )
    .bind(runId)
    .first<Record<string, unknown>>();
}

async function publicExposureCounts() {
  const row = await testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM public_browse_jobs) browse,
      (SELECT COUNT(*) FROM organic_index_jobs) organic,
      (SELECT COUNT(*) FROM job_posting_jobs) job_posting`
  ).first<{ browse: number; job_posting: number; organic: number }>();
  return {
    browse: row?.browse ?? -1,
    jobPosting: row?.job_posting ?? -1,
    organic: row?.organic ?? -1,
  };
}

async function publicGraphCounts() {
  const row = await testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM public_jobs) jobs,
      (SELECT COUNT(*) FROM public_job_versions) versions,
      (SELECT COUNT(*) FROM public_job_heads) heads,
      (SELECT COUNT(*) FROM job_source_position_mapping_versions) mappings`
  ).first<{
    heads: number;
    jobs: number;
    mappings: number;
    versions: number;
  }>();
  return row ?? { heads: -1, jobs: -1, mappings: -1, versions: -1 };
}
