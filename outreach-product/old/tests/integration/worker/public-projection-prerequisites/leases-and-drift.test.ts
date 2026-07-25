import { beforeEach, describe, expect, it } from "vitest";
import type { JobPositionAnalysis } from "../../../../src/features/jobs/position-variants";
import { sourcePositionIdentities } from "../../../../src/features/public/source-position-identity";
import { claimJobPositionTask } from "../../../../worker/services/agent-tasks/job-analysis-adapter";
import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import { claimProjectionListing } from "../../../../worker/services/public-projection/listing-items";
import { processProjectionPrerequisiteClaim } from "../../../../worker/services/public-projection/prerequisites";
import { processProjectionSourcePositionClaim } from "../../../../worker/services/public-projection/source-positions";
import { createAuthenticatedUser } from ".././auth";
import { directAnalysis, position } from "./support/analyses";
import { advanceUntilFinalDuplicateComplete } from "./support/mapbox";
import {
  futureTimestamp,
  resetPrerequisiteDb,
  testEnv,
  timestamp,
} from "./support/model";
import {
  listingItem,
  positionIdentityCheckpoints,
  positionItems,
  projectionSourcePositionIds,
  runStates,
  runStatus,
  sourcePositionCounts,
} from "./support/queries";
import {
  advanceRunThroughExpansion,
  countingD1Database,
  createRun,
  seedRunner,
} from "./support/runner";
import { seedAnalyses, seedListing } from "./support/seeding";

beforeEach(resetPrerequisiteDb);

describe("projection prerequisites, source positions, and identity", () => {
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
      attempt_count: 0,
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
});
