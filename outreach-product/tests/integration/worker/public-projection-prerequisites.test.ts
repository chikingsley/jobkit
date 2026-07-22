import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  JOB_POSITION_PROMPT_VERSION,
  JOB_POSITION_TASK_TYPE,
} from "../../../src/agent-tasks/job-analysis";
import {
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../src/features/inventory/content";
import type { InventoryJob } from "../../../src/features/inventory/schema";
import {
  JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  type JobPositionAnalysis,
  type JobPositionVariant,
} from "../../../src/features/jobs/position-variants";
import {
  materialCloneSignal,
  sourceReferenceSignal,
} from "../../../src/features/public/identity-signals";
import { sourcePositionIdentities } from "../../../src/features/public/source-position-identity";
import { jobSourceHash } from "../../../worker/ai/job-fact-extraction";
import type { AgentRunnerContext } from "../../../worker/app-types";
import { claimJobPositionTask } from "../../../worker/services/agent-tasks/job-analysis-adapter";
import { advancePublicProjectionRuns } from "../../../worker/services/public-projection/advancement";
import { processProjectionCanonicalResolutionClaim } from "../../../worker/services/public-projection/canonical-resolution";
import { processProjectionIdentityClaim } from "../../../worker/services/public-projection/identity";
import { claimProjectionListing } from "../../../worker/services/public-projection/listing-items";
import {
  createMapboxPermanentLocationResolver,
  type PermanentLocationResolver,
  type PermanentLocationResponse,
} from "../../../worker/services/public-projection/mapbox-location-resolver";
import { claimProjectionPosition } from "../../../worker/services/public-projection/position-items";
import { processProjectionPrerequisiteClaim } from "../../../worker/services/public-projection/prerequisites";
import { processProjectionSourcePositionClaim } from "../../../worker/services/public-projection/source-positions";
import { createAuthenticatedUser } from "./auth";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

interface ProjectionRunResponse {
  run: { id: string };
}

interface SeededListing {
  job: InventoryJob;
  materialHash: string;
  materialJson: string;
  sourceHash: string;
}

interface ListingItemRow {
  attempt_count: number;
  checkpoint_json: string;
  error_code: string;
  id: string;
  stage: string;
  status: string;
}

const testEnv = env as TestEnv;
const timestamp = "2026-07-22T12:00:00.000Z";
const futureTimestamp = "2099-07-22T12:00:00.000Z";

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

describe("projection prerequisites, source positions, and identity", () => {
  it("validates current prerequisites and expands one direct position", async () => {
    const listing = await seedListing("phase-c-current-direct");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-c-current-direct@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      advanced: 1,
      runId,
      selected: 1,
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      prerequisiteReady: 1,
      prerequisiteWaiting: 0,
      runId,
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      expanded: 1,
      runId,
    });

    const item = await listingItem(runId);
    expect(item).toMatchObject({
      attempt_count: 2,
      error_code: "",
      stage: "completed",
      status: "completed",
    });
    const checkpoint = JSON.parse(item.checkpoint_json) as {
      analyses: Record<
        string,
        { payloadHash: string; recordFingerprint: string; status: string }
      >;
      materialSnapshot: {
        analysisSourceHash: string;
        materialHash: string;
        materialVersion: number;
      };
      sourcePositions: { identities: Array<{ positionKey: string }> };
    };
    expect(checkpoint.materialSnapshot).toMatchObject({
      analysisSourceHash: listing.sourceHash,
      materialHash: listing.materialHash,
      materialVersion: 1,
    });
    expect(checkpoint.sourcePositions.identities).toEqual([
      expect.objectContaining({ positionKey: "direct" }),
    ]);
    for (const analysis of Object.values(checkpoint.analyses)) {
      expect(analysis).toMatchObject({ status: "current" });
      expect(analysis.payloadHash).toHaveLength(64);
      expect(analysis.recordFingerprint).toHaveLength(64);
    }
    await expect(
      testEnv.DB.prepare(
        `SELECT source_key,position_key,position_kind
           FROM job_source_positions WHERE listing_id=?`
      )
        .bind(listing.job.id)
        .all()
    ).resolves.toMatchObject({
      results: [
        {
          position_key: "direct",
          position_kind: "direct",
          source_key: "tefl",
        },
      ],
    });
    await expect(positionItems(runId)).resolves.toEqual([
      expect.objectContaining({ stage: "identity", status: "queued" }),
    ]);
  });

  it("expands 30 positions through resumable D1 batches below 50 statements", async () => {
    const listing = await seedListing("phase-c-bounded-expansion");
    await seedAnalyses(listing, {
      positions: Array.from({ length: 30 }, (_, index) =>
        position(`English Teacher ${index + 1}`, "English")
      ),
      reviewNotes: [],
      scope: "multi_position",
    });
    const operator = await createAuthenticatedUser(
      "phase-c-bounded-expansion@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);

    const observedBatchSizes: number[] = [];
    const boundedDb = new Proxy(testEnv.DB, {
      get(target, property) {
        if (property === "batch") {
          return (statements: D1PreparedStatement[]) => {
            observedBatchSizes.push(statements.length);
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;

    await expect(advancePublicProjectionRuns(boundedDb)).resolves.toMatchObject(
      { expanded: 30, runId }
    );
    expect(observedBatchSizes.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...observedBatchSizes)).toBeLessThanOrEqual(50);
    expect(await listingItem(runId)).toMatchObject({
      attempt_count: 3,
      stage: "completed",
      status: "completed",
    });
    await expect(sourcePositionCounts(listing.job.id, runId)).resolves.toEqual({
      positions: 30,
      projectionItems: 30,
    });
  });

  it.each(["missing", "stale"] as const)(
    "waits for %s analyses, awakens once, and preserves the attempt budget",
    async (state) => {
      const listing = await seedListing(`phase-c-wait-${state}`);
      if (state === "stale") {
        await seedAnalyses(listing, directAnalysis(), {
          sourceHash: "0".repeat(64),
        });
      }
      const operator = await createAuthenticatedUser(
        `phase-c-wait-${state}@example.test`
      );
      const runId = await createRun(operator.cookie, {
        boards: [],
        listingIds: [listing.job.id],
      });

      await advancePublicProjectionRuns(testEnv.DB);
      await expect(
        advancePublicProjectionRuns(testEnv.DB)
      ).resolves.toMatchObject({
        prerequisiteReady: 0,
        prerequisiteWaiting: 1,
        runId,
      });
      expect(await listingItem(runId)).toMatchObject({
        attempt_count: 1,
        stage: "prerequisites",
        status: "waiting_analysis",
      });

      await expect(
        advancePublicProjectionRuns(testEnv.DB)
      ).resolves.toMatchObject({ awakened: 0, runId: null });
      expect(await listingItem(runId)).toMatchObject({ attempt_count: 1 });

      await seedAnalyses(listing, directAnalysis());
      await expect(
        advancePublicProjectionRuns(testEnv.DB)
      ).resolves.toMatchObject({
        awakened: 1,
        prerequisiteReady: 1,
        runId,
      });
      expect(await listingItem(runId)).toMatchObject({
        attempt_count: 2,
        stage: "source_positions",
        status: "queued",
      });
      await expect(
        advancePublicProjectionRuns(testEnv.DB)
      ).resolves.toMatchObject({ expanded: 1, runId });
      expect(await listingItem(runId)).toMatchObject({
        attempt_count: 3,
        stage: "completed",
        status: "completed",
      });
    }
  );

  it("blocks an exact direct analysis containing multiple positions", async () => {
    const listing = await seedListing("phase-c-invalid-direct");
    await seedAnalyses(listing, {
      positions: [position("English Teacher"), position("Math Teacher")],
      reviewNotes: [],
      scope: "direct",
    });
    const operator = await createAuthenticatedUser(
      "phase-c-invalid-direct@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });

    await advancePublicProjectionRuns(testEnv.DB);
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      blocked: 1,
      runId,
    });
    expect(await listingItem(runId)).toMatchObject({
      attempt_count: 1,
      error_code: "invalid_position_analysis",
      stage: "prerequisites",
      status: "blocked",
    });
    await expect(sourcePositionCounts(listing.job.id, runId)).resolves.toEqual({
      positions: 0,
      projectionItems: 0,
    });
  });

  it.each([
    {
      count: 3,
      expectedCode: "position_analysis_attempts_exhausted",
      status: "failed",
    },
    {
      count: 1,
      expectedCode: "position_analysis_record_conflict",
      status: "completed",
    },
  ] as const)(
    "makes exact $status task history terminal",
    async ({ count, expectedCode, status }) => {
      const listing = await seedListing(`phase-c-task-${status}`);
      await seedAnalyses(listing, directAnalysis(), {
        includePosition: false,
      });
      const operator = await createAuthenticatedUser(
        `phase-c-task-${status}@example.test`
      );
      await seedExactTaskRuns({
        count,
        listing,
        promptVersion: JOB_POSITION_PROMPT_VERSION,
        status,
        taskType: JOB_POSITION_TASK_TYPE,
        userId: operator.userId,
      });
      const runId = await createRun(operator.cookie, {
        boards: [],
        listingIds: [listing.job.id],
      });

      await advancePublicProjectionRuns(testEnv.DB);
      await advancePublicProjectionRuns(testEnv.DB);
      expect(await listingItem(runId)).toMatchObject({
        attempt_count: 1,
        error_code: expectedCode,
        status: "blocked",
      });
    }
  );

  it("keeps a missing analysis waiting while its exact task is running", async () => {
    const listing = await seedListing("phase-c-task-running");
    await seedAnalyses(listing, directAnalysis(), { includePosition: false });
    const operator = await createAuthenticatedUser(
      "phase-c-task-running@example.test"
    );
    await seedExactTaskRuns({
      count: 1,
      listing,
      promptVersion: JOB_POSITION_PROMPT_VERSION,
      status: "running",
      taskType: JOB_POSITION_TASK_TYPE,
      userId: operator.userId,
    });
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });

    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);
    expect(await listingItem(runId)).toMatchObject({
      attempt_count: 1,
      error_code: "",
      status: "waiting_analysis",
    });
  });

  it("blocks colliding multi-position identities before writing children", async () => {
    const listing = await seedListing("phase-c-position-collision");
    const duplicate = position("English Teacher", "English");
    await seedAnalyses(listing, {
      positions: [duplicate, { ...duplicate }],
      reviewNotes: [],
      scope: "multi_position",
    });
    const operator = await createAuthenticatedUser(
      "phase-c-position-collision@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });

    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      blocked: 1,
      expanded: 0,
      runId,
    });
    expect(await listingItem(runId)).toMatchObject({
      error_code: "source_position_key_collision",
      stage: "source_positions",
      status: "blocked",
    });
    await expect(sourcePositionCounts(listing.job.id, runId)).resolves.toEqual({
      positions: 0,
      projectionItems: 0,
    });
  });

  it("rolls back projection children when immutable source-position state conflicts", async () => {
    const listing = await seedListing("phase-c-persistence-conflict");
    const analysis = directAnalysis();
    await seedAnalyses(listing, analysis);
    const operator = await createAuthenticatedUser(
      "phase-c-persistence-conflict@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);
    const [identity] = await sourcePositionIdentities(listing.job.id, analysis);
    if (!identity) {
      throw new Error("Direct identity fixture was empty");
    }
    await testEnv.DB.prepare(
      `INSERT INTO job_source_positions (
        id,listing_id,source_key,position_key,position_kind,created_at
      ) VALUES (?,?,?,'conflicting-key','extracted',?)`
    )
      .bind(identity.id, listing.job.id, listing.job.board, timestamp)
      .run();

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      blocked: 1,
      expanded: 0,
      runId,
    });
    expect(await listingItem(runId)).toMatchObject({
      error_code: "source_position_identity_conflict",
      stage: "source_positions",
      status: "blocked",
    });
    await expect(positionItems(runId)).resolves.toEqual([]);
    await expect(
      testEnv.DB.prepare(
        "SELECT position_key,position_kind FROM job_source_positions WHERE id=?"
      )
        .bind(identity.id)
        .first()
    ).resolves.toEqual({
      position_key: "conflicting-key",
      position_kind: "extracted",
    });
  });

  it("rolls back expansion when an exact analysis changes at transaction time", async () => {
    const listing = await seedListing("phase-c-transaction-mutation");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-c-transaction-mutation@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);
    const claim = await claimProjectionListing(
      testEnv.DB,
      runId,
      "source_positions",
      futureTimestamp
    );
    if (!claim) {
      throw new Error("Source-position claim fixture was unavailable");
    }
    let mutationInjected = false;
    const mutatingDb = new Proxy(testEnv.DB, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!mutationInjected) {
              mutationInjected = true;
              await target
                .prepare(
                  "UPDATE job_content_analyses SET updated_at=? WHERE job_id=?"
                )
                .bind("2026-07-22T12:01:00.000Z", listing.job.id)
                .run();
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;

    await expect(
      processProjectionSourcePositionClaim(mutatingDb, claim, futureTimestamp)
    ).resolves.toEqual({ blocked: 1, expanded: 0, waiting: 0 });
    expect(mutationInjected).toBe(true);
    expect(await listingItem(runId)).toMatchObject({
      error_code: "analysis_snapshot_changed",
      stage: "source_positions",
      status: "blocked",
    });
    await expect(sourcePositionCounts(listing.job.id, runId)).resolves.toEqual({
      positions: 0,
      projectionItems: 0,
    });
  });

  it("replays multi-position expansion with stable global identities", async () => {
    const listing = await seedListing("phase-c-stable-replay");
    const analysis: JobPositionAnalysis = {
      positions: [
        position("English Teacher", "English"),
        position("Physics Teacher", "Physics"),
      ],
      reviewNotes: [],
      scope: "multi_position",
    };
    await seedAnalyses(listing, analysis);
    const operator = await createAuthenticatedUser(
      "phase-c-stable-replay@example.test"
    );
    const firstRunId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    expect(await advanceRunThroughExpansion()).toEqual([
      expect.objectContaining({ advanced: 1, runId: firstRunId }),
      expect.objectContaining({ prerequisiteReady: 1, runId: firstRunId }),
      expect.objectContaining({ expanded: 2, runId: firstRunId }),
    ]);
    const firstIdentities = await projectionSourcePositionIds(firstRunId);
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ identified: 2, runId: firstRunId });
    const countedD1 = countingD1Database(testEnv.DB);
    await expect(
      advancePublicProjectionRuns(countedD1.db)
    ).resolves.toMatchObject({
      duplicateState: "complete",
      runId: firstRunId,
    });
    expect(countedD1.count()).toBe(39);
    const firstIdentityCheckpoints =
      await positionIdentityCheckpoints(firstRunId);

    const secondRunId = await createRun(operator.cookie, {
      boards: [listing.job.board],
      listingIds: [listing.job.id],
    });
    expect(secondRunId).not.toBe(firstRunId);
    expect(await advanceRunThroughExpansion()).toEqual([
      expect.objectContaining({ advanced: 1, runId: secondRunId }),
      expect.objectContaining({ prerequisiteReady: 1, runId: secondRunId }),
      expect.objectContaining({ expanded: 2, runId: secondRunId }),
    ]);
    const secondIdentities = await projectionSourcePositionIds(secondRunId);

    expect(firstIdentities).toHaveLength(2);
    expect(secondIdentities).toEqual(firstIdentities);
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ identified: 2, runId: secondRunId });
    await expect(positionIdentityCheckpoints(secondRunId)).resolves.toEqual(
      firstIdentityCheckpoints
    );
    await expect(
      sourcePositionCounts(listing.job.id, firstRunId)
    ).resolves.toEqual({
      positions: 2,
      projectionItems: 2,
    });
    await expect(positionItems(secondRunId)).resolves.toHaveLength(2);
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      duplicateState: "complete",
      runId: secondRunId,
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ runId: null });
  });

  it("fails an expired listing lease at its exact attempt ceiling", async () => {
    const listing = await seedListing("phase-c-expired-lease");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-c-expired-lease@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advancePublicProjectionRuns(testEnv.DB);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: Lease attempts must advance sequentially.
      const claim = await claimProjectionListing(
        testEnv.DB,
        runId,
        "prerequisites",
        futureTimestamp
      );
      expect(claim?.attemptCount).toBe(attempt);
      if (attempt < 3 && claim) {
        await testEnv.DB.prepare(
          `UPDATE public_projection_listing_items
              SET status='queued',lease_owner=NULL,lease_token=NULL,
                  lease_expires_at=NULL,updated_at=? WHERE id=?`
        )
          .bind(futureTimestamp, claim.id)
          .run();
      }
    }
    await testEnv.DB.prepare(
      `UPDATE public_projection_listing_items
          SET lease_expires_at='2000-01-01T00:00:00.000Z'
        WHERE run_id=? AND status='processing'`
    )
      .bind(runId)
      .run();

    const countedRecovery = countingD1Database(testEnv.DB);
    await expect(
      advancePublicProjectionRuns(countedRecovery.db)
    ).resolves.toMatchObject({
      requeued: 1,
      runId,
    });
    expect(countedRecovery.count()).toBe(4);
    expect(await listingItem(runId)).toMatchObject({
      attempt_count: 3,
      error_code: "projection_attempts_exhausted",
      status: "failed",
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ duplicateState: "complete", runId });
    await expect(runStatus(runId)).resolves.toBe("running");
    await expect(advanceUntilFinalDuplicateComplete()).resolves.toMatchObject({
      finalDuplicateState: "complete",
      runId,
    });
    await expect(runStatus(runId)).resolves.toBe("completed_with_blocks");
  });

  it("rejects finalization after a projection listing lease has expired", async () => {
    const listing = await seedListing("phase-c-expired-finalization");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-c-expired-finalization@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advancePublicProjectionRuns(testEnv.DB);
    const expiredTimestamp = "2000-01-01T00:00:00.000Z";
    const claim = await claimProjectionListing(
      testEnv.DB,
      runId,
      "prerequisites",
      expiredTimestamp
    );
    if (!claim) {
      throw new Error("Expected an expired projection claim fixture");
    }

    await expect(
      processProjectionPrerequisiteClaim(testEnv.DB, claim, expiredTimestamp)
    ).rejects.toThrow("lost its lease fence");
    expect(await listingItem(runId)).toMatchObject({
      attempt_count: 1,
      stage: "prerequisites",
      status: "processing",
    });
  });

  it("rotates to a newly queued run before continuing an older run", async () => {
    const first = await seedListing("phase-c-fair-first");
    const second = await seedListing("phase-c-fair-second");
    await seedAnalyses(first, directAnalysis());
    await seedAnalyses(second, directAnalysis());
    const operator = await createAuthenticatedUser("phase-c-fair@example.test");
    const firstRunId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [first.job.id],
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      runId: firstRunId,
    });
    const secondRunId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [second.job.id],
    });
    await expect(runStates([firstRunId, secondRunId])).resolves.toEqual([
      { id: firstRunId, status: "running" },
      { id: secondRunId, status: "queued" },
    ]);

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      prerequisiteReady: 1,
      runId: firstRunId,
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      advanced: 1,
      runId: secondRunId,
      selected: 1,
    });
    expect(await listingItem(firstRunId)).toMatchObject({
      attempt_count: 1,
      stage: "source_positions",
      status: "queued",
    });
  });

  it("prioritizes a projected waiter in the shared position-analysis broker", async () => {
    const waiter = await seedListing("phase-c-broker-waiter");
    const ordinary = await seedListing("phase-c-broker-ordinary");
    await seedAnalyses(waiter, directAnalysis(), { includePosition: false });
    await testEnv.DB.prepare("UPDATE job_listings SET updated_at=? WHERE id=?")
      .bind("2026-07-23T12:00:00.000Z", ordinary.job.id)
      .run();
    const operator = await createAuthenticatedUser(
      "phase-c-broker-priority@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [waiter.job.id],
    });
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);
    expect(await listingItem(runId)).toMatchObject({
      status: "waiting_analysis",
    });
    const runner = await seedRunner(operator.userId, "phase-c-broker-priority");

    const task = await claimJobPositionTask(testEnv.DB, runner);
    expect(task).not.toBeNull();
    await expect(
      testEnv.DB.prepare(
        "SELECT source_task_id FROM agent_task_runs WHERE id=?"
      )
        .bind(task?.runId)
        .first()
    ).resolves.toEqual({ source_task_id: waiter.job.id });
  });

  it("supersedes active children atomically when the source cohort drifts", async () => {
    const listing = await seedListing("phase-c-active-supersession");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-c-active-supersession@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advancePublicProjectionRuns(testEnv.DB);
    await advanceListingMaterial(listing);

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      drift: "source_watermark_changed",
      runId,
    });
    expect(await listingItem(runId)).toMatchObject({
      error_code: "projection_run_failed",
      status: "superseded",
    });
    await expect(runStatus(runId)).resolves.toBe("failed");
    await expect(
      testEnv.DB.prepare(
        `SELECT listing_superseded,listing_total
           FROM public_projection_runs WHERE id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({ listing_superseded: 1, listing_total: 1 });
  });

  it("fails run drift before inspecting a waiting analysis item", async () => {
    const listing = await seedListing("phase-c-waiter-supersession");
    const operator = await createAuthenticatedUser(
      "phase-c-waiter-supersession@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);
    expect(await listingItem(runId)).toMatchObject({
      stage: "prerequisites",
      status: "waiting_analysis",
    });
    await advanceListingMaterial(listing);

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      drift: "source_watermark_changed",
      runId,
    });
    expect(await listingItem(runId)).toMatchObject({
      error_code: "projection_run_failed",
      status: "superseded",
    });
    await expect(runStatus(runId)).resolves.toBe("failed");
    await expect(
      testEnv.DB.prepare(
        `SELECT listing_blocked,listing_superseded
           FROM public_projection_runs WHERE id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({ listing_blocked: 0, listing_superseded: 1 });
  });

  it("derives exact versioned identity signals and queues canonical resolution", async () => {
    const listing = await seedListing("phase-d1-identity-signals");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d1-identity-signals@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      blocked: 0,
      identified: 1,
      runId,
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      duplicateComparisons: 0,
      duplicateState: "complete",
      runId,
    });

    const item = await positionItem(runId);
    const checkpoint = JSON.parse(item.checkpoint_json) as {
      identity: {
        contractVersion: number;
        signals: Array<{ hash: string; kind: string }>;
        state: string;
      };
    };
    const expectedSignals = await Promise.all([
      materialCloneSignal(listing.materialHash),
      sourceReferenceSignal({
        sourceKey: listing.job.board,
        sourceReference: listing.job.sourceReference,
      }),
    ]);
    expectedSignals.sort((left, right) =>
      left.kind.localeCompare(right.kind, "en")
    );
    expect(item).toMatchObject({
      attempt_count: 1,
      error_code: "",
      stage: "canonical_resolution",
      status: "queued",
    });
    expect(checkpoint.identity).toMatchObject({
      contractVersion: 1,
      signals: expectedSignals,
      state: "derived",
    });
    await expect(runStatus(runId)).resolves.toBe("running");
    await expect(
      testEnv.DB.prepare(
        `SELECT canonical_identity_state,comparison_count,
                position_member_count
           FROM public_projection_duplicate_batches WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      canonical_identity_state: "pending",
      comparison_count: 0,
      position_member_count: 1,
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ runId: null });
  });

  it("seals one exact canonical resolution without mutating a nonempty public graph", async () => {
    const listing = await seedListing("phase-d3-canonical-resolution");
    await seedAnalyses(listing, directAnalysis());
    await seedResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "phase-d3-canonical-resolution@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ identified: 1, runId });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ duplicateState: "complete", runId });

    await seedExistingPublicGraph();
    const publicGraphBefore = await publicGraphSnapshot();
    expect(publicGraphBefore.publicJobs).toHaveLength(1);
    const resolver = createMapboxPermanentLocationResolver(
      "fixture-token",
      async () => Response.json(mapboxTbilisiFixture())
    );
    const claim = await claimProjectionPosition(
      testEnv.DB,
      runId,
      "canonical_resolution",
      futureTimestamp,
      { requireUnsealedCanonicalResolution: true }
    );
    if (!claim) {
      throw new Error("Expected a sealed D2 canonical-resolution claim");
    }
    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        resolver
      )
    ).resolves.toMatchObject({
      blocked: 0,
      resolved: 1,
      sealed: 1,
      state: "resolved",
    });

    await expect(publicGraphSnapshot()).resolves.toEqual(publicGraphBefore);
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,selected_organization_id
           FROM public_projection_organization_resolutions WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      reason_code: "organization_name_country_locality",
      selected_organization_id: "organization:example-school-ge",
      state: "resolved",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT resolution.state,resolution.reason_code,
                provider.provider,provider.permanent
           FROM public_projection_location_resolutions resolution
           JOIN public_projection_location_provider_evidence provider
             ON provider.resolution_id=resolution.id
          WHERE resolution.run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      permanent: 1,
      provider: "mapbox-geocoding-v6",
      reason_code: "location_exact_provider_match",
      state: "resolved",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,canonical_signal_hash,seal_hash
           FROM public_projection_resolution_seals WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toMatchObject({
      reason_code: "canonical_resolution_resolved",
      state: "resolved",
    });
    await expect(
      testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM canonical_locations"
      ).first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      claimProjectionPosition(
        testEnv.DB,
        runId,
        "canonical_resolution",
        futureTimestamp,
        { requireUnsealedCanonicalResolution: true }
      )
    ).resolves.toBeNull();
    await expect(
      testEnv.DB.prepare(
        `UPDATE public_projection_resolution_seals
            SET reason_code='changed' WHERE run_id=?`
      )
        .bind(runId)
        .run()
    ).rejects.toThrow("canonical resolution seals are immutable");
    await expect(
      testEnv.DB.prepare(
        "DELETE FROM public_projection_location_resolutions WHERE run_id=?"
      )
        .bind(runId)
        .run()
    ).rejects.toThrow("location resolutions are append-only");
  });

  it("seals a provider-auth block without publishing a canonical signal", async () => {
    const listing = await seedListing("phase-d3-provider-auth-block");
    await seedAnalyses(listing, directAnalysis());
    await seedResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "phase-d3-provider-auth-block@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);
    const claim = await claimProjectionPosition(
      testEnv.DB,
      runId,
      "canonical_resolution",
      futureTimestamp,
      { requireUnsealedCanonicalResolution: true }
    );
    if (!claim) {
      throw new Error("Expected a provider-auth canonical-resolution claim");
    }

    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        createMapboxPermanentLocationResolver(undefined)
      )
    ).resolves.toMatchObject({ blocked: 1, sealed: 1, state: "blocked" });
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,canonical_signal_hash
           FROM public_projection_resolution_seals WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      canonical_signal_hash: null,
      reason_code: "location_provider_auth",
      state: "blocked",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT state,signal_hash
           FROM public_projection_canonical_identity_signals WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({ signal_hash: null, state: "blocked" });
  });

  it("keeps raw opportunity and hostname matches as candidate evidence", async () => {
    const listing = await seedListing("phase-d3-unaccepted-organization", {
      applyUrl: "https://unaccepted.example.test/apply",
      company: "Unaccepted Board Listing",
      employerId: "unaccepted-employer",
      sourceUrl: "https://unaccepted.example.test/jobs/1",
    });
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d3-unaccepted-organization@example.test"
    );
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO organizations (
          id,country_code,country_name,name,identity_key,city,canonical_domain,
          market_segment,status,outreach_eligibility,created_at,updated_at
        ) VALUES (
          'organization:unaccepted','GE','Georgia','Unaccepted Recruiter',
          'domain:unaccepted.example.test','Batumi','unaccepted.example.test','school','active',
          'review',?,?
        )`
      ).bind(timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO organization_evidence (
          id,organization_id,source_kind,evidence_kind,evidence_status,
          source_url,observed_at,created_at
        ) VALUES (
          'organization-evidence:unaccepted','organization:unaccepted',
          'historical_workbook','vacancy','active','https://unaccepted.example.test/jobs',
          ?,?
        )`
      ).bind(timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO organization_opportunities (
          organization_id,job_id,evidence_url,linked_at
        ) VALUES (
          'organization:unaccepted',?,'https://unaccepted.example.test/jobs',?
        )`
      ).bind(listing.job.id, timestamp),
    ]);
    const { claim, runId } = await canonicalResolutionClaim(
      listing,
      operator.cookie
    );
    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        createMapboxPermanentLocationResolver("fixture-token", () =>
          Promise.resolve(Response.json(mapboxTbilisiFixture()))
        )
      )
    ).resolves.toMatchObject({ blocked: 1, sealed: 1, state: "unresolved" });
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,selected_organization_id
           FROM public_projection_organization_resolutions WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      reason_code: "organization_candidate_only",
      selected_organization_id: null,
      state: "unresolved",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT evidence_tier,polarity
           FROM public_projection_organization_evidence
          WHERE run_id=? AND evidence_kind='employer_domain'`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({ evidence_tier: 4, polarity: "candidate" });
  });

  it("resolves an operator-accepted source employer identity", async () => {
    const listing = await seedListing("phase-d3-source-employer", {
      company: "Source Employer Listing",
      employerId: "source-employer-unique",
    });
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d3-source-employer@example.test"
    );
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO organizations (
          id,country_code,country_name,name,identity_key,city,market_segment,
          status,outreach_eligibility,created_at,updated_at
        ) VALUES (
          'organization:source-employer','GE','Georgia','Mapped School',
          'name:mapped school','Batumi','school','active','review',?,?
        )`
      ).bind(timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO organization_source_employer_mappings (
          source_key,employer_id,organization_id,accepted_by_user_id,
          accepted_at,created_at
        ) VALUES (
          ?,?,'organization:source-employer',?,?,?
        )`
      ).bind(
        listing.job.board,
        listing.job.employerId,
        operator.userId,
        timestamp,
        timestamp
      ),
    ]);
    const { claim, runId } = await canonicalResolutionClaim(
      listing,
      operator.cookie
    );
    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        createMapboxPermanentLocationResolver("fixture-token", () =>
          Promise.resolve(Response.json(mapboxTbilisiFixture()))
        )
      )
    ).resolves.toMatchObject({ blocked: 0, resolved: 1, sealed: 1 });
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,selected_organization_id
           FROM public_projection_organization_resolutions WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      reason_code: "organization_source_employer_id",
      selected_organization_id: "organization:source-employer",
      state: "resolved",
    });
  });

  it("resolves a version-pinned verified registrable employer domain", async () => {
    const listing = await seedListing("phase-d3-verified-domain", {
      applyUrl: "https://careers.school.co.uk/openings/english-teacher",
      company: "Board-supplied employer label",
      sourceUrl: "https://board.example.test/jobs/verified-domain",
    });
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d3-verified-domain@example.test"
    );
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO organizations (
          id,country_code,country_name,name,identity_key,city,canonical_domain,
          market_segment,status,outreach_eligibility,created_at,updated_at
        ) VALUES (
          'organization:verified-domain','GE','Georgia','Verified School',
          'domain:school.co.uk','Tbilisi','school.co.uk','school','active',
          'review',?,?
        )`
      ).bind(timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO organization_domain_mappings (
          id,organization_id,mapping_kind,normalized_host,registrable_domain,
          path_prefix,public_suffix_list_version,accepted_by_user_id,
          accepted_at,evidence_url,created_at
        ) VALUES (
          'domain-mapping:verified-domain','organization:verified-domain',
          'employer_registrable_domain','school.co.uk','school.co.uk','',
          'tldts-7.4.8-icann',?,?,'https://school.co.uk/about',?
        )`
      ).bind(operator.userId, timestamp, timestamp),
    ]);
    const { claim, runId } = await canonicalResolutionClaim(
      listing,
      operator.cookie
    );

    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        createMapboxPermanentLocationResolver("fixture-token", () =>
          Promise.resolve(Response.json(mapboxTbilisiFixture()))
        )
      )
    ).resolves.toMatchObject({ blocked: 0, resolved: 1, sealed: 1 });
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,selected_organization_id
           FROM public_projection_organization_resolutions WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      reason_code: "organization_employer_domain",
      selected_organization_id: "organization:verified-domain",
      state: "resolved",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT evidence_tier,polarity,source_key,source_reference
           FROM public_projection_organization_evidence
          WHERE run_id=? AND evidence_kind='employer_domain'`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      evidence_tier: 2,
      polarity: "positive",
      source_key: "organization_domain_mappings",
      source_reference: "domain-mapping:verified-domain",
    });
  });

  it("resolves only the explicitly verified hosted ATS tenant", async () => {
    const listing = await seedListing("phase-d3-verified-ats", {
      applyUrl: "https://jobs.greenhouse.io/example-school/jobs/42",
      company: "Shared ATS listing",
      sourceUrl: "https://board.example.test/jobs/verified-ats",
    });
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d3-verified-ats@example.test"
    );
    await testEnv.DB.batch([
      ...["example", "other"].map((tenant) =>
        testEnv.DB.prepare(
          `INSERT INTO organizations (
            id,country_code,country_name,name,identity_key,city,
            canonical_domain,market_segment,status,outreach_eligibility,
            created_at,updated_at
          ) VALUES (?,?,?,?,?,'Tbilisi',?,'school','active','review',?,?)`
        ).bind(
          `organization:${tenant}-ats`,
          "GE",
          "Georgia",
          `${tenant} ATS School`,
          `domain:${tenant}-school.ge`,
          `${tenant}-school.ge`,
          timestamp,
          timestamp
        )
      ),
      ...["example", "other"].map((tenant) =>
        testEnv.DB.prepare(
          `INSERT INTO organization_domain_mappings (
            id,organization_id,mapping_kind,normalized_host,
            registrable_domain,path_prefix,public_suffix_list_version,
            accepted_by_user_id,accepted_at,evidence_url,created_at
          ) VALUES (?,?, 'hosted_ats_tenant','jobs.greenhouse.io',
                    'greenhouse.io',?,'tldts-7.4.8-icann',?,?,?,?)`
        ).bind(
          `domain-mapping:${tenant}-ats`,
          `organization:${tenant}-ats`,
          `/${tenant}-school`,
          operator.userId,
          timestamp,
          `https://${tenant}-school.ge/`,
          timestamp
        )
      ),
    ]);
    const { claim, runId } = await canonicalResolutionClaim(
      listing,
      operator.cookie
    );

    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        createMapboxPermanentLocationResolver("fixture-token", () =>
          Promise.resolve(Response.json(mapboxTbilisiFixture()))
        )
      )
    ).resolves.toMatchObject({ blocked: 0, resolved: 1, sealed: 1 });
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,selected_organization_id
           FROM public_projection_organization_resolutions WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      reason_code: "organization_employer_domain",
      selected_organization_id: "organization:example-ats",
      state: "resolved",
    });
  });

  it.each([
    ["exact corroboration", ["a"] as const, "resolved"],
    ["overlapping contradiction", ["a", "b"] as const, "ambiguous"],
    ["disjoint contradiction", ["b", "c"] as const, "ambiguous"],
  ] as const)(
    "evaluates the complete Tier-2 verified-domain set for %s",
    async (fixtureName, tierTwoOrganizations, expectedState) => {
      const fixtureKey = fixtureName.replaceAll(" ", "-");
      const listing = await seedListing(
        `phase-d3-tier-conflict-${fixtureKey}`,
        {
          applyUrl: "https://jobs.greenhouse.io/tenant/jobs/english-teacher",
          company: "Tier conflict board label",
          sourceUrl: `https://board.example.test/jobs/${fixtureKey}`,
        }
      );
      await seedAnalyses(listing, directAnalysis());
      const operator = await createAuthenticatedUser(
        `phase-d3-tier-conflict-${fixtureKey}@example.test`
      );
      await testEnv.DB.batch([
        ...["a", "b", "c"].map((organizationKey) =>
          testEnv.DB.prepare(
            `INSERT INTO organizations (
              id,country_code,country_name,name,identity_key,city,
              canonical_domain,market_segment,status,outreach_eligibility,
              created_at,updated_at
            ) VALUES (?,?, 'Georgia',?,?, 'Tbilisi',?,'school','active',
                      'review',?,?)`
          ).bind(
            `organization:tier-${fixtureKey}-${organizationKey}`,
            "GE",
            `Tier ${organizationKey.toUpperCase()} School`,
            `name:tier ${fixtureKey} ${organizationKey} school`,
            `tier-${fixtureKey}-${organizationKey}-school.ge`,
            timestamp,
            timestamp
          )
        ),
        testEnv.DB.prepare(
          `INSERT INTO organization_opportunities (
            organization_id,job_id,evidence_url,linked_at
          ) VALUES (
            ?,?,'https://tier-a-school.ge/jobs',?
          )`
        ).bind(`organization:tier-${fixtureKey}-a`, listing.job.id, timestamp),
        testEnv.DB.prepare(
          `INSERT INTO organization_opportunity_acceptances (
            organization_id,job_id,accepted_by_user_id,accepted_at,created_at
          ) VALUES (?,?,?,?,?)`
        ).bind(
          `organization:tier-${fixtureKey}-a`,
          listing.job.id,
          operator.userId,
          timestamp,
          timestamp
        ),
        ...tierTwoOrganizations.map((organizationKey) => {
          const pathPrefix = {
            a: "/tenant",
            b: "/tenant/jobs",
            c: "/tenant/jobs/english-teacher",
          }[organizationKey];
          return testEnv.DB.prepare(
            `INSERT INTO organization_domain_mappings (
              id,organization_id,mapping_kind,normalized_host,
              registrable_domain,path_prefix,public_suffix_list_version,
              accepted_by_user_id,accepted_at,evidence_url,created_at
            ) VALUES (?,?,'hosted_ats_tenant','jobs.greenhouse.io',
                      'greenhouse.io',?,'tldts-7.4.8-icann',?,?,?,?)`
          ).bind(
            `domain-mapping:tier-${fixtureKey}-${organizationKey}`,
            `organization:tier-${fixtureKey}-${organizationKey}`,
            pathPrefix,
            operator.userId,
            timestamp,
            `https://tier-${organizationKey}-school.ge/careers`,
            timestamp
          );
        }),
      ]);
      const { claim, runId } = await canonicalResolutionClaim(
        listing,
        operator.cookie
      );

      await expect(
        processProjectionCanonicalResolutionClaim(
          testEnv.DB,
          claim,
          futureTimestamp,
          createMapboxPermanentLocationResolver("fixture-token", () =>
            Promise.resolve(Response.json(mapboxTbilisiFixture()))
          )
        )
      ).resolves.toMatchObject({
        blocked: expectedState === "resolved" ? 0 : 1,
        resolved: expectedState === "resolved" ? 1 : 0,
        sealed: 1,
        state: expectedState,
      });
      await expect(
        testEnv.DB.prepare(
          `SELECT state,reason_code,selected_organization_id
             FROM public_projection_organization_resolutions WHERE run_id=?`
        )
          .bind(runId)
          .first()
      ).resolves.toEqual(
        expectedState === "resolved"
          ? {
              reason_code: "organization_explicit_link",
              selected_organization_id: `organization:tier-${fixtureKey}-a`,
              state: "resolved",
            }
          : {
              reason_code: "organization_evidence_conflict",
              selected_organization_id: null,
              state: "ambiguous",
            }
      );
    }
  );

  it("pins domain mappings to an operator and suffix-list version", async () => {
    const operator = await createAuthenticatedUser(
      "phase-d3-domain-mapping-operator@example.test"
    );
    const member = await createAuthenticatedUser(
      "phase-d3-domain-mapping-member@example.test",
      "member"
    );
    await testEnv.DB.prepare(
      `INSERT INTO organizations (
        id,country_code,country_name,name,identity_key,canonical_domain,
        market_segment,status,outreach_eligibility,created_at,updated_at
      ) VALUES (
        'organization:domain-guard','GE','Georgia','Domain Guard School',
        'domain:guard-school.ge','guard-school.ge','school','active','review',?,?
      )`
    )
      .bind(timestamp, timestamp)
      .run();
    const mappingStatement = () =>
      testEnv.DB.prepare(
        `INSERT INTO organization_domain_mappings (
          id,organization_id,mapping_kind,normalized_host,registrable_domain,
          path_prefix,public_suffix_list_version,accepted_by_user_id,
          accepted_at,evidence_url,created_at
        ) VALUES (
          ?,'organization:domain-guard','employer_registrable_domain',
          'guard-school.ge','guard-school.ge','',?,?,?,
          'https://guard-school.ge/about',?
        )`
      );

    await expect(
      mappingStatement()
        .bind(
          "domain-mapping:wrong-psl",
          "tldts-unpinned",
          operator.userId,
          timestamp,
          timestamp
        )
        .run()
    ).rejects.toThrow();
    await expect(
      mappingStatement()
        .bind(
          "domain-mapping:member",
          "tldts-7.4.8-icann",
          member.userId,
          timestamp,
          timestamp
        )
        .run()
    ).rejects.toThrow();
    await expect(
      mappingStatement()
        .bind(
          "domain-mapping:operator",
          "tldts-7.4.8-icann",
          operator.userId,
          timestamp,
          timestamp
        )
        .run()
    ).resolves.toMatchObject({ success: true });
  });

  it("rolls back every D3 artifact when the final claim CAS loses", async () => {
    const listing = await seedListing("phase-d3-final-cas-rollback");
    await seedAnalyses(listing, directAnalysis());
    await seedResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "phase-d3-final-cas-rollback@example.test"
    );
    const { claim, runId } = await canonicalResolutionClaim(
      listing,
      operator.cookie
    );
    await testEnv.DB.prepare(
      `CREATE TRIGGER test_d3_final_cas_sabotage
       AFTER INSERT ON public_projection_resolution_seals
       BEGIN
         UPDATE public_projection_position_items
            SET lease_token='sabotaged'
          WHERE id=NEW.position_item_id AND run_id=NEW.run_id;
       END`
    ).run();
    try {
      await expect(
        processProjectionCanonicalResolutionClaim(
          testEnv.DB,
          claim,
          futureTimestamp,
          createMapboxPermanentLocationResolver("fixture-token", () =>
            Promise.resolve(Response.json(mapboxTbilisiFixture()))
          )
        )
      ).rejects.toThrow();
    } finally {
      await testEnv.DB.prepare("DROP TRIGGER test_d3_final_cas_sabotage").run();
    }
    await expect(
      testEnv.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM public_projection_organization_resolutions
            WHERE run_id=?) organizations,
          (SELECT COUNT(*) FROM public_projection_location_resolutions
            WHERE run_id=?) locations,
          (SELECT COUNT(*) FROM public_projection_resolution_seals
            WHERE run_id=?) seals`
      )
        .bind(runId, runId, runId)
        .first()
    ).resolves.toEqual({ locations: 0, organizations: 0, seals: 0 });
    await expect(
      testEnv.DB.prepare(
        `SELECT json_extract(checkpoint_json,'$.resolutionGuard') guard,
                lease_token
           FROM public_projection_position_items WHERE id=?`
      )
        .bind(claim.id)
        .first()
    ).resolves.toEqual({ guard: null, lease_token: claim.leaseToken });
  });

  it("rolls back D3 before artifacts when the exact guard loses", async () => {
    const listing = await seedListing("phase-d3-guard-rollback");
    await seedAnalyses(listing, directAnalysis());
    await seedResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "phase-d3-guard-rollback@example.test"
    );
    const { claim, runId } = await canonicalResolutionClaim(
      listing,
      operator.cookie
    );
    let mutationInjected = false;
    const mutatingDb = new Proxy(testEnv.DB, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!mutationInjected) {
              mutationInjected = true;
              await target
                .prepare(
                  "UPDATE job_content_analyses SET updated_at=? WHERE job_id=?"
                )
                .bind("2026-07-22T12:01:00.000Z", listing.job.id)
                .run();
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;
    await expect(
      processProjectionCanonicalResolutionClaim(
        mutatingDb,
        claim,
        futureTimestamp,
        createMapboxPermanentLocationResolver("fixture-token", () =>
          Promise.resolve(Response.json(mapboxTbilisiFixture()))
        )
      )
    ).rejects.toThrow();
    expect(mutationInjected).toBe(true);
    await expect(
      testEnv.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM public_projection_organization_resolutions
            WHERE run_id=?) organizations,
          (SELECT COUNT(*) FROM public_projection_location_resolutions
            WHERE run_id=?) locations,
          json_extract(checkpoint_json,'$.resolutionGuard') guard
         FROM public_projection_position_items WHERE id=?`
      )
        .bind(runId, runId, claim.id)
        .first()
    ).resolves.toEqual({ guard: null, locations: 0, organizations: 0 });
  });

  it("uses a resolved parent bounding box for a child location", async () => {
    const listing = await seedListing("phase-d3-parent-bbox");
    await seedAnalyses(listing, parentAndChildAnalysis());
    await seedResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "phase-d3-parent-bbox@example.test"
    );
    const { claim } = await canonicalResolutionClaim(listing, operator.cookie);
    const queries: Array<{ bbox?: number[] | null; literalLabel: string }> = [];
    const resolver: PermanentLocationResolver = {
      resolve(query) {
        queries.push(query);
        return Promise.resolve(
          permanentFixtureResponse(
            query.literalLabel === "Georgia"
              ? mapboxGeorgiaFixture()
              : mapboxTbilisiFixture(),
            query.literalLabel
          )
        );
      },
    };
    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        resolver
      )
    ).resolves.toMatchObject({ resolved: 1, sealed: 1 });
    expect(queries).toEqual([
      {
        bbox: null,
        countryCode: "GE",
        literalLabel: "Georgia",
        semanticKind: "country",
      },
      {
        bbox: [39.9, 41.0, 46.8, 43.7],
        countryCode: "GE",
        literalLabel: "Tbilisi",
        semanticKind: "city",
      },
    ]);
  });

  it("keeps parent-safe provider queries stable when source locations reverse", async () => {
    const firstListing = await seedListing("phase-d3-parent-order-first");
    const secondListing = await seedListing("phase-d3-parent-order-second");
    const analysis = parentAndChildAnalysis();
    await seedAnalyses(firstListing, analysis);
    await seedAnalyses(secondListing, {
      ...analysis,
      positions: analysis.positions.map((value) => ({
        ...value,
        locations: [...value.locations].reverse(),
      })),
    });
    await seedResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "phase-d3-parent-order@example.test"
    );
    const firstClaim = await canonicalResolutionClaim(
      firstListing,
      operator.cookie
    );
    const secondClaim = await canonicalResolutionClaim(
      secondListing,
      operator.cookie
    );
    const queryRuns: Array<
      Array<{ bbox?: number[] | null; literalLabel: string }>
    > = [[], []];
    const resolverForRun = (runIndex: number): PermanentLocationResolver => ({
      resolve(query) {
        queryRuns[runIndex]?.push(query);
        return Promise.resolve(
          permanentFixtureResponse(
            query.literalLabel === "Georgia"
              ? mapboxGeorgiaFixture()
              : mapboxTbilisiFixture(),
            query.literalLabel
          )
        );
      },
    });

    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      firstClaim.claim,
      futureTimestamp,
      resolverForRun(0)
    );
    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      secondClaim.claim,
      futureTimestamp,
      resolverForRun(1)
    );

    const expectedQueries = [
      {
        bbox: null,
        countryCode: "GE",
        literalLabel: "Georgia",
        semanticKind: "country",
      },
      {
        bbox: [39.9, 41, 46.8, 43.7],
        countryCode: "GE",
        literalLabel: "Tbilisi",
        semanticKind: "city",
      },
    ];
    expect(queryRuns[0]).toEqual(expectedQueries);
    expect(queryRuns[1]).toEqual(expectedQueries);
  });

  it("rejects provider candidates with a wrong parent or unmatched address", async () => {
    const parentListing = await seedListing("phase-d3-parent-mismatch");
    await seedAnalyses(parentListing, parentMismatchAnalysis());
    const parentOperator = await createAuthenticatedUser(
      "phase-d3-parent-mismatch@example.test"
    );
    const parentClaim = await canonicalResolutionClaim(
      parentListing,
      parentOperator.cookie
    );
    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      parentClaim.claim,
      futureTimestamp,
      createMapboxPermanentLocationResolver("fixture-token", () =>
        Promise.resolve(Response.json(mapboxTbilisiFixture()))
      )
    );
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,viable_candidate_count
           FROM public_projection_location_resolutions WHERE run_id=?`
      )
        .bind(parentClaim.runId)
        .first()
    ).resolves.toEqual({
      reason_code: "location_parent_conflict",
      state: "ambiguous",
      viable_candidate_count: 0,
    });

    const addressListing = await seedListing("phase-d3-address-mismatch");
    await seedAnalyses(addressListing, addressAnalysis());
    const addressOperator = await createAuthenticatedUser(
      "phase-d3-address-mismatch@example.test"
    );
    const addressClaim = await canonicalResolutionClaim(
      addressListing,
      addressOperator.cookie
    );
    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      addressClaim.claim,
      futureTimestamp,
      createMapboxPermanentLocationResolver("fixture-token", () =>
        Promise.resolve(Response.json(mapboxAddressFixture()))
      )
    );
    await expect(
      testEnv.DB.prepare(
        `SELECT resolution.state,resolution.reason_code,candidate.viable
           FROM public_projection_location_resolutions resolution
           JOIN public_projection_location_candidates candidate
             ON candidate.resolution_id=resolution.id
          WHERE resolution.run_id=?`
      )
        .bind(addressClaim.runId)
        .first()
    ).resolves.toEqual({
      reason_code: "location_no_viable_candidate",
      state: "unresolved",
      viable: 0,
    });
  });

  it("marks conflicting sealed source countries and parents ambiguous", async () => {
    const countryListing = await seedListing("phase-d3-country-conflict");
    await seedAnalyses(countryListing, sourceCountryConflictAnalysis());
    const countryOperator = await createAuthenticatedUser(
      "phase-d3-country-conflict@example.test"
    );
    const countryClaim = await canonicalResolutionClaim(
      countryListing,
      countryOperator.cookie
    );
    let providerQueries = 0;
    const resolver: PermanentLocationResolver = {
      resolve(query) {
        providerQueries += 1;
        return Promise.resolve(
          permanentFixtureResponse(mapboxTbilisiFixture(), query.literalLabel)
        );
      },
    };

    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      countryClaim.claim,
      futureTimestamp,
      resolver
    );
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code FROM public_projection_location_resolutions
          WHERE run_id=?`
      )
        .bind(countryClaim.runId)
        .first()
    ).resolves.toEqual({
      reason_code: "location_country_conflict",
      state: "ambiguous",
    });

    const parentListing = await seedListing("phase-d3-source-parent-conflict");
    await seedAnalyses(parentListing, sourceParentConflictAnalysis());
    const parentOperator = await createAuthenticatedUser(
      "phase-d3-source-parent-conflict@example.test"
    );
    const parentClaim = await canonicalResolutionClaim(
      parentListing,
      parentOperator.cookie
    );
    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      parentClaim.claim,
      futureTimestamp,
      resolver
    );
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code FROM public_projection_location_resolutions
          WHERE run_id=?`
      )
        .bind(parentClaim.runId)
        .first()
    ).resolves.toEqual({
      reason_code: "location_parent_conflict",
      state: "ambiguous",
    });
    expect(providerQueries).toBe(0);
  });

  it("orders location roles and scopes by contract independent of source order", async () => {
    const firstListing = await seedListing("phase-d3-location-order-first");
    const secondListing = await seedListing("phase-d3-location-order-second");
    const analysis = sameLabelRoleAndScopeAnalysis();
    await seedAnalyses(firstListing, analysis);
    await seedAnalyses(secondListing, {
      ...analysis,
      positions: analysis.positions.map((value) => ({
        ...value,
        locations: [...value.locations].reverse(),
      })),
    });
    await seedResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "phase-d3-location-order@example.test"
    );
    const firstClaim = await canonicalResolutionClaim(
      firstListing,
      operator.cookie
    );
    const secondClaim = await canonicalResolutionClaim(
      secondListing,
      operator.cookie
    );
    const resolver: PermanentLocationResolver = {
      resolve(query) {
        return Promise.resolve(
          permanentFixtureResponse(mapboxTbilisiFixture(), query.literalLabel)
        );
      },
    };

    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      firstClaim.claim,
      futureTimestamp,
      resolver
    );
    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      secondClaim.claim,
      futureTimestamp,
      resolver
    );
    const orderedLocations = async (runId: string) =>
      (
        await testEnv.DB.prepare(
          `SELECT ordinal,literal_label,location_role,scope,workplace_type,
                  selected_provider_place_id,resolution_hash
             FROM public_projection_location_resolutions
            WHERE run_id=? ORDER BY ordinal`
        )
          .bind(runId)
          .all<{
            literal_label: string;
            location_role: string;
            ordinal: number;
            resolution_hash: string;
            scope: string;
            selected_provider_place_id: string;
            workplace_type: string;
          }>()
      ).results;
    const first = await orderedLocations(firstClaim.runId);
    const second = await orderedLocations(secondClaim.runId);
    expect(
      first.map(({ resolution_hash: _hash, ...location }) => location)
    ).toEqual(
      second.map(({ resolution_hash: _hash, ...location }) => location)
    );
    expect(
      first.map(({ location_role, ordinal, scope }) => ({
        location_role,
        ordinal,
        scope,
      }))
    ).toEqual([
      { location_role: "worksite", ordinal: 0, scope: "locality" },
      { location_role: "worksite", ordinal: 1, scope: "region" },
      { location_role: "applicant_area", ordinal: 2, scope: "region" },
    ]);
    expect(first.map((location) => location.resolution_hash)).toEqual([
      expect.stringMatching(SHA256_HEX_PATTERN),
      expect.stringMatching(SHA256_HEX_PATTERN),
      expect.stringMatching(SHA256_HEX_PATTERN),
    ]);
    expect(second.map((location) => location.resolution_hash)).toEqual([
      expect.stringMatching(SHA256_HEX_PATTERN),
      expect.stringMatching(SHA256_HEX_PATTERN),
      expect.stringMatching(SHA256_HEX_PATTERN),
    ]);
  });

  it("persists large provider evidence in bounded D1 pages", async () => {
    const listing = await seedListing("phase-d3-paged-provider-evidence");
    await seedAnalyses(listing, manyLocationAnalysis());
    await seedOrganizationForCity("City 0");
    const operator = await createAuthenticatedUser(
      "phase-d3-paged-provider-evidence@example.test"
    );
    const { claim, runId } = await canonicalResolutionClaim(
      listing,
      operator.cookie
    );
    const resolver: PermanentLocationResolver = {
      resolve(query) {
        return Promise.resolve(
          permanentFixtureResponse(
            mapboxCityFixture(query.literalLabel, "x".repeat(125_000)),
            query.literalLabel
          )
        );
      },
    };
    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        resolver
      )
    ).resolves.toMatchObject({ resolved: 1, sealed: 1 });
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count
           FROM public_projection_location_provider_evidence WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({ count: 10 });
  });

  it("fences exact position claims after their lease expires", async () => {
    const listing = await seedListing("phase-d1-position-lease-fence");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d1-position-lease-fence@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();
    const claim = await claimProjectionPosition(
      testEnv.DB,
      runId,
      "identity",
      futureTimestamp
    );
    expect(claim).toMatchObject({ attemptCount: 1, runId, stage: "identity" });
    await expect(
      claimProjectionPosition(testEnv.DB, runId, "identity", futureTimestamp)
    ).resolves.toBeNull();
    if (!claim) {
      throw new Error("Expected an exact position claim fixture");
    }
    await testEnv.DB.prepare(
      `UPDATE public_projection_position_items
          SET lease_expires_at='2000-01-01T00:00:00.000Z'
        WHERE id=?`
    )
      .bind(claim.id)
      .run();

    await expect(
      processProjectionIdentityClaim(testEnv.DB, claim, futureTimestamp)
    ).rejects.toThrow("Projection position lease changed during processing");
    expect(await positionItem(runId)).toMatchObject({
      attempt_count: 1,
      stage: "identity",
      status: "processing",
    });
  });

  it("fails an expired position lease at its exact retry ceiling", async () => {
    const listing = await seedListing("phase-d1-position-attempt-ceiling");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d1-position-attempt-ceiling@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: Lease attempts must advance sequentially.
      const claim = await claimProjectionPosition(
        testEnv.DB,
        runId,
        "identity",
        futureTimestamp
      );
      expect(claim?.attemptCount).toBe(attempt);
      if (attempt < 3 && claim) {
        await testEnv.DB.prepare(
          `UPDATE public_projection_position_items
              SET status='queued',lease_owner=NULL,lease_token=NULL,
                  lease_expires_at=NULL,updated_at=? WHERE id=?`
        )
          .bind(futureTimestamp, claim.id)
          .run();
      }
    }
    await testEnv.DB.prepare(
      `UPDATE public_projection_position_items
          SET lease_expires_at='2000-01-01T00:00:00.000Z'
        WHERE run_id=? AND status='processing'`
    )
      .bind(runId)
      .run();

    const countedRecovery = countingD1Database(testEnv.DB);
    await expect(
      advancePublicProjectionRuns(countedRecovery.db)
    ).resolves.toMatchObject({
      requeued: 1,
      runId,
    });
    expect(countedRecovery.count()).toBe(4);
    const item = await positionItem(runId);
    expect(item).toMatchObject({
      attempt_count: 3,
      error_code: "projection_attempts_exhausted",
      stage: "identity",
      status: "failed",
    });
    expect(item.completed_at).not.toBe(futureTimestamp);
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ duplicateState: "complete", runId });
    await expect(runStatus(runId)).resolves.toBe("running");
    await expect(advanceUntilFinalDuplicateComplete()).resolves.toMatchObject({
      finalDuplicateState: "complete",
      runId,
    });
    await expect(runStatus(runId)).resolves.toBe("completed_with_blocks");
  });

  it("blocks a corrupt identity seal and completes the terminal run", async () => {
    const listing = await seedListing("phase-d1-corrupt-seal");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d1-corrupt-seal@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();
    await testEnv.DB.prepare(
      `UPDATE public_projection_position_items
          SET checkpoint_json=json_set(
            checkpoint_json,'$.positionPayloadHash',?
          )
        WHERE run_id=? AND stage='identity' AND status='queued'`
    )
      .bind("0".repeat(64), runId)
      .run();

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ blocked: 1, identified: 0, runId });
    expect(await positionItem(runId)).toMatchObject({
      error_code: "identity_seal_mismatch",
      stage: "identity",
      status: "blocked",
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ duplicateState: "complete", runId });
    await expect(runStatus(runId)).resolves.toBe("running");
    await expect(advanceUntilFinalDuplicateComplete()).resolves.toMatchObject({
      finalDuplicateState: "complete",
      runId,
    });
    await expect(runStatus(runId)).resolves.toBe("completed_with_blocks");
  });

  it("supersedes queued identity work when its source snapshot drifts", async () => {
    const listing = await seedListing("phase-d1-identity-supersession");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d1-identity-supersession@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();
    await advanceListingMaterial(listing);

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      drift: "source_watermark_changed",
      identified: 0,
      runId,
    });
    expect(await positionItem(runId)).toMatchObject({
      error_code: "projection_run_failed",
      stage: "identity",
      status: "superseded",
    });
    await expect(runStatus(runId)).resolves.toBe("failed");
  });

  it("rotates from older identity work to a competing queued run", async () => {
    const first = await seedListing("phase-d1-fair-identity");
    const second = await seedListing("phase-d1-fair-selection");
    await seedAnalyses(first, directAnalysis());
    await seedAnalyses(second, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d1-fair-rotation@example.test"
    );
    const firstRunId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [first.job.id],
    });
    await advanceRunThroughExpansion();
    const secondRunId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [second.job.id],
    });
    await testEnv.DB.prepare(
      "UPDATE public_projection_runs SET updated_at=? WHERE id=?"
    )
      .bind("2000-01-01T00:00:00.000Z", firstRunId)
      .run();

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ identified: 1, runId: firstRunId });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      advanced: 1,
      runId: secondRunId,
      selected: 1,
    });
  });
});

async function seedListing(
  id: string,
  overrides: Partial<InventoryJob> = {}
): Promise<SeededListing> {
  const job: InventoryJob = {
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
    description:
      "Teach English and support adult learners in Tbilisi. Housing is provided.",
    employerId: "employer-42",
    lastSeenAt: timestamp,
    location: "Tbilisi, Georgia",
    marketSegments: ["school"],
    salary: "$2,500-$3,000 monthly",
    sourceDates: {
      expires: { date: null, provenance: "unknown", raw: "" },
      posted: {
        date: "2026-07-20",
        provenance: "board-published",
        raw: "July 20, 2026",
      },
    },
    sourceReference: id,
    sourceUrl: `https://example.test/jobs/${id}`,
    title: "English Teacher",
    ...overrides,
    id,
  };
  const materialJson = serializeInventoryJobMaterial(job);
  const materialHash = await inventoryJobMaterialHash(job);
  const sourceHash = await jobSourceHash(job);
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_listings (
        id,board,title,company,salary,description,apply_url,first_seen_at,
        updated_at,inventory_status,material_hash,material_hash_version,
        material_version,material_changed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'active',?,1,1,?)`
    ).bind(
      id,
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
    ).bind(id, materialHash, materialJson, timestamp),
  ]);
  return { job, materialHash, materialJson, sourceHash };
}

async function seedAnalyses(
  listing: SeededListing,
  analysis: JobPositionAnalysis,
  options: {
    factsJson?: string;
    includeContent?: boolean;
    includeFacts?: boolean;
    includePosition?: boolean;
    sourceHash?: string;
  } = {}
) {
  const sourceHash = options.sourceHash ?? listing.sourceHash;
  const statements: D1PreparedStatement[] = [];
  if (options.includeFacts !== false) {
    statements.push(
      testEnv.DB.prepare(
        `INSERT INTO job_match_facts (
          job_id,facts_json,schema_version,model_provider,model_id,source_hash,
          updated_at
        ) VALUES (?,?,5,'codex','test-model',?,?)
        ON CONFLICT(job_id) DO UPDATE SET
          facts_json=excluded.facts_json,
          schema_version=excluded.schema_version,
          model_provider=excluded.model_provider,
          model_id=excluded.model_id,
          source_hash=excluded.source_hash,
          updated_at=excluded.updated_at`
      ).bind(
        listing.job.id,
        options.factsJson ?? JSON.stringify(matchFacts()),
        sourceHash,
        timestamp
      )
    );
  }
  if (options.includeContent !== false) {
    statements.push(
      testEnv.DB.prepare(
        `INSERT INTO job_content_analyses (
          job_id,content_json,schema_version,model_provider,model_id,source_hash,
          updated_at
        ) VALUES (?,?,1,'codex','test-model',?,?)
        ON CONFLICT(job_id) DO UPDATE SET
          content_json=excluded.content_json,
          schema_version=excluded.schema_version,
          model_provider=excluded.model_provider,
          model_id=excluded.model_id,
          source_hash=excluded.source_hash,
          updated_at=excluded.updated_at`
      ).bind(
        listing.job.id,
        JSON.stringify(contentAnalysis(listing.job.description)),
        sourceHash,
        timestamp
      )
    );
  }
  if (options.includePosition !== false) {
    statements.push(
      testEnv.DB.prepare(
        "DELETE FROM job_position_variants WHERE job_id=?"
      ).bind(listing.job.id),
      testEnv.DB.prepare(
        `INSERT INTO job_position_analyses (
          job_id,scope,review_notes_json,schema_version,model_provider,model_id,
          source_hash,updated_at
        ) VALUES (?,?,?,?,'codex','test-model',?,?)
        ON CONFLICT(job_id) DO UPDATE SET
          scope=excluded.scope,
          review_notes_json=excluded.review_notes_json,
          schema_version=excluded.schema_version,
          model_provider=excluded.model_provider,
          model_id=excluded.model_id,
          source_hash=excluded.source_hash,
          updated_at=excluded.updated_at`
      ).bind(
        listing.job.id,
        analysis.scope,
        JSON.stringify(analysis.reviewNotes),
        JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
        sourceHash,
        timestamp
      ),
      ...analysis.positions.map((value, ordinal) =>
        testEnv.DB.prepare(
          `INSERT INTO job_position_variants (
            id,job_id,ordinal,title,role_family,subjects_json,locations_json,
            audiences_json,employment_types_json,requirements_json,
            evidence_json,compensation_evidence_json,certainty,created_at,
            updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          `${listing.job.id}:position:${ordinal}`,
          listing.job.id,
          ordinal,
          value.title,
          value.roleFamily,
          JSON.stringify(value.subjects),
          JSON.stringify(value.locations),
          JSON.stringify(value.audiences),
          JSON.stringify(value.employmentTypes),
          JSON.stringify(value.requirements),
          JSON.stringify(value.evidence),
          JSON.stringify(value.compensationEvidence),
          value.certainty,
          timestamp,
          timestamp
        )
      )
    );
  }
  await testEnv.DB.batch(statements);
}

