import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CANONICAL_LIVE_CANDIDATE_PAGE_SQL,
  readCanonicalLiveCandidatePage,
} from "../../../../worker/repositories/public-projection-final-graph";
import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import {
  finalizeCanonicalDuplicateGraph,
  LIVE_CANONICAL_MATCH_KEYSET_SQL,
  LIVE_CANONICAL_SHADOW_PAGE_SQL,
  readLiveCanonicalPairPage,
  readSameRunCanonicalPairPage,
  SAME_RUN_CANONICAL_LEFT_KEYSET_SQL,
  SAME_RUN_CANONICAL_RIGHT_PAGE_SQL,
} from "../../../../worker/services/public-projection/final-graph";
import { fixtureHash, positionStages, runState } from "./support/fixtures";
import {
  advanceFinalGraphToReady,
  finishFinalGraph,
} from "./support/lifecycle";
import {
  SAME_RUN_INPUT_SCAN_PATTERN,
  testEnv,
  timestamp,
} from "./support/model";
import { advancePublicJobHead, seedPublicRoot } from "./support/seed-public";
import { seedResolvedRun } from "./support/seed-runs";
import { finalGraphCounts } from "./support/snapshots";
import {
  beforeFirstBatch,
  countingDatabase,
  insertSyntheticResolvedCohort,
  seedFinalWorkPublicMember,
  syntheticMemberKey,
  syntheticPositionItemId,
} from "./support/synthetic";

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public projection final duplicate graph", () => {
  it("fails advancement and supersedes work after an atomic D3 input drift", async () => {
    const signalHash = await fixtureHash("advancement-head-interleaving");
    const fixture = await seedResolvedRun({
      advanceable: true,
      beforeD2: async () => {
        await seedPublicRoot({
          createdAt: "2024-01-01T00:00:00.000Z",
          id: "advancement-head-origin",
          published: false,
          signalHash,
        });
      },
      positions: [
        {
          canonicalSignalHash: signalHash,
          sourcePositionId: "advancement-head-source",
          sourceReference: "advancement-head-reference",
        },
      ],
      runId: "advancement-head-interleaving-run",
    });
    await advanceFinalGraphToReady(testEnv.DB, fixture.runId, timestamp);
    const interleavingDb = beforeFirstBatch(testEnv.DB, () =>
      advancePublicJobHead("advancement-head-origin", signalHash)
    );

    await expect(
      advancePublicProjectionRuns(interleavingDb)
    ).resolves.toMatchObject({
      drift: "final_duplicate_input_snapshot_changed",
      runId: fixture.runId,
    });
    await expect(runState(fixture.runId)).resolves.toEqual({
      errorCode: "final_duplicate_input_snapshot_changed",
      status: "failed",
    });
    await expect(positionStages(fixture.runId)).resolves.toEqual([
      { stage: "canonical_resolution", status: "superseded" },
    ]);
    await expect(finalGraphCounts(fixture.runId)).resolves.toEqual({
      allocations: 0,
      canonicalInputs: 0,
      components: 0,
      mappingInputs: 0,
      members: 0,
      relations: 0,
      roots: 0,
      seals: 0,
    });
  });

  it("pages more than 24 live matches for one canonical request", async () => {
    const signalHash = await fixtureHash("paged-canonical-live-matches");
    const fixture = await seedResolvedRun({
      beforeD2: async () => {
        await Promise.all(
          Array.from({ length: 26 }, (_, index) =>
            seedPublicRoot({
              createdAt: "2024-01-01T00:00:00.000Z",
              id: `paged-live-root-${index.toString().padStart(2, "0")}`,
              published: false,
              signalHash,
            })
          )
        );
      },
      positions: [
        {
          canonicalSignalHash: signalHash,
          sourcePositionId: "paged-live-source",
          sourceReference: "paged-live-reference",
        },
      ],
      runId: "paged-canonical-live-run",
    });

    await expect(
      finishFinalGraph(testEnv.DB, fixture.runId, timestamp)
    ).resolves.toMatchObject({
      state: "complete",
    });
    await expect(finalGraphCounts(fixture.runId)).resolves.toMatchObject({
      canonicalInputs: 26,
      seals: 1,
    });
    const request = await testEnv.DB.prepare(
      `SELECT match_count FROM public_projection_final_work_canonical_requests
        WHERE run_id=? AND signal_hash=?`
    )
      .bind(fixture.runId, signalHash)
      .first<{ match_count: number }>();
    expect(request?.match_count).toBe(26);
  });

  it("uses covering keysets with constant query count for large same-run cohorts", async () => {
    const fixture = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: await fixtureHash("query-plan-base"),
          sourcePositionId: "query-plan-base-source",
          sourceReference: "query-plan-base-reference",
        },
      ],
      runId: "same-run-query-plan",
    });
    await finalizeCanonicalDuplicateGraph(testEnv.DB, fixture.runId, timestamp);
    const signalHash = "7".repeat(64);
    await insertSyntheticResolvedCohort({
      count: 100,
      runId: fixture.runId,
      signalHash,
      start: 1000,
    });
    const firstMemberKey = syntheticMemberKey(1000);
    const firstPositionItemId = syntheticPositionItemId(1000);
    const [leftPlan, rightPlan] = await Promise.all([
      testEnv.DB.prepare(
        `EXPLAIN QUERY PLAN ${SAME_RUN_CANONICAL_LEFT_KEYSET_SQL}`
      )
        .bind(fixture.runId, "", "")
        .all<{ detail: string }>(),
      testEnv.DB.prepare(
        `EXPLAIN QUERY PLAN ${SAME_RUN_CANONICAL_RIGHT_PAGE_SQL}`
      )
        .bind(
          fixture.runId,
          signalHash,
          firstMemberKey,
          firstPositionItemId,
          firstPositionItemId,
          24
        )
        .all<{ detail: string }>(),
    ]);
    for (const planRows of [leftPlan.results, rightPlan.results]) {
      const plan = planRows.map((row) => row.detail).join("\n");
      expect(plan).toContain(
        "USING COVERING INDEX idx_projection_final_resolution_relation_lookup"
      );
      expect(plan).not.toContain("USE TEMP B-TREE");
      expect(plan).not.toMatch(SAME_RUN_INPUT_SCAN_PATTERN);
    }

    const smallCounter = countingDatabase(testEnv.DB);
    const smallPage = await readSameRunCanonicalPairPage(smallCounter.db, {
      cursor: null,
      limit: 24,
      runId: fixture.runId,
    });
    expect(smallCounter.prepareCount()).toBe(2);
    expect(smallPage).toEqual(
      Array.from({ length: 24 }, (_, index) => ({
        leftMemberKey: firstMemberKey,
        rightMemberKey: syntheticMemberKey(1001 + index),
        signalHash,
      }))
    );

    await insertSyntheticResolvedCohort({
      count: 900,
      runId: fixture.runId,
      signalHash,
      start: 1100,
    });
    const largeCounter = countingDatabase(testEnv.DB);
    const largePage = await readSameRunCanonicalPairPage(largeCounter.db, {
      cursor: null,
      limit: 24,
      runId: fixture.runId,
    });
    expect(largeCounter.prepareCount()).toBe(2);
    expect(largePage).toEqual(smallPage);
  });

  it("uses a bounded nested keyset for live canonical relations", async () => {
    const fixture = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: await fixtureHash("live-query-plan-base"),
          sourcePositionId: "live-query-plan-base-source",
          sourceReference: "live-query-plan-base-reference",
        },
      ],
      runId: "live-query-plan",
    });
    await finalizeCanonicalDuplicateGraph(testEnv.DB, fixture.runId, timestamp);
    const signalHash = "8".repeat(64);
    const publicMemberKey = "public:live-query-plan-root:1:1";
    await insertSyntheticResolvedCohort({
      count: 100,
      runId: fixture.runId,
      signalHash,
      start: 2000,
    });
    await seedFinalWorkPublicMember({
      publicMemberKey,
      runId: fixture.runId,
      signalHash,
    });
    const firstShadow = syntheticMemberKey(2000);
    const firstPosition = syntheticPositionItemId(2000);
    const [matchPlanRows, shadowPlanRows] = await Promise.all([
      testEnv.DB.prepare(
        `EXPLAIN QUERY PLAN ${LIVE_CANONICAL_MATCH_KEYSET_SQL}`
      )
        .bind(fixture.runId, "", "")
        .all<{ detail: string }>(),
      testEnv.DB.prepare(`EXPLAIN QUERY PLAN ${LIVE_CANONICAL_SHADOW_PAGE_SQL}`)
        .bind(
          fixture.runId,
          signalHash,
          "",
          "",
          publicMemberKey,
          publicMemberKey,
          24
        )
        .all<{ detail: string }>(),
    ]);
    const matchPlan = matchPlanRows.results.map((row) => row.detail).join("\n");
    const shadowPlan = shadowPlanRows.results
      .map((row) => row.detail)
      .join("\n");
    expect(matchPlan).toContain(
      "USING COVERING INDEX idx_projection_final_canonical_member_page"
    );
    expect(shadowPlan).toContain(
      "USING COVERING INDEX idx_projection_final_resolution_relation_lookup"
    );
    expect(`${matchPlan}\n${shadowPlan}`).not.toContain("USE TEMP B-TREE");

    const smallCounter = countingDatabase(testEnv.DB);
    const smallPage = await readLiveCanonicalPairPage(smallCounter.db, {
      cursor: null,
      limit: 24,
      runId: fixture.runId,
    });
    expect(smallCounter.prepareCount()).toBe(2);
    expect(smallPage).toHaveLength(24);
    expect(smallPage[0]).toMatchObject({
      leftMemberKey: publicMemberKey,
      rightMemberKey: firstShadow,
      signalHash,
    });

    await insertSyntheticResolvedCohort({
      count: 900,
      runId: fixture.runId,
      signalHash,
      start: 2100,
    });
    const largeCounter = countingDatabase(testEnv.DB);
    const largePage = await readLiveCanonicalPairPage(largeCounter.db, {
      cursor: null,
      limit: 24,
      runId: fixture.runId,
    });
    expect(largeCounter.prepareCount()).toBe(2);
    expect(largePage).toEqual(smallPage);

    const resumed = await readLiveCanonicalPairPage(testEnv.DB, {
      cursor: {
        publicMemberKey,
        rightMemberKey: smallPage.at(-1)?.rightMemberKey ?? firstShadow,
        shadowPositionItemId:
          smallPage.at(-1)?.liveCursor?.shadowPositionItemId ?? firstPosition,
        signalHash,
      },
      limit: 1,
      runId: fixture.runId,
    });
    expect(resumed[0]?.rightMemberKey).toBe(syntheticMemberKey(2024));
  });

  it("pages canonical live matches through one covering keyset", async () => {
    const signalHash = "6".repeat(64);
    await seedResolvedRun({
      beforeD2: async () => {
        await seedPublicRoot({
          createdAt: "2024-01-01T00:00:00.000Z",
          id: "canonical-live-page-root",
          published: false,
          signalHash,
        });
      },
      positions: [
        {
          canonicalSignalHash: signalHash,
          sourcePositionId: "canonical-live-page-source",
          sourceReference: "canonical-live-page-reference",
        },
      ],
      runId: "canonical-live-page-run",
    });
    const planRows = await testEnv.DB.prepare(
      `EXPLAIN QUERY PLAN ${CANONICAL_LIVE_CANDIDATE_PAGE_SQL}`
    )
      .bind(signalHash, "", 0, 24)
      .all<{ detail: string }>();
    const plan = planRows.results.map((row) => row.detail).join("\n");
    expect(plan).toContain(
      "USING COVERING INDEX idx_public_job_canonical_signal_page"
    );
    expect(plan).not.toContain("USE TEMP B-TREE");

    const counter = countingDatabase(testEnv.DB);
    const page = await readCanonicalLiveCandidatePage(counter.db, {
      cursor: null,
      limit: 24,
      signalHash,
    });
    expect(counter.prepareCount()).toBe(1);
    expect(page).toEqual([
      {
        publicJobId: "canonical-live-page-root",
        publicJobVersion: 1,
        signalHash,
        signalKind: "canonical_identity_v1",
      },
    ]);
  });
});
