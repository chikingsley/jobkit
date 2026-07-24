import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_JOB_ALLOCATION_VERSION } from "../../../../worker/repositories/public-projection-final-graph";
import {
  deterministicPublicJobId,
  finalPublicMemberKey,
  finalShadowMemberKey,
} from "../../../../worker/services/public-projection/final-graph";
import {
  allocationRoots,
  finalArtifacts,
  fixtureHash,
  liveGraphCounts,
  positionStages,
  stableComponents,
  stableRelations,
} from "./support/fixtures";
import { finishFinalGraph } from "./support/lifecycle";
import { testEnv, timestamp } from "./support/model";
import {
  advanceSourceMappingHead,
  seedPublicRoot,
  seedSourceMapping,
} from "./support/seed-public";
import { seedResolvedRun } from "./support/seed-runs";
import { seedOperatorDecision } from "./support/synthetic";

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public projection final duplicate graph", () => {
  it("uses every immutable winner-tuple level in order", async () => {
    const cases = [
      {
        first: {
          createdAt: "2020-01-01T00:00:00.000Z",
          id: "winner-served-private",
          published: false,
        },
        label: "served",
        second: {
          createdAt: "2025-01-01T00:00:00.000Z",
          id: "winner-served-public",
          published: true,
        },
        winner: "winner-served-public",
      },
      {
        first: {
          createdAt: "2020-01-01T00:00:00.000Z",
          id: "winner-published-late",
          published: true,
          publishedAt: "2022-01-01T00:00:00.000Z",
        },
        label: "publication",
        second: {
          createdAt: "2020-01-01T00:00:00.000Z",
          id: "winner-published-early",
          published: true,
          publishedAt: "2021-01-01T00:00:00.000Z",
        },
        winner: "winner-published-early",
      },
      {
        first: {
          createdAt: "2022-01-01T00:00:00.000Z",
          id: "winner-created-late",
          published: false,
        },
        label: "created",
        second: {
          createdAt: "2021-01-01T00:00:00.000Z",
          id: "winner-created-early",
          published: false,
        },
        winner: "winner-created-early",
      },
      {
        first: {
          createdAt: "2021-01-01T00:00:00.000Z",
          id: "winner-id-z",
          published: false,
        },
        label: "id",
        second: {
          createdAt: "2021-01-01T00:00:00.000Z",
          id: "winner-id-a",
          published: false,
        },
        winner: "winner-id-a",
      },
    ];
    for (const winnerCase of cases) {
      // biome-ignore lint/performance/noAwaitInLoops: Each fixture proves a distinct ordered winner-tuple field.
      const signalHash = await fixtureHash(`winner:${winnerCase.label}`);
      const fixture = await seedResolvedRun({
        beforeD2: async () => {
          await seedPublicRoot({ ...winnerCase.first, signalHash });
          await seedPublicRoot({ ...winnerCase.second, signalHash });
        },
        positions: [
          {
            canonicalSignalHash: signalHash,
            sourcePositionId: `winner-source-${winnerCase.label}`,
            sourceReference: `winner-reference-${winnerCase.label}`,
          },
        ],
        runId: `winner-run-${winnerCase.label}`,
      });
      const [position] = fixture.positions;
      if (!position) {
        throw new Error(`Missing winner fixture ${winnerCase.label}`);
      }
      const shadowKey = finalShadowMemberKey({
        inputHash: position.inputHash,
        sourcePositionId: position.sourcePositionId,
      });
      for (const root of [winnerCase.first, winnerCase.second]) {
        // biome-ignore lint/performance/noAwaitInLoops: The two roots are the explicit winner candidates.
        await seedOperatorDecision(
          shadowKey,
          finalPublicMemberKey({
            eligibilityDecisionVersion: 1,
            publicJobVersion: 1,
            redirectRootId: root.id,
          }),
          "same"
        );
      }
      await finishFinalGraph(testEnv.DB, fixture.runId, timestamp);
      await expect(finalArtifacts(fixture.runId)).resolves.toMatchObject({
        components: [
          expect.objectContaining({
            winning_public_job_id: winnerCase.winner,
          }),
        ],
      });
    }
  });

  it("blocks a deterministic ID occupied without matching allocation evidence", async () => {
    const fixture = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: "f".repeat(64),
          sourcePositionId: "collision-source-position",
          sourceReference: "collision-reference",
        },
      ],
      runId: "final-collision-run",
    });
    const collisionId = await deterministicPublicJobId(
      "collision-source-position"
    );
    await testEnv.DB.prepare(
      "INSERT INTO public_jobs (id,created_at) VALUES (?,?)"
    )
      .bind(collisionId, timestamp)
      .run();
    const liveBefore = await liveGraphCounts();

    await expect(
      finishFinalGraph(testEnv.DB, fixture.runId, timestamp)
    ).resolves.toMatchObject({
      allocationCount: 1,
      blockedAllocationCount: 1,
      promotableCount: 0,
      state: "complete",
    });
    await expect(finalArtifacts(fixture.runId)).resolves.toMatchObject({
      components: [
        expect.objectContaining({
          proposed_public_job_id: collisionId,
          reason_code: "public_job_id_collision",
          state: "blocked",
        }),
      ],
    });
    expect(await liveGraphCounts()).toEqual(liveBefore);
  });

  it("accepts an exact immutable allocation when a deterministic ID is replayed", async () => {
    const sourcePositionId = "allocated-replay-source-position";
    const firstRun = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: "7".repeat(64),
          sourcePositionId,
          sourceReference: "allocated-replay-reference",
        },
      ],
      runId: "allocated-replay-first",
    });
    await finishFinalGraph(testEnv.DB, firstRun.runId, timestamp);
    const [firstAllocation] = (await finalArtifacts(firstRun.runId)).components;
    if (!firstAllocation) {
      throw new Error("Missing first allocation fixture");
    }
    const publicJobId = String(firstAllocation.proposed_public_job_id);
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "INSERT INTO public_jobs (id,created_at) VALUES (?,?)"
      ).bind(publicJobId, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO public_job_allocations (
          public_job_id,allocation_algorithm_version,
          founding_source_position_id,allocation_hash,originating_run_id,
          originating_allocation_id,created_at
        ) VALUES (?,?,?,?,?,?,?)`
      ).bind(
        publicJobId,
        PUBLIC_JOB_ALLOCATION_VERSION,
        sourcePositionId,
        firstAllocation.allocation_hash,
        firstRun.runId,
        firstAllocation.id,
        timestamp
      ),
    ]);

    const replayRun = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: "7".repeat(64),
          sourcePositionId,
          sourceReference: "allocated-replay-reference",
        },
      ],
      runId: "allocated-replay-second",
    });
    await expect(
      finishFinalGraph(testEnv.DB, replayRun.runId, timestamp)
    ).resolves.toMatchObject({
      allocationCount: 1,
      blockedAllocationCount: 0,
      promotableCount: 1,
      state: "complete",
    });
    await expect(finalArtifacts(replayRun.runId)).resolves.toMatchObject({
      components: [
        expect.objectContaining({
          allocation_hash: firstAllocation.allocation_hash,
          proposed_public_job_id: publicJobId,
          reason_code: "new_public_entity",
          state: "promotable",
        }),
      ],
    });
  });

  it("keeps the existing allocation when a lower source ID joins later", async () => {
    const originalSourcePositionId = "z-original-founding-source";
    const firstRun = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: await fixtureHash("later-join-original"),
          sourcePositionId: originalSourcePositionId,
          sourceReference: "later-join-reference",
        },
      ],
      runId: "later-join-original-run",
    });
    await finishFinalGraph(testEnv.DB, firstRun.runId, timestamp);
    const [firstAllocation] = (await finalArtifacts(firstRun.runId)).components;
    const [originalPosition] = firstRun.positions;
    if (!(firstAllocation && originalPosition)) {
      throw new Error("Missing original allocation fixture");
    }
    const publicJobId = String(firstAllocation.proposed_public_job_id);
    await seedPublicRoot({
      createdAt: timestamp,
      id: publicJobId,
      published: false,
    });
    await testEnv.DB.prepare(
      `INSERT INTO public_job_allocations (
        public_job_id,allocation_algorithm_version,
        founding_source_position_id,allocation_hash,originating_run_id,
        originating_allocation_id,created_at
      ) VALUES (?,?,?,?,?,?,?)`
    )
      .bind(
        publicJobId,
        PUBLIC_JOB_ALLOCATION_VERSION,
        originalSourcePositionId,
        firstAllocation.allocation_hash,
        firstRun.runId,
        firstAllocation.id,
        timestamp
      )
      .run();
    await seedSourceMapping(originalPosition, publicJobId);

    const laterRun = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: await fixtureHash("later-join-lower"),
          sourcePositionId: "a-later-lower-source",
          sourceReference: "later-join-reference",
        },
        {
          canonicalSignalHash: await fixtureHash("later-join-original"),
          sourcePositionId: originalSourcePositionId,
          sourceReference: "later-join-reference",
        },
      ],
      runId: "later-join-second-run",
    });
    await finishFinalGraph(testEnv.DB, laterRun.runId, timestamp);
    await expect(finalArtifacts(laterRun.runId)).resolves.toMatchObject({
      components: [
        expect.objectContaining({
          founding_source_position_id: originalSourcePositionId,
          proposed_public_job_id: null,
          reason_code: "existing_source_mapping",
          winning_public_job_id: publicJobId,
        }),
      ],
    });
  });

  it("uses the current split mapping as the only existing root", async () => {
    const fixture = await seedResolvedRun({
      beforeD2: async ([position]) => {
        if (!position) {
          throw new Error("Missing split mapping fixture");
        }
        await seedPublicRoot({
          createdAt: "2020-01-01T00:00:00.000Z",
          id: "pre-split-root",
          published: false,
        });
        await seedPublicRoot({
          createdAt: "2021-01-01T00:00:00.000Z",
          id: "current-split-root",
          published: false,
        });
        await seedSourceMapping(position, "pre-split-root");
        await advanceSourceMappingHead(position, "current-split-root", "split");
      },
      positions: [
        {
          canonicalSignalHash: await fixtureHash("split-mapping-signal"),
          sourcePositionId: "split-mapping-source",
          sourceReference: "split-mapping-reference",
        },
      ],
      runId: "split-mapping-run",
    });

    await finishFinalGraph(testEnv.DB, fixture.runId, timestamp);
    await expect(finalArtifacts(fixture.runId)).resolves.toMatchObject({
      components: [
        expect.objectContaining({
          candidate_root_count: 1,
          reason_code: "existing_source_mapping",
          winning_public_job_id: "current-split-root",
        }),
      ],
    });
    await expect(allocationRoots(fixture.runId)).resolves.toEqual([
      expect.objectContaining({
        public_job_id: "current-split-root",
        selected: 1,
      }),
    ]);
  });

  it("processes more than 25 unrelated one-member allocation components deterministically", async () => {
    const positions = await Promise.all(
      Array.from({ length: 26 }, async (_, index) => ({
        canonicalSignalHash: await fixtureHash(`unrelated:${index}`),
        sourcePositionId: `unrelated-source-${index.toString().padStart(2, "0")}`,
        sourceReference: `unrelated-reference-${index}`,
      }))
    );
    const firstRun = await seedResolvedRun({
      positions,
      runId: "unrelated-components-first",
    });
    await expect(
      finishFinalGraph(testEnv.DB, firstRun.runId, timestamp)
    ).resolves.toMatchObject({
      allocationCount: 26,
      blockedAllocationCount: 0,
      promotableCount: 26,
      state: "complete",
    });
    const firstArtifacts = await finalArtifacts(firstRun.runId);
    expect(firstArtifacts.components).toHaveLength(26);
    expect(firstArtifacts.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          member_count: 1,
          reason_code: "new_public_entity",
          state: "promotable",
        }),
      ])
    );

    const replayRun = await seedResolvedRun({
      positions: [...positions].reverse(),
      runId: "unrelated-components-replay",
    });
    await finishFinalGraph(testEnv.DB, replayRun.runId, timestamp);
    const replayArtifacts = await finalArtifacts(replayRun.runId);
    expect(stableComponents(replayArtifacts.components)).toEqual(
      stableComponents(firstArtifacts.components)
    );
    expect(stableRelations(replayArtifacts.relations)).toEqual(
      stableRelations(firstArtifacts.relations)
    );
  }, 30_000);

  it("blocks only an allocation component whose connected graph exceeds 25 members", async () => {
    const connected = await Promise.all(
      Array.from({ length: 26 }, async (_, index) => ({
        canonicalSignalHash: await fixtureHash(`connected:${index}`),
        sourcePositionId: `connected-source-${index.toString().padStart(2, "0")}`,
        sourceReference: "one-connected-source-reference",
      }))
    );
    const fixture = await seedResolvedRun({
      positions: [
        ...connected,
        {
          canonicalSignalHash: await fixtureHash("normal-component"),
          sourcePositionId: "normal-source-position",
          sourceReference: "normal-source-reference",
        },
      ],
      runId: "mixed-component-size-run",
    });

    await expect(
      finishFinalGraph(testEnv.DB, fixture.runId, timestamp)
    ).resolves.toMatchObject({
      allocationCount: 2,
      blockedAllocationCount: 1,
      promotableCount: 1,
      state: "complete",
    });
    await expect(finalArtifacts(fixture.runId)).resolves.toMatchObject({
      components: expect.arrayContaining([
        expect.objectContaining({
          member_count: 26,
          proposed_public_job_id: null,
          reason_code: "promotion_component_too_large",
          state: "blocked",
        }),
        expect.objectContaining({
          member_count: 1,
          reason_code: "new_public_entity",
          state: "promotable",
        }),
      ]),
    });
    await expect(positionStages(fixture.runId)).resolves.toHaveLength(27);
    await expect(positionStages(fixture.runId)).resolves.toEqual(
      expect.arrayContaining([{ stage: "content", status: "queued" }])
    );
  });
});
