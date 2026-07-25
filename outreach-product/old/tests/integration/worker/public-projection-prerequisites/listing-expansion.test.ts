import { beforeEach, describe, expect, it } from "vitest";
import {
  JOB_POSITION_PROMPT_VERSION,
  JOB_POSITION_TASK_TYPE,
} from "../../../../src/agent-tasks/job-analysis";
import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import { createAuthenticatedUser } from ".././auth";
import { directAnalysis, position } from "./support/analyses";
import { resetPrerequisiteDb, testEnv } from "./support/model";
import {
  listingItem,
  positionItems,
  sourcePositionCounts,
} from "./support/queries";
import { createRun, seedExactTaskRuns } from "./support/runner";
import { seedAnalyses, seedListing } from "./support/seeding";

beforeEach(resetPrerequisiteDb);

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
      attempt_count: 1,
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

  it("expands 30 positions after an analysis wait without spending the retry budget on successful pages", async () => {
    const listing = await seedListing("phase-c-bounded-expansion");
    const operator = await createAuthenticatedUser(
      "phase-c-bounded-expansion@example.test"
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

    await seedAnalyses(listing, {
      positions: Array.from({ length: 30 }, (_, index) =>
        position(`English Teacher ${index + 1}`, "English")
      ),
      reviewNotes: [],
      scope: "multi_position",
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      awakened: 1,
      prerequisiteReady: 1,
      runId,
    });
    expect(await listingItem(runId)).toMatchObject({
      attempt_count: 0,
      stage: "source_positions",
      status: "queued",
    });

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
      attempt_count: 1,
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
        attempt_count: 0,
        stage: "source_positions",
        status: "queued",
      });
      await expect(
        advancePublicProjectionRuns(testEnv.DB)
      ).resolves.toMatchObject({ expanded: 1, runId });
      expect(await listingItem(runId)).toMatchObject({
        attempt_count: 1,
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
});
