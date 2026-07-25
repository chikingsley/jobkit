import { beforeEach, describe, expect, it } from "vitest";
import { nextActiveRun } from "../../../../worker/services/public-projection/advancement/stage-machine";
import { PUBLIC_PROJECTION_RUN_STEP_BUDGET } from "../../../../worker/services/public-projection/contracts";
import { createAuthenticatedUser } from "../auth";
import { directAnalysis } from "../public-projection-prerequisites/support/analyses";
import { resetPrerequisiteDb } from "../public-projection-prerequisites/support/model";
import { createRun } from "../public-projection-prerequisites/support/runner";
import {
  seedAnalyses,
  seedListing,
} from "../public-projection-prerequisites/support/seeding";
import {
  ADVANCE_MESSAGE,
  deliver,
  drainQueueChain,
  pendingStageNames,
  queueHarness,
  readRunRow,
} from "./stage-harness";
import { testEnv } from "./support";

beforeEach(resetPrerequisiteDb);

/**
 * A position analysis without location assertions: the canonical-resolution
 * consumer records an unresolved seal without ever calling the external
 * location provider, so the production queue consumer stays hermetic.
 */
function unlocatedAnalysis() {
  const analysis = directAnalysis();
  return {
    ...analysis,
    positions: analysis.positions.map((position) => ({
      ...position,
      locations: [],
    })),
  };
}

function seedUnlocatedListing(id: string) {
  return seedListing(id, { country: "", location: "" });
}

function stageArtifacts(runId: string) {
  return testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM public_projection_listing_items
        WHERE run_id=?1 AND stage='completed' AND status='completed'
      ) listings_completed,
      (SELECT COUNT(*) FROM public_projection_position_items
        WHERE run_id=?1 AND status IN ('completed','blocked')
      ) positions_terminal,
      (SELECT COUNT(*) FROM public_projection_duplicate_batches
        WHERE run_id=?1) duplicate_batches,
      (SELECT COUNT(*) FROM public_projection_resolution_seals
        WHERE run_id=?1) resolution_seals,
      (SELECT COUNT(*) FROM public_projection_final_duplicate_seals
        WHERE run_id=?1) final_seals,
      (SELECT COUNT(*) FROM public_projection_candidate_results
        WHERE run_id=?1) candidate_results,
      (SELECT COUNT(*) FROM public_projection_candidate_seals
        WHERE run_id=?1) candidate_seals`
  )
    .bind(runId)
    .first<{
      candidate_results: number;
      candidate_seals: number;
      duplicate_batches: number;
      final_seals: number;
      listings_completed: number;
      positions_terminal: number;
      resolution_seals: number;
    }>();
}

describe("public projection stage machine queue drain", () => {
  it("drains a seeded run through every stage to a terminal completion", async () => {
    const listing = await seedUnlocatedListing("stage-drain-listing");
    await seedAnalyses(listing, unlocatedAnalysis());
    const operator = await createAuthenticatedUser(
      "projection-stage-drain@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });

    const harness = queueHarness();
    const steps = await drainQueueChain(harness);
    expect(steps).toBeLessThan(60);

    const run = await readRunRow(runId);
    expect(run).toMatchObject({
      error_code: "",
      selection_complete: 1,
      status: "completed_with_blocks",
    });
    expect(run?.completed_at).not.toBeNull();
    expect(run?.advance_step_count).toBeGreaterThan(0);
    expect(run?.advance_step_count).toBeLessThan(
      PUBLIC_PROJECTION_RUN_STEP_BUDGET
    );

    await expect(stageArtifacts(runId)).resolves.toEqual({
      candidate_results: 0,
      candidate_seals: 1,
      duplicate_batches: 1,
      final_seals: 1,
      listings_completed: 1,
      positions_terminal: 1,
      resolution_seals: 1,
    });

    await expect(pendingStageNames(runId)).resolves.toEqual([]);
    await expect(nextActiveRun(testEnv.DB, true)).resolves.toBeNull();
  });

  it("keeps terminal runs terminal across cron wakes and queue messages", async () => {
    const listing = await seedUnlocatedListing("stage-terminal-listing");
    await seedAnalyses(listing, unlocatedAnalysis());
    const operator = await createAuthenticatedUser(
      "projection-stage-terminal@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    const harness = queueHarness();
    await drainQueueChain(harness);
    const completed = await readRunRow(runId);
    expect(completed?.status).toBe("completed_with_blocks");

    const canceled = await seedUnlocatedListing("stage-canceled-listing");
    await seedAnalyses(canceled, unlocatedAnalysis());
    const canceledRunId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [canceled.job.id],
    });
    await testEnv.DB.prepare(
      `UPDATE public_projection_runs
          SET status='canceled',completed_at=updated_at WHERE id=?`
    )
      .bind(canceledRunId)
      .run();
    const canceledRow = await readRunRow(canceledRunId);

    const wake = await deliver(harness, ADVANCE_MESSAGE);
    expect(wake).toEqual({ acked: 1, retried: 0 });
    expect(harness.sent).toEqual([]);

    await expect(readRunRow(runId)).resolves.toEqual(completed);
    await expect(readRunRow(canceledRunId)).resolves.toEqual(canceledRow);
    await expect(nextActiveRun(testEnv.DB, true)).resolves.toBeNull();
  });

  it("halts the chain while a run waits for analysis and resumes on wake", async () => {
    const listing = await seedUnlocatedListing("stage-waiter-listing");
    await seedAnalyses(listing, unlocatedAnalysis(), {
      includePosition: false,
    });
    const operator = await createAuthenticatedUser(
      "projection-stage-waiter@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });

    const harness = queueHarness();
    const stalledSteps = await drainQueueChain(harness);
    expect(stalledSteps).toBeLessThan(10);
    await expect(
      testEnv.DB.prepare(
        `SELECT stage,status FROM public_projection_listing_items
          WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({ stage: "prerequisites", status: "waiting_analysis" });
    const stalled = await readRunRow(runId);
    expect(stalled?.status).toBe("running");
    // No stage owes claimable work, so the selector must leave the run alone
    // instead of hot-looping the queue against a pending analysis waiter.
    await expect(pendingStageNames(runId)).resolves.toEqual([]);
    await expect(nextActiveRun(testEnv.DB, true)).resolves.toBeNull();

    await seedAnalyses(listing, unlocatedAnalysis());
    const resumedSteps = await drainQueueChain(harness);
    expect(resumedSteps).toBeGreaterThan(0);
    await expect(readRunRow(runId)).resolves.toMatchObject({
      status: "completed_with_blocks",
    });
  });
});
