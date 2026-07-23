import { beforeEach, describe, expect, it } from "vitest";
import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import { awakenProjectionWaitersForListing } from "../../../../worker/services/public-projection/analysis-waiters";
import { createAuthenticatedUser } from "../auth";
import { directAnalysis } from "./support/analyses";
import { resetPrerequisiteDb, testEnv } from "./support/model";
import { listingItem } from "./support/queries";
import { createRun } from "./support/runner";
import { seedAnalyses, seedListing } from "./support/seeding";

beforeEach(resetPrerequisiteDb);

describe("projection run fairness", () => {
  it("seals duplicate work while another run waits for analysis", async () => {
    const waiter = await seedListing("projection-fairness-waiter");
    await seedAnalyses(waiter, directAnalysis(), { includePosition: false });
    const ready = await seedListing("projection-fairness-ready");
    await seedAnalyses(ready, directAnalysis());
    const operator = await createAuthenticatedUser(
      "projection-fairness@example.test"
    );
    const waitingRunId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [waiter.job.id],
    });
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);
    expect(await listingItem(waitingRunId)).toMatchObject({
      stage: "prerequisites",
      status: "waiting_analysis",
    });

    const readyRunId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [ready.job.id],
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ advanced: 1, runId: readyRunId });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      prerequisiteReady: 1,
      runId: readyRunId,
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ expanded: 1, runId: readyRunId });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ identified: 1, runId: readyRunId });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      duplicateState: "complete",
      runId: readyRunId,
    });
    expect(await listingItem(waitingRunId)).toMatchObject({
      status: "waiting_analysis",
    });
  });

  it("requeues every run waiting on a completed listing analysis", async () => {
    const listing = await seedListing("projection-fairness-analysis-ready");
    await seedAnalyses(listing, directAnalysis(), { includePosition: false });
    const operator = await createAuthenticatedUser(
      "projection-fairness-analysis-ready@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);
    expect(await listingItem(runId)).toMatchObject({
      status: "waiting_analysis",
    });

    await seedAnalyses(listing, directAnalysis());
    await expect(
      awakenProjectionWaitersForListing(testEnv.DB, listing.job.id)
    ).resolves.toEqual([runId]);
    expect(await listingItem(runId)).toMatchObject({ status: "queued" });
  });
});