function matchFacts() {
  return {
    audiences: [],
    benefits: [],
    economics: {
      compensation: {
        amountMaximum: null,
        amountMinimum: null,
        currency: null,
        evidence: [],
        kind: "unstated",
        period: null,
        qualifier: null,
        taxBasis: "unspecified",
      },
      workload: null,
    },
    employmentTypes: [],
    marketSegments: [],
    requirements: [],
    reviewNotes: [],
  };
}

function contentAnalysis(evidence: string) {
  return {
    additionalSections: [],
    applicationProcess: [],
    overview: [{ evidence: [evidence], text: "Teach English in Tbilisi." }],
    responsibilities: [],
    scheduleAndContract: [],
    teachingContext: [],
    unplacedEvidence: [],
  };
}

function directAnalysis(): JobPositionAnalysis {
  return {
    positions: [position("English Teacher", "English")],
    reviewNotes: [],
    scope: "direct",
  };
}

function parentAndChildAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  return {
    positions: [
      {
        ...value,
        locations: [
          {
            addressComponents: [],
            evidence: "Georgia",
            parentGeographies: [],
            role: "worksite",
            scope: "countrywide",
            semanticKind: "country",
            value: "Georgia",
            workplaceType: "onsite",
          },
          ...value.locations,
        ],
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

function manyLocationAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  return {
    positions: [
      {
        ...value,
        locations: Array.from({ length: 10 }, (_, index) => ({
          addressComponents: [],
          evidence: `City ${index}`,
          parentGeographies: [
            {
              evidence: "Georgia",
              semanticKind: "country" as const,
              value: "Georgia",
            },
          ],
          role: "worksite" as const,
          scope: "locality" as const,
          semanticKind: "city" as const,
          value: `City ${index}`,
          workplaceType: "onsite" as const,
        })),
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

function parentMismatchAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  const [location] = value.locations;
  if (!location) {
    throw new Error("The position fixture requires one location");
  }
  return {
    positions: [
      {
        ...value,
        locations: [
          {
            ...location,
            parentGeographies: [
              ...location.parentGeographies,
              {
                evidence: "Kartli",
                semanticKind: "region",
                value: "Kartli",
              },
            ],
          },
        ],
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

function sourceCountryConflictAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  const [location] = value.locations;
  if (!location) {
    throw new Error("The position fixture requires one location");
  }
  return {
    positions: [
      {
        ...value,
        locations: [
          {
            ...location,
            parentGeographies: [
              {
                evidence: "Armenia",
                semanticKind: "country",
                value: "Armenia",
              },
            ],
          },
        ],
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

function sourceParentConflictAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  const [location] = value.locations;
  if (!location) {
    throw new Error("The position fixture requires one location");
  }
  return {
    positions: [
      {
        ...value,
        locations: [
          {
            ...location,
            parentGeographies: [
              ...location.parentGeographies,
              {
                evidence: "Kartli",
                semanticKind: "region",
                value: "Kartli",
              },
              {
                evidence: "Imereti",
                semanticKind: "region",
                value: "Imereti",
              },
            ],
          },
        ],
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

function sameLabelRoleAndScopeAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  const [location] = value.locations;
  if (!location) {
    throw new Error("The position fixture requires one location");
  }
  return {
    positions: [
      {
        ...value,
        locations: [
          {
            ...location,
            role: "applicant_area",
            scope: "region",
            workplaceType: "remote",
          },
          {
            ...location,
            scope: "region",
          },
          location,
        ],
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

function addressAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  return {
    positions: [
      {
        ...value,
        locations: [
          {
            addressComponents: [
              {
                evidence: "12",
                kind: "address_number",
                value: "12",
              },
              {
                evidence: "Rustaveli Avenue",
                kind: "street",
                value: "Rustaveli Avenue",
              },
            ],
            evidence: "12 Rustaveli Avenue",
            parentGeographies: [
              {
                evidence: "Georgia",
                semanticKind: "country",
                value: "Georgia",
              },
              {
                evidence: "Tbilisi",
                semanticKind: "city",
                value: "Tbilisi",
              },
            ],
            role: "worksite",
            scope: "address",
            semanticKind: "address",
            value: "12 Rustaveli Avenue",
            workplaceType: "onsite",
          },
        ],
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

function position(title: string, subject = "English"): JobPositionVariant {
  return {
    audiences: [],
    certainty: "explicit",
    compensationEvidence: [],
    employmentTypes: [],
    evidence: [`Position: ${title}`],
    locations: [
      {
        addressComponents: [],
        evidence: "Tbilisi",
        parentGeographies: [
          {
            evidence: "Georgia",
            semanticKind: "country",
            value: "Georgia",
          },
        ],
        role: "worksite",
        scope: "locality",
        semanticKind: "city",
        value: "Tbilisi",
        workplaceType: "onsite",
      },
    ],
    requirements: [],
    roleFamily:
      subject === "English" ? "english_language" : "subject_specialist",
    subjects: [{ evidence: subject, value: subject }],
    title,
  };
}

async function seedExactTaskRuns(input: {
  count: number;
  listing: SeededListing;
  promptVersion: string;
  status: "completed" | "failed" | "running";
  taskType: string;
  userId: string;
}) {
  const runnerId = `runner:${input.listing.job.id}`;
  await testEnv.DB.prepare(
    `INSERT INTO agent_runners (
      id,user_id,name,token_hash,capabilities_json,codex_version,
      created_at,updated_at
    ) VALUES (?,?,? ,?, '["extraction"]','test',?,?)`
  )
    .bind(
      runnerId,
      input.userId,
      "Projection test runner",
      `token:${input.listing.job.id}`,
      timestamp,
      timestamp
    )
    .run();
  const statements = Array.from({ length: input.count }, (_, index) =>
    testEnv.DB.prepare(
      `INSERT INTO agent_task_runs (
        id,user_id,runner_id,task_type,source_task_id,prompt_version,model,
        reasoning_effort,source_hash,prompt_hash,attempt_number,lease_token,
        status,result_json,
        error_detail,started_at,lease_expires_at,completed_at,updated_at
      ) VALUES (?,?,?,?,?,?,'test-model','medium',?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      `task:${input.listing.job.id}:${index}`,
      input.userId,
      runnerId,
      input.taskType,
      input.listing.job.id,
      input.promptVersion,
      input.listing.sourceHash,
      index.toString(16).padStart(64, "0"),
      index + 1,
      `lease:${input.listing.job.id}:${index}`,
      input.status,
      input.status === "completed" ? "{}" : null,
      input.status === "failed" ? "deterministic validation failed" : "",
      timestamp,
      futureTimestamp,
      input.status === "running" ? null : timestamp,
      timestamp
    )
  );
  await testEnv.DB.batch(statements);
}

async function seedRunner(
  userId: string,
  fixtureId: string
): Promise<AgentRunnerContext> {
  const runnerId = `runner:${fixtureId}`;
  await testEnv.DB.prepare(
    `INSERT INTO agent_runners (
      id,user_id,name,token_hash,capabilities_json,codex_version,
      created_at,updated_at
    ) VALUES (?,?,?,?,'["extraction"]','test',?,?)`
  )
    .bind(
      runnerId,
      userId,
      "Projection broker runner",
      `token:${fixtureId}`,
      timestamp,
      timestamp
    )
    .run();
  return {
    capabilities: ["extraction"],
    codexVersion: "test",
    id: runnerId,
    name: "Projection broker runner",
    user: {
      email: "phase-c-broker-priority@example.test",
      id: userId,
      name: "Integration User",
      role: "operator",
    },
  };
}

async function createRun(
  cookie: string,
  scope: { boards: string[]; listingIds: string[] }
) {
  const response = await exports.default.fetch(
    "https://outreach.test/api/operator/public-projection/runs",
    {
      body: JSON.stringify({ mode: "shadow", scope }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    }
  );
  if (response.status !== 202) {
    throw new Error(`Projection run creation returned ${response.status}`);
  }
  return ((await response.json()) as ProjectionRunResponse).run.id;
}

async function advanceRunThroughExpansion() {
  return [
    await advancePublicProjectionRuns(testEnv.DB),
    await advancePublicProjectionRuns(testEnv.DB),
    await advancePublicProjectionRuns(testEnv.DB),
  ];
}

function countingD1Database(db: D1Database) {
  let count = 0;
  const statementTargets = new WeakMap<object, D1PreparedStatement>();
  const executionMethods = new Set<PropertyKey>(["all", "first", "raw", "run"]);

  const wrapStatement = (statement: D1PreparedStatement) => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) =>
            wrapStatement(target.bind(...values));
        }
        const value = Reflect.get(target, property);
        if (executionMethods.has(property) && typeof value === "function") {
          return (...args: unknown[]) => {
            count += 1;
            return Reflect.apply(value, target, args);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    statementTargets.set(wrapped, statement);
    return wrapped;
  };

  const counted = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => wrapStatement(target.prepare(query));
      }
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) => {
          count += statements.length;
          return target.batch(
            statements.map(
              (statement) => statementTargets.get(statement) ?? statement
            )
          );
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { count: () => count, db: counted };
}

async function listingItem(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT id,stage,status,attempt_count,checkpoint_json,error_code
       FROM public_projection_listing_items WHERE run_id=? LIMIT 1`
  )
    .bind(runId)
    .first<ListingItemRow>();
  if (!row) {
    throw new Error(`Projection listing item is missing for ${runId}`);
  }
  return row;
}

async function positionItems(runId: string) {
  const result = await testEnv.DB.prepare(
    `SELECT source_position_id,stage,status,input_hash
       FROM public_projection_position_items
      WHERE run_id=? ORDER BY source_position_id`
  )
    .bind(runId)
    .all<{
      input_hash: string;
      source_position_id: string;
      stage: string;
      status: string;
    }>();
  return result.results;
}

async function positionItem(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT attempt_count,checkpoint_json,completed_at,error_code,stage,status
       FROM public_projection_position_items WHERE run_id=? LIMIT 1`
  )
    .bind(runId)
    .first<{
      attempt_count: number;
      checkpoint_json: string;
      completed_at: string | null;
      error_code: string;
      stage: string;
      status: string;
    }>();
  if (!row) {
    throw new Error(`Projection position item is missing for ${runId}`);
  }
  return row;
}

async function positionIdentityCheckpoints(runId: string) {
  const result = await testEnv.DB.prepare(
    `SELECT source_position_id,checkpoint_json
       FROM public_projection_position_items
      WHERE run_id=? ORDER BY source_position_id`
  )
    .bind(runId)
    .all<{ checkpoint_json: string; source_position_id: string }>();
  return result.results.map((row) => {
    const checkpoint = JSON.parse(row.checkpoint_json) as {
      identity: unknown;
    };
    return {
      identity: checkpoint.identity,
      sourcePositionId: row.source_position_id,
    };
  });
}

async function projectionSourcePositionIds(runId: string) {
  return (await positionItems(runId)).map((item) => item.source_position_id);
}

async function sourcePositionCounts(listingId: string, runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM job_source_positions WHERE listing_id=?) positions,
      (SELECT COUNT(*) FROM public_projection_position_items WHERE run_id=?)
        projection_items`
  )
    .bind(listingId, runId)
    .first<{ positions: number; projection_items: number }>();
  return {
    positions: row?.positions ?? -1,
    projectionItems: row?.projection_items ?? -1,
  };
}

async function runStatus(runId: string) {
  const row = await testEnv.DB.prepare(
    "SELECT status FROM public_projection_runs WHERE id=?"
  )
    .bind(runId)
    .first<{ status: string }>();
  return row?.status ?? "missing";
}

async function runStates(runIds: string[]) {
  const result = await testEnv.DB.prepare(
    `SELECT id,status FROM public_projection_runs
      WHERE id IN (?,?) ORDER BY CASE id WHEN ? THEN 0 ELSE 1 END`
  )
    .bind(runIds[0], runIds[1], runIds[0])
    .all<{ id: string; status: string }>();
  return result.results;
}

async function advanceListingMaterial(listing: SeededListing) {
  const successor: InventoryJob = {
    ...listing.job,
    description: `${listing.job.description} Updated cohort evidence.`,
  };
  const materialJson = serializeInventoryJobMaterial(successor);
  const materialHash = await inventoryJobMaterialHash(successor);
  const changedAt = "2026-07-22T13:00:00.000Z";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_listing_versions (
        listing_id,material_version,material_hash,material_hash_version,
        material_json,created_at
      ) VALUES (?,2,?,1,?,?)`
    ).bind(listing.job.id, materialHash, materialJson, changedAt),
    testEnv.DB.prepare(
      `UPDATE job_listings
          SET description=?,material_hash=?,material_hash_version=1,
              material_version=2,material_changed_at=?,updated_at=?
        WHERE id=?`
    ).bind(
      successor.description,
      materialHash,
      changedAt,
      changedAt,
      listing.job.id
    ),
  ]);
}

async function seedResolvableOrganization() {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO organizations (
        id,country_code,country_name,name,identity_key,city,region,
        website_url,canonical_domain,market_segment,status,
        outreach_eligibility,evidence_url,last_verified_at,created_at,updated_at
      ) VALUES (
        'organization:example-school-ge','GE','Georgia','Example School',
        'name:example school|city:tbilisi','Tbilisi','','','','school','active',
        'eligible','https://example.test/about',?,?,?
      )`
    ).bind(timestamp, timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO organization_evidence (
        id,organization_id,source_kind,evidence_kind,evidence_status,
        source_label,source_url,observed_at,created_at
      ) VALUES (
        'organization-evidence:example-school-ge',
        'organization:example-school-ge','historical_workbook',
        'organization_profile','active','Example School',
        'https://example.test/about',?,?
      )`
    ).bind(timestamp, timestamp),
  ]);
}

async function seedOrganizationForCity(city: string) {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO organizations (
        id,country_code,country_name,name,identity_key,city,market_segment,
        status,outreach_eligibility,created_at,updated_at
      ) VALUES (
        'organization:city-zero','GE','Georgia','Example School',
        'name:example school|city:city zero',?,'school','active','eligible',?,?
      )`
    ).bind(city, timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO organization_evidence (
        id,organization_id,source_kind,evidence_kind,evidence_status,
        source_label,source_url,observed_at,created_at
      ) VALUES (
        'organization-evidence:city-zero','organization:city-zero',
        'historical_workbook','organization_profile','active','Example School',
        'https://city-zero.example.test/about',?,?
      )`
    ).bind(timestamp, timestamp),
  ]);
}

async function canonicalResolutionClaim(
  listing: SeededListing,
  cookie: string
) {
  const runId = await createRun(cookie, {
    boards: [],
    listingIds: [listing.job.id],
  });
  await advanceRunThroughExpansion();
  await advancePublicProjectionRuns(testEnv.DB);
  await advancePublicProjectionRuns(testEnv.DB);
  const claim = await claimProjectionPosition(
    testEnv.DB,
    runId,
    "canonical_resolution",
    futureTimestamp,
    { requireUnsealedCanonicalResolution: true }
  );
  if (!claim) {
    throw new Error("Expected a canonical-resolution claim");
  }
  return { claim, runId };
}

async function seedExistingPublicGraph() {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO public_jobs (id,created_at) VALUES ('existing-public-job',?)"
    ).bind(timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_aliases (public_job_id,slug,created_at)
       VALUES ('existing-public-job','existing-public-job',?)`
    ).bind(timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_versions (
        public_job_id,version,predecessor_version,canonical_slug,title,
        organization_id,organization_name,organization_resolution_state,
        workplace_type,date_posted,date_posted_provenance,valid_through,
        valid_through_provenance,employment_types_json,compensation_json,
        description_html,public_content_hash,public_content_hash_version,
        material_changed_at,content_schema_version,producer_kind,producer_id,
        idempotency_key,created_at
      ) VALUES (
        'existing-public-job',1,NULL,'existing-public-job','Existing Teacher',
        NULL,'Existing School','unresolved','unknown',NULL,'unknown',NULL,
        'unknown','[]','{}','Existing description',?,1,?,1,'deterministic',
        'canonical-resolution-test','existing-public-v1',?
      )`
    ).bind("e".repeat(64), timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_heads (public_job_id,current_version,updated_at)
       VALUES ('existing-public-job',1,?)`
    ).bind(timestamp),
  ]);
}

async function publicGraphSnapshot() {
  const tables = [
    "canonical_locations",
    "public_job_aliases",
    "public_job_heads",
    "public_job_versions",
    "public_jobs",
  ] as const;
  const entries = await Promise.all(
    tables.map(async (table) => {
      const rows = await testEnv.DB.prepare(`SELECT * FROM ${table}`).all<
        Record<string, unknown>
      >();
      return [table, rows.results] as const;
    })
  );
  const result = Object.fromEntries(entries) as Record<
    (typeof tables)[number],
    Record<string, unknown>[]
  >;
  return {
    canonicalLocations: result.canonical_locations,
    publicJobAliases: result.public_job_aliases,
    publicJobHeads: result.public_job_heads,
    publicJobs: result.public_jobs,
    publicJobVersions: result.public_job_versions,
  };
}

function mapboxTbilisiFixture() {
  return {
    attribution: "Mapbox fixture",
    features: [
      {
        geometry: { coordinates: [44.8015, 41.6938], type: "Point" },
        id: "dXJuOm1ieHBsYzp0YmlsaXNp",
        properties: {
          context: {
            country: {
              country_code: "ge",
              mapbox_id: "dXJuOm1ieHBsYzpnZW9yZ2lh",
              name: "Georgia",
            },
          },
          coordinates: { latitude: 41.6938, longitude: 44.8015 },
          feature_type: "place",
          full_address: "Tbilisi, Georgia",
          mapbox_id: "dXJuOm1ieHBsYzp0YmlsaXNp",
          match_code: { confidence: "exact" },
          name: "Tbilisi",
          place_formatted: "Georgia",
        },
        type: "Feature",
      },
    ],
    type: "FeatureCollection",
  };
}

function mapboxGeorgiaFixture() {
  return {
    attribution: "Mapbox fixture",
    features: [
      {
        bbox: [39.9, 41, 46.8, 43.7],
        geometry: { coordinates: [43.5, 42.1], type: "Point" },
        id: "georgia-feature",
        properties: {
          context: {
            country: {
              country_code: "ge",
              mapbox_id: "georgia",
              name: "Georgia",
            },
          },
          feature_type: "country",
          full_address: "Georgia",
          mapbox_id: "georgia",
          match_code: { confidence: "exact" },
          name: "Georgia",
        },
        type: "Feature",
      },
    ],
    type: "FeatureCollection",
  };
}

function mapboxCityFixture(name: string, padding: string) {
  return {
    attribution: "Mapbox fixture",
    features: [
      {
        geometry: { coordinates: [44.8, 41.7], type: "Point" },
        id: `${name}-feature`,
        properties: {
          context: {
            country: {
              country_code: "ge",
              mapbox_id: "georgia",
              name: "Georgia",
            },
          },
          feature_type: "place",
          full_address: `${name}, Georgia`,
          mapbox_id: `${name}-place`,
          match_code: { confidence: "exact" },
          name,
          place_formatted: "Georgia",
        },
        type: "Feature",
      },
    ],
    padding,
    type: "FeatureCollection",
  };
}

function mapboxAddressFixture() {
  return {
    attribution: "Mapbox fixture",
    features: [
      {
        geometry: { coordinates: [44.799, 41.7], type: "Point" },
        id: "rustaveli-address-feature",
        properties: {
          context: {
            country: {
              country_code: "ge",
              mapbox_id: "georgia",
              name: "Georgia",
            },
            place: { mapbox_id: "tbilisi", name: "Tbilisi" },
          },
          feature_type: "address",
          full_address: "12 Rustaveli Avenue, Tbilisi, Georgia",
          mapbox_id: "rustaveli-address",
          match_code: {
            address_number: "matched",
            confidence: "medium",
            street: "unmatched",
          },
          name: "12 Rustaveli Avenue",
          place_formatted: "Tbilisi, Georgia",
        },
        type: "Feature",
      },
    ],
    type: "FeatureCollection",
  };
}

async function advanceUntilFinalDuplicateComplete() {
  for (let attempt = 0; attempt < 512; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: D3 intentionally advances one durable page per invocation.
    const result = await advancePublicProjectionRuns(testEnv.DB);
    if (
      result &&
      "finalDuplicateState" in result &&
      result.finalDuplicateState === "complete"
    ) {
      return result;
    }
  }
  throw new Error("The durable final duplicate drain exceeded its page budget");
}

function permanentFixtureResponse(
  fixture: ReturnType<
    | typeof mapboxCityFixture
    | typeof mapboxAddressFixture
    | typeof mapboxGeorgiaFixture
    | typeof mapboxTbilisiFixture
  >,
  label: string
) {
  return {
    features: fixture.features,
    normalizedResponse: fixture,
    provider: "mapbox-geocoding-v6",
    queriedAt: timestamp,
    requestHash: "a".repeat(64),
    requestParameters: {
      autocomplete: "false",
      permanent: "true",
      q: label,
    },
    responseHash: "b".repeat(64),
  } as unknown as PermanentLocationResponse;
}
