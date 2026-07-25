import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  COMPONENT_LEFT_NEIGHBOR_PAGE_SQL,
  COMPONENT_RIGHT_NEIGHBOR_PAGE_SQL,
  readSameRelationNeighborPage,
} from "../../../../worker/repositories/public-projection-final-work/component-frontier";
import {
  COMPONENT_ROOT_CANDIDATE_PAGE_SQL,
  COMPONENT_ROOT_WINNER_SQL,
  readComponentRootCandidatePage,
  readComponentRootSummary,
} from "../../../../worker/repositories/public-projection-final-work/component-relations";
import {
  claimFinalWork,
  commitFinalWorkPage,
  readFinalWork,
} from "../../../../worker/repositories/public-projection-final-work/controller";
import {
  appendFinalPhaseDigest,
  FINAL_PHASE_REDUCTION_DOMAINS,
  finalizeCanonicalDuplicateGraph,
} from "../../../../worker/services/public-projection/final-graph";
import { fixtureHash } from "./support/fixtures";
import { finishFinalGraph } from "./support/lifecycle";
import { testEnv, timestamp } from "./support/model";
import { seedPublicRoot } from "./support/seed-public";
import { seedResolvedRun } from "./support/seed-runs";
import {
  commitThenLoseFirstBatch,
  countingDatabase,
  insertSyntheticSameRelations,
} from "./support/synthetic";

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public projection final duplicate graph", () => {
  it("merges independent indexed frontier streams with durable cursors", async () => {
    const fixture = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: await fixtureHash("frontier-query-plan-base"),
          sourcePositionId: "frontier-query-plan-source",
          sourceReference: "frontier-query-plan-reference",
        },
      ],
      runId: "frontier-query-plan",
    });
    await finalizeCanonicalDuplicateGraph(testEnv.DB, fixture.runId, timestamp);
    const memberKey = "m-frontier-center";
    await insertSyntheticSameRelations({
      count: 100,
      memberKey,
      runId: fixture.runId,
      start: 0,
    });
    const [leftPlanRows, rightPlanRows] = await Promise.all([
      testEnv.DB.prepare(
        `EXPLAIN QUERY PLAN ${COMPONENT_LEFT_NEIGHBOR_PAGE_SQL}`
      )
        .bind(fixture.runId, memberKey, "", 25)
        .all<{ detail: string }>(),
      testEnv.DB.prepare(
        `EXPLAIN QUERY PLAN ${COMPONENT_RIGHT_NEIGHBOR_PAGE_SQL}`
      )
        .bind(fixture.runId, memberKey, "", 25)
        .all<{ detail: string }>(),
    ]);
    const plans = [leftPlanRows.results, rightPlanRows.results].map((rows) =>
      rows.map((row) => row.detail).join("\n")
    );
    expect(plans[0]).toContain(
      "USING COVERING INDEX idx_projection_final_relations_left_page"
    );
    expect(plans[1]).toContain(
      "USING COVERING INDEX idx_projection_final_relations_right_page"
    );
    expect(plans.join("\n")).not.toContain("USE TEMP B-TREE");

    const smallCounter = countingDatabase(testEnv.DB);
    const smallPage = await readSameRelationNeighborPage(smallCounter.db, {
      leftCursor: "",
      limit: 24,
      memberKey,
      rightCursor: "",
      runId: fixture.runId,
    });
    expect(smallCounter.prepareCount()).toBe(2);
    expect(smallPage.complete).toBe(false);
    expect(smallPage.neighborKeys).toHaveLength(24);

    await insertSyntheticSameRelations({
      count: 900,
      memberKey,
      runId: fixture.runId,
      start: 100,
    });
    const largeCounter = countingDatabase(testEnv.DB);
    const largePage = await readSameRelationNeighborPage(largeCounter.db, {
      leftCursor: "",
      limit: 24,
      memberKey,
      rightCursor: "",
      runId: fixture.runId,
    });
    expect(largeCounter.prepareCount()).toBe(2);
    expect(largePage.neighborKeys).toEqual(smallPage.neighborKeys);

    const resumed = await readSameRelationNeighborPage(testEnv.DB, {
      leftCursor: smallPage.leftCursor,
      limit: 1,
      memberKey,
      rightCursor: smallPage.rightCursor,
      runId: fixture.runId,
    });
    expect(resumed.neighborKeys[0]).toBe("a-frontier-000024");
  });

  it("reads normalized component roots through fixed indexed queries", async () => {
    const signalHash = "7".repeat(64);
    const fixture = await seedResolvedRun({
      beforeD2: async () => {
        await seedPublicRoot({
          createdAt: "2024-01-01T00:00:00.000Z",
          id: "component-root-query-plan",
          published: false,
          signalHash,
        });
      },
      positions: [
        {
          canonicalSignalHash: signalHash,
          sourcePositionId: "component-root-query-plan-source",
          sourceReference: "component-root-query-plan-reference",
        },
      ],
      runId: "component-root-query-plan-run",
    });
    await finishFinalGraph(testEnv.DB, fixture.runId, timestamp);
    const component = await testEnv.DB.prepare(
      `SELECT seed_member_key FROM public_projection_final_component_work
        WHERE run_id=? ORDER BY seed_member_key LIMIT 1`
    )
      .bind(fixture.runId)
      .first<{ seed_member_key: string }>();
    if (!component) {
      throw new Error("The component root query-plan fixture is missing");
    }
    const [pagePlanRows, winnerPlanRows] = await Promise.all([
      testEnv.DB.prepare(
        `EXPLAIN QUERY PLAN ${COMPONENT_ROOT_CANDIDATE_PAGE_SQL}`
      )
        .bind(fixture.runId, component.seed_member_key, "", 24)
        .all<{ detail: string }>(),
      testEnv.DB.prepare(`EXPLAIN QUERY PLAN ${COMPONENT_ROOT_WINNER_SQL}`)
        .bind(fixture.runId, component.seed_member_key)
        .all<{ detail: string }>(),
    ]);
    const pagePlan = pagePlanRows.results.map((row) => row.detail).join("\n");
    const winnerPlan = winnerPlanRows.results
      .map((row) => row.detail)
      .join("\n");
    expect(pagePlan).toContain(
      "public_projection_final_component_root_candidates"
    );
    expect(winnerPlan).toContain(
      "USING INDEX idx_projection_final_component_root_winner"
    );
    expect(`${pagePlan}\n${winnerPlan}`).not.toContain("USE TEMP B-TREE");

    const pageCounter = countingDatabase(testEnv.DB);
    const page = await readComponentRootCandidatePage(pageCounter.db, {
      cursor: "",
      limit: 24,
      runId: fixture.runId,
      seedMemberKey: component.seed_member_key,
    });
    expect(pageCounter.prepareCount()).toBe(1);
    expect(page).toHaveLength(1);
    const summaryCounter = countingDatabase(testEnv.DB);
    const summary = await readComponentRootSummary(summaryCounter.db, {
      runId: fixture.runId,
      seedMemberKey: component.seed_member_key,
    });
    expect(summaryCounter.prepareCount()).toBe(2);
    expect(summary).toMatchObject({ count: 1 });
    expect(summary.winner?.memberKey).toBe(page[0]?.memberKey);
  });

  it("folds every terminal reducer identically at page sizes 1, 7, and 24", async () => {
    const records = Array.from({ length: 49 }, (_, index) => ({
      index,
      value: `row-${index.toString().padStart(2, "0")}`,
    }));
    for (const domain of Object.values(FINAL_PHASE_REDUCTION_DOMAINS)) {
      const digests: string[] = [];
      for (const pageSize of [1, 7, 24]) {
        let digest: null | string = null;
        for (let offset = 0; offset < records.length; offset += pageSize) {
          // biome-ignore lint/performance/noAwaitInLoops: Each rolling digest depends on the previous page digest.
          digest = await appendFinalPhaseDigest(
            domain,
            digest,
            records.slice(offset, offset + pageSize)
          );
        }
        digests.push(digest ?? "");
      }
      expect(new Set(digests)).toHaveLength(1);
    }
  });

  it("resumes after a committed work page response is lost", async () => {
    const fixture = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: await fixtureHash("lost-page-response"),
          sourcePositionId: "lost-page-source",
          sourceReference: "lost-page-reference",
        },
      ],
      runId: "lost-page-response-run",
    });
    const unreliableDb = commitThenLoseFirstBatch(testEnv.DB);

    await expect(
      finalizeCanonicalDuplicateGraph(unreliableDb, fixture.runId, timestamp)
    ).rejects.toThrow("simulated committed response loss");
    await expect(
      readFinalWork(testEnv.DB, fixture.runId)
    ).resolves.toMatchObject({
      phase: "mapping_inputs",
      resolutionCount: 1,
      status: "queued",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count
           FROM public_projection_final_work_resolution_inputs
          WHERE run_id=?`
      )
        .bind(fixture.runId)
        .first<{ count: number }>()
    ).resolves.toEqual({ count: 1 });
    await expect(
      finishFinalGraph(testEnv.DB, fixture.runId, timestamp)
    ).resolves.toMatchObject({ replayed: false, state: "complete" });
  });

  it("guards committed-response replay in every terminal reducer", async () => {
    const fixture = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: await fixtureHash("terminal-replay-guards"),
          sourcePositionId: "terminal-replay-source",
          sourceReference: "terminal-replay-reference",
        },
      ],
      runId: "terminal-replay-guards",
    });
    await finalizeCanonicalDuplicateGraph(testEnv.DB, fixture.runId, timestamp);
    const cases = [
      {
        columns: [
          "resolution_count",
          "resolution_bytes",
          "resolution_digest",
          "resolution_last_cursor",
        ],
        counter: "resolution" as const,
        domain: FINAL_PHASE_REDUCTION_DOMAINS.resolution,
        phase: "resolution_inputs" as const,
        properties: [
          "resolutionCount",
          "resolutionBytes",
          "resolutionDigest",
          "resolutionLastCursor",
        ],
      },
      {
        columns: [
          "mapping_count",
          "mapping_bytes",
          "mapping_digest",
          "mapping_last_cursor",
        ],
        counter: "mapping" as const,
        domain: FINAL_PHASE_REDUCTION_DOMAINS.mapping,
        phase: "mapping_inputs" as const,
        properties: [
          "mappingCount",
          "mappingBytes",
          "mappingDigest",
          "mappingLastCursor",
        ],
      },
      {
        columns: [
          "canonical_request_count",
          "canonical_request_bytes",
          "canonical_request_digest",
          "canonical_request_last_cursor",
        ],
        counter: "canonical_request" as const,
        domain: FINAL_PHASE_REDUCTION_DOMAINS.canonicalRequest,
        phase: "canonical_requests" as const,
        properties: [
          "canonicalRequestCount",
          "canonicalRequestBytes",
          "canonicalRequestDigest",
          "canonicalRequestLastCursor",
        ],
      },
      {
        columns: [
          "canonical_match_count",
          "canonical_match_bytes",
          "canonical_match_digest",
          "canonical_match_last_cursor",
        ],
        counter: "canonical_match" as const,
        domain: FINAL_PHASE_REDUCTION_DOMAINS.canonicalMatch,
        phase: "canonical_matches" as const,
        properties: [
          "canonicalMatchCount",
          "canonicalMatchBytes",
          "canonicalMatchDigest",
          "canonicalMatchLastCursor",
        ],
      },
      {
        columns: [
          "public_root_count",
          "public_root_bytes",
          "public_root_digest",
          "public_root_last_cursor",
        ],
        counter: "public_root" as const,
        domain: FINAL_PHASE_REDUCTION_DOMAINS.publicRoot,
        phase: "public_roots" as const,
        properties: [
          "publicRootCount",
          "publicRootBytes",
          "publicRootDigest",
          "publicRootLastCursor",
        ],
      },
      {
        columns: [
          "relation_count",
          "relation_bytes",
          "relation_digest",
          "relation_last_cursor",
        ],
        counter: "relation" as const,
        domain: FINAL_PHASE_REDUCTION_DOMAINS.relation,
        phase: "relations" as const,
        properties: [
          "relationCount",
          "relationBytes",
          "relationDigest",
          "relationLastCursor",
        ],
      },
    ];
    for (const [index, testCase] of cases.entries()) {
      const [countColumn, bytesColumn, digestColumn, cursorColumn] =
        testCase.columns;
      // biome-ignore lint/performance/noAwaitInLoops: Each replay case mutates and verifies the same durable controller in sequence.
      await testEnv.DB.prepare(
        `UPDATE public_projection_final_work
            SET phase=?,status='queued',phase_cursor='',phase_ordinal=0,
                ${countColumn}=0,${bytesColumn}=0,${digestColumn}=NULL,
                ${cursorColumn}='',lease_token=NULL,lease_expires_at=NULL
          WHERE run_id=?`
      )
        .bind(testCase.phase, fixture.runId)
        .run();
      const claim = await claimFinalWork(testEnv.DB, fixture.runId);
      if (!claim) {
        throw new Error(`The ${testCase.phase} replay case was not claimed`);
      }
      const record = { index, phase: testCase.phase };
      const digest = await appendFinalPhaseDigest(testCase.domain, null, [
        record,
      ]);
      const lostResponseDb = commitThenLoseFirstBatch(testEnv.DB);
      await expect(
        commitFinalWorkPage(lostResponseDb, {
          bytesAdded: 1,
          claim,
          counter: testCase.counter,
          digest,
          lastRowCursor: "row-1",
          nextCursor: "source-1",
          nextOrdinal: 1,
          nextPhase: testCase.phase,
          rowsAdded: 1,
          statements: [],
        })
      ).rejects.toThrow("simulated committed response loss");
      const controller = await readFinalWork(testEnv.DB, fixture.runId);
      if (!controller) {
        throw new Error("The replay controller disappeared");
      }
      const values = controller as unknown as Record<string, unknown>;
      expect(testCase.properties.map((property) => values[property])).toEqual([
        1,
        1,
        digest,
        "row-1",
      ]);
      await expect(
        commitFinalWorkPage(testEnv.DB, {
          bytesAdded: 1,
          claim,
          counter: testCase.counter,
          digest,
          lastRowCursor: "row-1",
          nextCursor: "source-1",
          nextOrdinal: 1,
          nextPhase: testCase.phase,
          rowsAdded: 1,
          statements: [],
        })
      ).rejects.toThrow();
    }
  });
});
