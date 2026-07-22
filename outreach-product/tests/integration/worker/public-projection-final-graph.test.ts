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
import { readDuplicateBatch } from "../../../worker/repositories/public-projection-duplicate-comparisons";
import {
  CANONICAL_LIVE_CANDIDATE_PAGE_SQL,
  PUBLIC_JOB_ALLOCATION_VERSION,
  readCanonicalLiveCandidatePage,
} from "../../../worker/repositories/public-projection-final-graph";
import {
  COMPONENT_LEFT_NEIGHBOR_PAGE_SQL,
  COMPONENT_RIGHT_NEIGHBOR_PAGE_SQL,
  readSameRelationNeighborPage,
} from "../../../worker/repositories/public-projection-final-work/component-frontier";
import {
  COMPONENT_ROOT_CANDIDATE_PAGE_SQL,
  COMPONENT_ROOT_WINNER_SQL,
  readComponentRootCandidatePage,
  readComponentRootSummary,
} from "../../../worker/repositories/public-projection-final-work/component-relations";
import {
  claimFinalWork,
  commitFinalWorkPage,
  readFinalWork,
} from "../../../worker/repositories/public-projection-final-work/controller";
import { advancePublicProjectionRuns } from "../../../worker/services/public-projection/advancement";
import { finalizeStableDuplicateComparisons } from "../../../worker/services/public-projection/duplicate-comparisons";
import {
  appendFinalPhaseDigest,
  deterministicPublicJobId,
  FINAL_PHASE_REDUCTION_DOMAINS,
  finalizeCanonicalDuplicateGraph,
  finalPublicMemberKey,
  finalShadowMemberKey,
  LIVE_CANONICAL_MATCH_KEYSET_SQL,
  LIVE_CANONICAL_SHADOW_PAGE_SQL,
  readLiveCanonicalPairPage,
  readSameRunCanonicalPairPage,
  SAME_RUN_CANONICAL_LEFT_KEYSET_SQL,
  SAME_RUN_CANONICAL_RIGHT_PAGE_SQL,
} from "../../../worker/services/public-projection/final-graph";
import {
  canonicalJson,
  canonicalSha256,
  compareUtf8Bytes,
} from "../../../worker/services/public-projection/hash";
import {
  publicProjectionPolicyHeadsHash,
  publicProjectionSourceWatermark,
} from "../../../worker/services/public-projection/snapshots";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

interface PositionFixture {
  inputHash: string;
  itemId: string;
  listingId: string;
  sourcePositionId: string;
}

const testEnv = env as TestEnv;
const timestamp = "2026-07-22T12:00:00.000Z";
const SAME_RUN_INPUT_SCAN_PATTERN = /SCAN (?:left_input|right_input)/u;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public projection final duplicate graph", () => {
  it("replays and remains order independent with the lowest founding anchor", async () => {
    const firstRun = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: "c".repeat(64),
          sourcePositionId: "source-position-z",
          sourceReference: "shared-final-reference",
        },
        {
          canonicalSignalHash: "c".repeat(64),
          sourcePositionId: "source-position-a",
          sourceReference: "shared-final-reference",
        },
      ],
      runId: "final-order-first",
    });
    await expect(runLifecycle(firstRun.runId)).resolves.toEqual({
      finalSealCount: 0,
      runStatus: "running",
    });
    const liveBefore = await liveGraphSnapshot();
    const first = await finishFinalGraph(testEnv.DB, firstRun.runId, timestamp);
    expect(first).toMatchObject({
      allocationCount: 1,
      blockedAllocationCount: 0,
      promotableCount: 1,
      relationCount: 1,
      replayed: false,
      state: "complete",
    });
    await expect(
      finalizeCanonicalDuplicateGraph(
        testEnv.DB,
        firstRun.runId,
        "2099-01-01T00:00:00.000Z"
      )
    ).resolves.toMatchObject({ replayed: true, state: "complete" });
    expect(await liveGraphSnapshot()).toBe(liveBefore);
    const firstArtifacts = await finalArtifacts(firstRun.runId);
    expect(firstArtifacts.components).toEqual([
      expect.objectContaining({
        founding_source_position_id: "source-position-a",
        proposed_public_job_id:
          await deterministicPublicJobId("source-position-a"),
        reason_code: "new_public_entity",
        state: "promotable",
      }),
    ]);

    const secondRun = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: "c".repeat(64),
          sourcePositionId: "source-position-a",
          sourceReference: "shared-final-reference",
        },
        {
          canonicalSignalHash: "c".repeat(64),
          sourcePositionId: "source-position-z",
          sourceReference: "shared-final-reference",
        },
      ],
      runId: "final-order-second",
    });
    await finishFinalGraph(testEnv.DB, secondRun.runId, timestamp);
    const secondArtifacts = await finalArtifacts(secondRun.runId);

    expect(stableComponents(secondArtifacts.components)).toEqual(
      stableComponents(firstArtifacts.components)
    );
    expect(stableRelations(secondArtifacts.relations)).toEqual(
      stableRelations(firstArtifacts.relations)
    );
    await expect(positionStages(firstRun.runId)).resolves.toEqual([
      { stage: "content", status: "queued" },
      { stage: "content", status: "queued" },
    ]);
    await expect(runLifecycle(firstRun.runId)).resolves.toEqual({
      finalSealCount: 1,
      runStatus: "running",
    });
    await expect(appendSealedAllocationMember(firstRun.runId)).rejects.toThrow(
      "allocation member boundary is sealed"
    );
    await expect(
      appendSealedAllocationRelation(firstRun.runId)
    ).rejects.toThrow("allocation relation boundary is sealed");
    await expect(appendSealedFinalRelation(firstRun.runId)).rejects.toThrow(
      "final duplicate relation boundary is unavailable"
    );
    await expect(appendSealedComponent(firstRun.runId)).rejects.toThrow(
      "allocation component boundary is unavailable"
    );
    await expect(appendSealedFinalSeal(firstRun.runId)).rejects.toThrow(
      "final duplicate seal boundary changed"
    );
  });

  it("blocks every component touched by an unresolved canonical collision", async () => {
    const fixture = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: "d".repeat(64),
          sourcePositionId: "ambiguous-source-a",
          sourceReference: "ambiguous-reference-a",
        },
        {
          canonicalSignalHash: "d".repeat(64),
          sourcePositionId: "ambiguous-source-b",
          sourceReference: "ambiguous-reference-b",
        },
      ],
      runId: "final-ambiguous-run",
    });

    await expect(
      finishFinalGraph(testEnv.DB, fixture.runId, timestamp)
    ).resolves.toMatchObject({
      allocationCount: 2,
      blockedAllocationCount: 2,
      promotableCount: 0,
      relationCount: 1,
      state: "complete",
    });
    const artifacts = await finalArtifacts(fixture.runId);
    expect(artifacts.relations).toEqual([
      expect.objectContaining({
        d2_comparison_id: null,
        reason_code: "canonical_identity_only",
        relation: "ambiguous",
      }),
    ]);
    expect(artifacts.components).toHaveLength(2);
    expect(artifacts.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposed_public_job_id: null,
          reason_code: "public_identity_ambiguous",
          state: "blocked",
          winning_public_job_id: null,
        }),
      ])
    );
    await expect(positionStages(fixture.runId)).resolves.toEqual([
      { stage: "content", status: "queued" },
      { stage: "content", status: "queued" },
    ]);
  });

  it("pins an ambiguous live root as a candidate without merging it", async () => {
    const fixture = await seedResolvedRun({
      beforeD2: async () => {
        await seedPublicRoot({
          createdAt: "2024-01-01T00:00:00.000Z",
          id: "ambiguous-live-root",
          published: false,
          signalHash: "9".repeat(64),
        });
      },
      positions: [
        {
          canonicalSignalHash: "9".repeat(64),
          sourcePositionId: "ambiguous-live-source",
          sourceReference: "ambiguous-live-reference",
        },
      ],
      runId: "final-ambiguous-live-run",
    });

    await expect(
      finishFinalGraph(testEnv.DB, fixture.runId, timestamp)
    ).resolves.toMatchObject({
      allocationCount: 1,
      blockedAllocationCount: 1,
      promotableCount: 0,
      relationCount: 1,
      state: "complete",
    });
    await expect(finalArtifacts(fixture.runId)).resolves.toMatchObject({
      components: [
        expect.objectContaining({
          candidate_root_count: 1,
          losing_root_count: 1,
          reason_code: "public_identity_ambiguous",
          winning_public_job_id: null,
        }),
      ],
      relations: [
        expect.objectContaining({
          reason_code: "canonical_identity_only",
          relation: "ambiguous",
        }),
      ],
    });
    await expect(allocationRoots(fixture.runId)).resolves.toEqual([
      expect.objectContaining({
        public_job_id: "ambiguous-live-root",
        reason_code: "public_identity_ambiguous",
        selected: 0,
      }),
    ]);
    await expect(appendSealedAllocationRoot(fixture.runId)).rejects.toThrow(
      "allocation root boundary is sealed"
    );
    await expect(appendSealedCanonicalInput(fixture.runId)).rejects.toThrow(
      "canonical live input boundary is unavailable"
    );
  });

  it("selects a previously served root over an older private root", async () => {
    const fixture = await seedResolvedRun({
      beforeD2: async ([mappedPosition]) => {
        if (!mappedPosition) {
          throw new Error("Missing merge position fixture");
        }
        await seedPublicRoot({
          createdAt: "2025-01-01T00:00:00.000Z",
          id: "served-root",
          published: true,
          signalHash: "e".repeat(64),
        });
        await seedPublicRoot({
          createdAt: "2020-01-01T00:00:00.000Z",
          id: "older-private-root",
          published: false,
        });
        await seedSourceMapping(mappedPosition, "older-private-root");
      },
      positions: [
        {
          canonicalSignalHash: "e".repeat(64),
          sourcePositionId: "merge-source-position",
          sourceReference: "merge-source-reference",
        },
      ],
      runId: "final-merge-winner-run",
    });
    const [position] = fixture.positions;
    if (!position) {
      throw new Error("Missing merge position fixture");
    }
    await seedSameOperatorDecision(
      finalShadowMemberKey({
        inputHash: position.inputHash,
        sourcePositionId: position.sourcePositionId,
      }),
      finalPublicMemberKey({
        eligibilityDecisionVersion: 1,
        publicJobVersion: 1,
        redirectRootId: "served-root",
      })
    );

    await finishFinalGraph(testEnv.DB, fixture.runId, timestamp);
    const artifacts = await finalArtifacts(fixture.runId);
    expect(artifacts.components).toEqual([
      expect.objectContaining({
        candidate_root_count: 2,
        losing_root_count: 1,
        reason_code: "existing_duplicate_winner",
        state: "promotable",
        winning_public_job_id: "served-root",
      }),
    ]);
    await expect(allocationRoots(fixture.runId)).resolves.toEqual([
      expect.objectContaining({
        public_job_id: "older-private-root",
        reason_code: "merged_into_existing_winner",
        selected: 0,
      }),
      expect.objectContaining({
        public_job_id: "served-root",
        reason_code: "existing_duplicate_winner",
        selected: 1,
        served_publicly: 1,
      }),
    ]);
    await expect(appendSealedMappingInput(fixture.runId)).rejects.toThrow(
      "source mapping input boundary is unavailable"
    );
  });

  it("honors an operator-confirmed different canonical pair", async () => {
    const signalHash = await fixtureHash("operator-different-signal");
    const fixture = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: signalHash,
          sourcePositionId: "operator-different-a",
          sourceReference: "operator-different-reference-a",
        },
        {
          canonicalSignalHash: signalHash,
          sourcePositionId: "operator-different-b",
          sourceReference: "operator-different-reference-b",
        },
      ],
      runId: "operator-different-run",
    });
    const [first, second] = fixture.positions;
    if (!(first && second)) {
      throw new Error("Missing operator-different fixtures");
    }
    await seedOperatorDecision(
      finalShadowMemberKey({
        inputHash: first.inputHash,
        sourcePositionId: first.sourcePositionId,
      }),
      finalShadowMemberKey({
        inputHash: second.inputHash,
        sourcePositionId: second.sourcePositionId,
      }),
      "different"
    );

    await expect(
      finishFinalGraph(testEnv.DB, fixture.runId, timestamp)
    ).resolves.toMatchObject({
      allocationCount: 2,
      blockedAllocationCount: 0,
      promotableCount: 2,
    });
    await expect(finalArtifacts(fixture.runId)).resolves.toMatchObject({
      relations: [
        expect.objectContaining({
          reason_code: "operator_confirmed_different",
          relation: "different",
        }),
      ],
    });
  });

  it("allows only one deferred decision to resolve into a terminal decision", async () => {
    const left = `shadow:decision-left:${"1".repeat(64)}`;
    const right = `shadow:decision-right:${"2".repeat(64)}`;
    await ensureFixtureOperator();
    const deferredId = await insertOperatorDecision({
      decision: "deferred",
      left,
      right,
      supersedesDecisionId: null,
    });
    await expect(
      insertOperatorDecision({
        decision: "deferred",
        left,
        right,
        supersedesDecisionId: deferredId,
      })
    ).rejects.toThrow("final duplicate decision resolution is invalid");
    const terminalId = await insertOperatorDecision({
      decision: "same",
      left,
      right,
      supersedesDecisionId: deferredId,
    });
    await expect(
      insertOperatorDecision({
        decision: "different",
        left,
        right,
        supersedesDecisionId: terminalId,
      })
    ).rejects.toThrow("final duplicate decision resolution is invalid");
  });

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
  });

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

  it("resumes a normalized component whose former aggregate exceeds two megabytes", async () => {
    const fixture = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: await fixtureHash("hostile-component"),
          sourcePositionId: "hostile-component-source",
          sourceReference: "hostile-component-reference",
        },
      ],
      runId: "hostile-normalized-component-run",
    });
    const component = await advanceFinalGraphToComponentState(
      fixture.runId,
      "relations"
    );
    const memberRow = await testEnv.DB.prepare(
      `SELECT payload_json FROM public_projection_final_work_component_members
        WHERE run_id=? AND seed_member_key=? ORDER BY ordinal LIMIT 1`
    )
      .bind(fixture.runId, component.seed_member_key)
      .first<{ payload_json: string }>();
    if (!memberRow) {
      throw new Error("Missing hostile component member");
    }
    const leftMember = JSON.parse(memberRow.payload_json) as Record<
      string,
      unknown
    >;
    const relations = makeHostileRelations(leftMember, 300);
    const formerAggregateBytes = new TextEncoder().encode(
      canonicalJson({ members: [leftMember], relations })
    ).byteLength;
    expect(formerAggregateBytes).toBeGreaterThan(2_000_000);
    await insertHostileWorkRelations({
      relations,
      runId: fixture.runId,
    });

    await expect(
      finalizeCanonicalDuplicateGraph(
        commitThenLoseFirstBatch(testEnv.DB),
        fixture.runId,
        timestamp
      )
    ).rejects.toThrow("simulated committed response loss");
    await expect(componentWorkSnapshot(fixture.runId)).resolves.toMatchObject({
      child_cursor: canonicalJson({
        memberKey: component.seed_member_key,
        relationId: "hostile-relation-0023",
        side: "left",
      }),
      relation_count: 24,
      state: "relations",
    });

    const sealed = await advanceFinalGraphToComponentState(
      fixture.runId,
      "sealed"
    );
    const digestRecords = relations.map((relation) => ({
      id: relation.id,
      reasonCode: relation.reasonCode,
      relation: relation.relation,
      relationHash: relation.relationHash,
    }));
    const digests = await Promise.all(
      [1, 7, 24, 300].map((pageSize) =>
        reductionDigestByPageSize(
          "jobkit-public-component-relations/reduction-v1",
          digestRecords,
          pageSize
        )
      )
    );
    expect(new Set(digests)).toHaveLength(1);
    expect(sealed).toMatchObject({
      founding_source_position_id: "hostile-component-source",
      relation_count: 300,
      relation_digest: digests[0],
      relation_last_cursor: "hostile-relation-0299",
      root_count: 0,
      state: "sealed",
      winning_public_job_id: null,
    });
    const normalized = await testEnv.DB.prepare(
      `SELECT ordinal,relation_id,relation_hash,encoded_bytes
         FROM public_projection_final_work_component_relations
        WHERE run_id=? AND seed_member_key=? ORDER BY ordinal`
    )
      .bind(fixture.runId, component.seed_member_key)
      .all<{
        encoded_bytes: number;
        ordinal: number;
        relation_hash: string;
        relation_id: string;
      }>();
    expect(normalized.results).toEqual(
      relations.map((relation, ordinal) => ({
        encoded_bytes: new TextEncoder().encode(
          canonicalJson({
            relationHash: relation.relationHash,
            relationId: relation.id,
          })
        ).byteLength,
        ordinal,
        relation_hash: relation.relationHash,
        relation_id: relation.id,
      }))
    );
    const bounds = await componentArtifactBounds(fixture.runId);
    if (!bounds) {
      throw new Error("Missing hostile component artifact bounds");
    }
    expect(bounds).toMatchObject({
      component_json_columns: 0,
      component_relation_count: 300,
    });
    expect(bounds.max_child_bytes).toBeLessThan(1_000_000);
    expect(bounds.max_work_relation_bytes).toBeLessThan(1_000_000);

    const sealedBeforeReplay = canonicalJson(sealed);
    await finalizeCanonicalDuplicateGraph(testEnv.DB, fixture.runId, timestamp);
    expect(canonicalJson(await componentWorkSnapshot(fixture.runId))).toBe(
      sealedBeforeReplay
    );
  });

  it("rolls back the final graph when a canonical signal origin head advances", async () => {
    const signalHash = await fixtureHash("canonical-head-interleaving");
    const fixture = await seedResolvedRun({
      beforeD2: async () => {
        await seedPublicRoot({
          createdAt: "2024-01-01T00:00:00.000Z",
          id: "canonical-head-origin",
          published: false,
          signalHash,
        });
      },
      positions: [
        {
          canonicalSignalHash: signalHash,
          sourcePositionId: "canonical-head-source",
          sourceReference: "canonical-head-reference",
        },
      ],
      runId: "canonical-head-interleaving-run",
    });
    await advanceFinalGraphToReady(testEnv.DB, fixture.runId, timestamp);
    let injected = false;
    const interleavingDb = beforeFirstBatch(testEnv.DB, async () => {
      injected = true;
      await advancePublicJobHead("canonical-head-origin", signalHash);
    });

    await expect(
      finalizeCanonicalDuplicateGraph(interleavingDb, fixture.runId, timestamp)
    ).rejects.toMatchObject({ code: "final_duplicate_input_snapshot_changed" });
    expect(injected).toBe(true);
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
    await expect(positionStages(fixture.runId)).resolves.toEqual([
      { stage: "canonical_resolution", status: "queued" },
    ]);
  });

  it("rolls back the final graph when a source-mapping head advances", async () => {
    let mappedPosition: PositionFixture | undefined;
    const fixture = await seedResolvedRun({
      beforeD2: async ([position]) => {
        if (!position) {
          throw new Error("Missing mapping interleaving fixture");
        }
        mappedPosition = position;
        await seedPublicRoot({
          createdAt: "2024-01-01T00:00:00.000Z",
          id: "mapping-head-origin",
          published: false,
        });
        await seedSourceMapping(position, "mapping-head-origin");
      },
      positions: [
        {
          canonicalSignalHash: await fixtureHash("mapping-head-signal"),
          sourcePositionId: "mapping-head-source",
          sourceReference: "mapping-head-reference",
        },
      ],
      runId: "mapping-head-interleaving-run",
    });
    if (!mappedPosition) {
      throw new Error("Missing captured mapping interleaving fixture");
    }
    const exactMappedPosition = mappedPosition;
    await advanceFinalGraphToReady(testEnv.DB, fixture.runId, timestamp);
    const liveBefore = await liveGraphCountsExcludingMappings();
    let injected = false;
    const interleavingDb = beforeFirstBatch(testEnv.DB, async () => {
      injected = true;
      await advanceSourceMappingHead(
        exactMappedPosition,
        "mapping-head-origin"
      );
    });

    await expect(
      finalizeCanonicalDuplicateGraph(interleavingDb, fixture.runId, timestamp)
    ).rejects.toMatchObject({ code: "final_duplicate_input_snapshot_changed" });
    expect(injected).toBe(true);
    await expect(liveGraphCountsExcludingMappings()).resolves.toEqual(
      liveBefore
    );
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
    await expect(positionStages(fixture.runId)).resolves.toEqual([
      { stage: "canonical_resolution", status: "queued" },
    ]);
  });

  it("rolls back the final graph when an absent source-mapping head appears unmapped", async () => {
    const fixture = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: await fixtureHash("mapping-absent-unmapped"),
          sourcePositionId: "mapping-absent-unmapped-source",
          sourceReference: "mapping-absent-unmapped-reference",
        },
      ],
      runId: "mapping-absent-unmapped-run",
    });
    const [position] = fixture.positions;
    if (!position) {
      throw new Error("Missing absent mapping fixture");
    }
    await advanceFinalGraphToReady(testEnv.DB, fixture.runId, timestamp);
    const liveBefore = await liveGraphCountsExcludingMappings();
    const interleavingDb = beforeFirstBatch(testEnv.DB, () =>
      seedUnmappedSourceMapping(position)
    );

    await expect(
      finalizeCanonicalDuplicateGraph(interleavingDb, fixture.runId, timestamp)
    ).rejects.toMatchObject({ code: "final_duplicate_input_snapshot_changed" });
    await expect(liveGraphCountsExcludingMappings()).resolves.toEqual(
      liveBefore
    );
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

  it("rolls back the final graph when an unmapped source-mapping head advances", async () => {
    let unmappedPosition: PositionFixture | undefined;
    const fixture = await seedResolvedRun({
      beforeD2: async ([position]) => {
        if (!position) {
          throw new Error("Missing unmapped advance fixture");
        }
        unmappedPosition = position;
        await seedUnmappedSourceMapping(position);
      },
      positions: [
        {
          canonicalSignalHash: await fixtureHash("mapping-unmapped-advance"),
          sourcePositionId: "mapping-unmapped-advance-source",
          sourceReference: "mapping-unmapped-advance-reference",
        },
      ],
      runId: "mapping-unmapped-advance-run",
    });
    if (!unmappedPosition) {
      throw new Error("Missing captured unmapped advance fixture");
    }
    const exactUnmappedPosition = unmappedPosition;
    await advanceFinalGraphToReady(testEnv.DB, fixture.runId, timestamp);
    const liveBefore = await liveGraphCountsExcludingMappings();
    const interleavingDb = beforeFirstBatch(testEnv.DB, () =>
      advanceUnmappedSourceMappingHead(exactUnmappedPosition)
    );

    await expect(
      finalizeCanonicalDuplicateGraph(interleavingDb, fixture.runId, timestamp)
    ).rejects.toMatchObject({ code: "final_duplicate_input_snapshot_changed" });
    await expect(liveGraphCountsExcludingMappings()).resolves.toEqual(
      liveBefore
    );
    await expect(finalGraphCounts(fixture.runId)).resolves.toMatchObject({
      allocations: 0,
      components: 0,
      mappingInputs: 0,
      seals: 0,
    });
  });

  it("rolls back the final graph when an unmapped source-mapping head becomes mapped", async () => {
    let unmappedPosition: PositionFixture | undefined;
    const fixture = await seedResolvedRun({
      beforeD2: async ([position]) => {
        if (!position) {
          throw new Error("Missing unmapped-to-mapped fixture");
        }
        unmappedPosition = position;
        await seedPublicRoot({
          createdAt: "2024-01-01T00:00:00.000Z",
          id: "mapping-unmapped-target",
          published: false,
        });
        await seedUnmappedSourceMapping(position);
      },
      positions: [
        {
          canonicalSignalHash: await fixtureHash("mapping-unmapped-mapped"),
          sourcePositionId: "mapping-unmapped-mapped-source",
          sourceReference: "mapping-unmapped-mapped-reference",
        },
      ],
      runId: "mapping-unmapped-mapped-run",
    });
    if (!unmappedPosition) {
      throw new Error("Missing captured unmapped-to-mapped fixture");
    }
    const exactUnmappedPosition = unmappedPosition;
    await advanceFinalGraphToReady(testEnv.DB, fixture.runId, timestamp);
    const liveBefore = await liveGraphCountsExcludingMappings();
    const interleavingDb = beforeFirstBatch(testEnv.DB, () =>
      advanceUnmappedSourceMappingHead(
        exactUnmappedPosition,
        "mapping-unmapped-target"
      )
    );

    await expect(
      finalizeCanonicalDuplicateGraph(interleavingDb, fixture.runId, timestamp)
    ).rejects.toMatchObject({ code: "final_duplicate_input_snapshot_changed" });
    await expect(liveGraphCountsExcludingMappings()).resolves.toEqual(
      liveBefore
    );
    await expect(finalGraphCounts(fixture.runId)).resolves.toMatchObject({
      allocations: 0,
      components: 0,
      mappingInputs: 0,
      seals: 0,
    });
  });

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

  it("admits one claimant and rejects a stale reclaimed lease", async () => {
    const fixture = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: await fixtureHash("lease-race"),
          sourcePositionId: "lease-race-source",
          sourceReference: "lease-race-reference",
        },
      ],
      runId: "lease-race-run",
    });
    await finalizeCanonicalDuplicateGraph(testEnv.DB, fixture.runId, timestamp);
    const claims = await Promise.all([
      claimFinalWork(testEnv.DB, fixture.runId),
      claimFinalWork(testEnv.DB, fixture.runId),
    ]);
    const firstClaim = claims.find((claim) => claim !== null);
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    if (!firstClaim) {
      throw new Error("The lease race produced no winner");
    }
    await testEnv.DB.prepare(
      `UPDATE public_projection_final_work
          SET lease_expires_at='2000-01-01T00:00:00.000Z'
        WHERE run_id=? AND lease_token=?`
    )
      .bind(fixture.runId, firstClaim.leaseToken)
      .run();
    const reclaimed = await claimFinalWork(testEnv.DB, fixture.runId);
    expect(reclaimed).toMatchObject({
      leaseEpoch: firstClaim.leaseEpoch + 1,
      phase: firstClaim.phase,
    });

    await expect(
      commitFinalWorkPage(testEnv.DB, {
        bytesAdded: 0,
        claim: firstClaim,
        counter: "mapping",
        nextCursor: firstClaim.phaseCursor,
        nextOrdinal: firstClaim.phaseOrdinal,
        nextPhase: firstClaim.phase,
        rowsAdded: 0,
        statements: [],
      })
    ).rejects.toThrow();
    await expect(
      readFinalWork(testEnv.DB, fixture.runId)
    ).resolves.toMatchObject({ phase: firstClaim.phase, status: "processing" });
  });

  it("replays a final seal when its committed response is lost", async () => {
    const fixture = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: await fixtureHash("lost-final-response"),
          sourcePositionId: "lost-final-source",
          sourceReference: "lost-final-reference",
        },
      ],
      runId: "lost-final-response-run",
    });
    await advanceFinalGraphToReady(testEnv.DB, fixture.runId, timestamp);

    await expect(
      finalizeCanonicalDuplicateGraph(
        commitThenLoseFirstBatch(testEnv.DB),
        fixture.runId,
        timestamp
      )
    ).rejects.toMatchObject({
      code: "final_duplicate_input_snapshot_changed",
    });
    await expect(
      finalizeCanonicalDuplicateGraph(testEnv.DB, fixture.runId, timestamp)
    ).resolves.toMatchObject({ replayed: true, state: "complete" });
    await expect(
      readFinalWork(testEnv.DB, fixture.runId)
    ).resolves.toMatchObject({ phase: "sealed", status: "sealed" });
  });

  it("rejects a terminal operator decision added after relation paging", async () => {
    const signalHash = await fixtureHash("operator-absence-pin");
    const fixture = await seedResolvedRun({
      positions: [
        {
          canonicalSignalHash: signalHash,
          sourcePositionId: "operator-absence-a",
          sourceReference: "operator-absence-reference-a",
        },
        {
          canonicalSignalHash: signalHash,
          sourcePositionId: "operator-absence-b",
          sourceReference: "operator-absence-reference-b",
        },
      ],
      runId: "operator-absence-pin-run",
    });
    await advanceFinalGraphToReady(testEnv.DB, fixture.runId, timestamp);
    const [first, second] = fixture.positions;
    if (!(first && second)) {
      throw new Error("Missing operator absence fixtures");
    }
    const interleavingDb = beforeFirstBatch(testEnv.DB, () =>
      seedSameOperatorDecision(
        finalShadowMemberKey({
          inputHash: first.inputHash,
          sourcePositionId: first.sourcePositionId,
        }),
        finalShadowMemberKey({
          inputHash: second.inputHash,
          sourcePositionId: second.sourcePositionId,
        })
      )
    );

    await expect(
      finalizeCanonicalDuplicateGraph(interleavingDb, fixture.runId, timestamp)
    ).rejects.toMatchObject({ code: "final_duplicate_input_snapshot_changed" });
    await expect(finalGraphCounts(fixture.runId)).resolves.toMatchObject({
      allocations: 0,
      relations: 0,
      seals: 0,
    });
  });
});

async function seedResolvedRun(input: {
  advanceable?: boolean;
  beforeD2?: (positions: PositionFixture[]) => Promise<void>;
  positions: {
    canonicalSignalHash: string;
    sourcePositionId: string;
    sourceReference: string;
  }[];
  runId: string;
}) {
  const listingIds = input.positions.map(
    (position) => `listing:${position.sourcePositionId}`
  );
  if (input.advanceable) {
    await seedListingMaterials(
      input.positions.map((position, index) => ({
        listingId: listingIds[index] ?? "",
        sourceReference: position.sourceReference,
      }))
    );
    await seedAdvanceableRun(input.runId, listingIds);
  } else {
    await seedRun(input.runId);
  }
  const positions: PositionFixture[] = [];
  for (const [index, specification] of input.positions.entries()) {
    // biome-ignore lint/performance/noAwaitInLoops: Ordered inserts intentionally vary the D2 row order.
    const position = await seedPosition({
      itemId: `${input.runId}:position:${index}`,
      listingId: listingIds[index] ?? "",
      runId: input.runId,
      sourcePositionId: specification.sourcePositionId,
      sourceReference: specification.sourceReference,
    });
    positions.push(position);
  }
  await input.beforeD2?.(positions);
  const batch = await finishD2(input.runId);
  for (const [index, position] of positions.entries()) {
    // biome-ignore lint/performance/noAwaitInLoops: Resolution fixtures mirror one sealed position at a time.
    await seedCanonicalResolution({
      batchInputHash: batch.inputHash,
      canonicalSignalHash: input.positions[index]?.canonicalSignalHash ?? "",
      position,
      runId: input.runId,
    });
  }
  return { positions, runId: input.runId };
}

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

async function seedAdvanceableRun(runId: string, listingIds: string[]) {
  const scope = { boards: [], listingIds };
  const [policyHeadsHash, sourceWatermark] = await Promise.all([
    publicProjectionPolicyHeadsHash(testEnv.DB),
    publicProjectionSourceWatermark(testEnv.DB, scope),
  ]);
  await testEnv.DB.prepare(
    `INSERT INTO public_projection_runs (
      id,mode,request_key,scope_json,contract_version,projector_version,
      policy_heads_hash,source_watermark_json,status,selection_complete,
      listing_total,listing_completed,position_total,
      started_at,requested_at,updated_at
    ) VALUES (?,'shadow',?,?,1,'projector-v1',?,?,'running',1,?,?,?, ?,?,?)`
  )
    .bind(
      runId,
      `request:${runId}`,
      JSON.stringify(scope),
      policyHeadsHash,
      JSON.stringify(sourceWatermark),
      listingIds.length,
      listingIds.length,
      listingIds.length,
      timestamp,
      timestamp,
      timestamp
    )
    .run();
}

async function seedListingMaterials(
  listings: { listingId: string; sourceReference: string }[]
) {
  for (const listing of listings) {
    const job = jobFixture(listing.listingId, listing.sourceReference);
    const materialJson = serializeInventoryJobMaterial(job);
    // biome-ignore lint/performance/noAwaitInLoops: Exact listing material fixtures establish the source watermark before the run is sealed.
    const materialHash = await inventoryJobMaterialHash(job);
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT OR IGNORE INTO job_listings (
          id,board,title,company,salary,description,apply_url,first_seen_at,
          updated_at,inventory_status,material_hash,material_hash_version,
          material_version,material_changed_at
        ) VALUES (?,?,?,?,?,?,?,?,?,'active',?,1,1,?)`
      ).bind(
        listing.listingId,
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
        `INSERT OR IGNORE INTO job_listing_versions (
          listing_id,material_version,material_hash,material_hash_version,
          material_json,created_at
        ) VALUES (?,1,?,1,?,?)`
      ).bind(listing.listingId, materialHash, materialJson, timestamp),
    ]);
  }
}

async function seedPosition(input: {
  itemId: string;
  listingId: string;
  runId: string;
  sourcePositionId: string;
  sourceReference: string;
}) {
  const job = jobFixture(input.listingId, input.sourceReference);
  const materialJson = serializeInventoryJobMaterial(job);
  const materialHash = await inventoryJobMaterialHash(job);
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO job_listings (
        id,board,title,company,salary,description,apply_url,first_seen_at,
        updated_at,inventory_status,material_hash,material_hash_version,
        material_version,material_changed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,'active',?,1,1,?)`
    ).bind(
      input.listingId,
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
      `INSERT OR IGNORE INTO job_listing_versions (
        listing_id,material_version,material_hash,material_hash_version,
        material_json,created_at
      ) VALUES (?,1,?,1,?,?)`
    ).bind(input.listingId, materialHash, materialJson, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_listing_items (
        id,run_id,listing_id,material_version,input_hash,stage,status,
        checkpoint_json,created_at,completed_at,updated_at
      ) VALUES (?, ?, ?, 1, ?, 'completed','completed','{}', ?, ?, ?)`
    ).bind(
      `listing-item:${input.runId}:${input.listingId}`,
      input.runId,
      input.listingId,
      materialHash,
      timestamp,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO job_source_positions (
        id,listing_id,source_key,position_key,position_kind,created_at
      ) VALUES (?,?,'tefl','direct','direct',?)`
    ).bind(input.sourcePositionId, input.listingId, timestamp),
  ]);
  const signals = await Promise.all([
    materialCloneSignal(materialHash),
    sourceReferenceSignal({
      sourceKey: "tefl",
      sourceReference: input.sourceReference,
    }),
  ]);
  signals.sort((left, right) => compareUtf8Bytes(left.kind, right.kind));
  const inputHash = await canonicalSha256({
    sourcePositionId: input.sourcePositionId,
    version: 1,
  });
  const checkpoint = canonicalJson({
    identity: {
      signals,
      sourcePosition: { id: input.sourcePositionId, positionKey: "direct" },
      state: "derived",
    },
    listingInputHash: materialHash,
  });
  await testEnv.DB.prepare(
    `INSERT INTO public_projection_position_items (
      id,run_id,listing_item_id,source_position_id,input_hash,stage,status,
      checkpoint_json,created_at,updated_at
    ) VALUES (?, ?, ?, ?, ?, 'canonical_resolution','queued',?, ?, ?)`
  )
    .bind(
      input.itemId,
      input.runId,
      `listing-item:${input.runId}:${input.listingId}`,
      input.sourcePositionId,
      inputHash,
      checkpoint,
      timestamp,
      timestamp
    )
    .run();
  return {
    inputHash,
    itemId: input.itemId,
    listingId: input.listingId,
    sourcePositionId: input.sourcePositionId,
  } satisfies PositionFixture;
}

async function finishD2(runId: string) {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: The helper proves the resumable D2 boundary reaches its seal.
    const result = await finalizeStableDuplicateComparisons(
      testEnv.DB,
      runId,
      timestamp
    );
    if (result.state === "complete") {
      const batch = await readDuplicateBatch(testEnv.DB, runId);
      if (batch) {
        return batch;
      }
    }
  }
  throw new Error(`D2 did not seal ${runId}`);
}

async function seedCanonicalResolution(input: {
  batchInputHash: string;
  canonicalSignalHash: string;
  position: PositionFixture;
  runId: string;
}) {
  const leaseToken = `lease:${input.runId}:${input.position.itemId}`;
  const resolutionGuard = `guard:${input.runId}:${input.position.itemId}`;
  const hashes = {
    content: await fixtureHash(`content:${input.position.sourcePositionId}`),
    matchFacts: await fixtureHash(`match:${input.position.sourcePositionId}`),
    position: await fixtureHash(`position:${input.position.sourcePositionId}`),
    positionPayload: await fixtureHash(
      `payload:${input.position.sourcePositionId}`
    ),
  };
  const listing = await testEnv.DB.prepare(
    "SELECT material_hash FROM job_listings WHERE id=?"
  )
    .bind(input.position.listingId)
    .first<{ material_hash: string }>();
  const current = await testEnv.DB.prepare(
    "SELECT checkpoint_json FROM public_projection_position_items WHERE id=?"
  )
    .bind(input.position.itemId)
    .first<{ checkpoint_json: string }>();
  if (!(listing && current)) {
    throw new Error("Missing canonical fixture inputs");
  }
  const checkpoint = {
    ...(JSON.parse(current.checkpoint_json) as Record<string, unknown>),
    analysisHashes: {
      content: hashes.content,
      matchFacts: hashes.matchFacts,
      position: hashes.position,
    },
    materialHash: listing.material_hash,
    materialVersion: 1,
    positionPayloadHash: hashes.positionPayload,
    resolutionGuard,
  };
  await testEnv.DB.prepare(
    `UPDATE public_projection_position_items
        SET status='processing',attempt_count=attempt_count+1,
            lease_owner='final-graph-test',lease_token=?,
            lease_expires_at='2099-01-01T00:00:00.000Z',
            checkpoint_json=?,started_at=?,updated_at=?
      WHERE id=? AND run_id=? AND status='queued'`
  )
    .bind(
      leaseToken,
      canonicalJson(checkpoint),
      timestamp,
      timestamp,
      input.position.itemId,
      input.runId
    )
    .run();
  await seedOrganization();
  const organizationResolutionId = `org-resolution:${input.position.itemId}`;
  const organizationResolutionHash = await fixtureHash(
    organizationResolutionId
  );
  const locationResolutionId = `location-resolution:${input.position.itemId}`;
  const locationResolutionHash = await fixtureHash(locationResolutionId);
  const locationSetHash = await fixtureHash(
    `location-set:${input.position.sourcePositionId}`
  );
  const signalPayloadHash = await fixtureHash(
    `signal-payload:${input.position.sourcePositionId}`
  );
  const resolutionSealHash = await fixtureHash(
    `resolution-seal:${input.position.sourcePositionId}`
  );
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO public_projection_organization_resolutions (
        id,run_id,position_item_id,source_position_id,position_input_hash,
        duplicate_batch_input_hash,listing_id,material_version,material_hash,
        content_analysis_hash,match_facts_analysis_hash,position_analysis_hash,
        position_payload_hash,normalized_company_name,asserted_country_code,
        resolved_locality,state,selected_organization_id,
        selected_display_name,resolver_version,reason_code,candidate_count,
        evidence_count,candidate_digest,evidence_digest,resolution_hash,
        claim_lease_token,resolution_guard_token,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'example school','GE','Tbilisi',
        'resolved','fixture-organization','Example School',
        'organization-resolver-v1','organization_name_country_locality',
        0,0,?,?,?,?,?,?)`
    ).bind(
      organizationResolutionId,
      input.runId,
      input.position.itemId,
      input.position.sourcePositionId,
      input.position.inputHash,
      input.batchInputHash,
      input.position.listingId,
      1,
      listing.material_hash,
      hashes.content,
      hashes.matchFacts,
      hashes.position,
      hashes.positionPayload,
      await fixtureHash(`org-candidates:${input.position.sourcePositionId}`),
      await fixtureHash(`org-evidence:${input.position.sourcePositionId}`),
      organizationResolutionHash,
      leaseToken,
      resolutionGuard,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_location_resolutions (
        id,run_id,position_item_id,ordinal,position_input_hash,literal_label,
        literal_evidence,normalized_label,semantic_kind,location_role,scope,
        workplace_type,asserted_country_code,state,reason_code,provider,
        selected_provider_place_id,proposed_canonical_location_id,display_name,
        country_code,region,locality,postal_code,latitude,longitude,bounds_json,
        feature_type,coordinate_kind,resolver_version,request_hash,response_hash,
        candidate_count,viable_candidate_count,candidate_digest,evidence_digest,
        resolution_hash,claim_lease_token,resolution_guard_token,queried_at,
        created_at
      ) VALUES (?, ?, ?, 0, ?, 'Tbilisi, Georgia','fixture','tbilisi georgia',
        'city','worksite','locality','onsite','GE','resolved',
        'location_exact_provider_match','mapbox-geocoding-v6',
        'place.tbilisi','cloc_fixture_tbilisi','Tbilisi, Georgia','GE','',
        'Tbilisi','',41.7151,44.8271,NULL,'place','centroid',
        'mapbox-location-resolver-v1-us',?,?,0,0,?,?,?,?,?,?,?)`
    ).bind(
      locationResolutionId,
      input.runId,
      input.position.itemId,
      input.position.inputHash,
      await fixtureHash(`map-request:${input.position.sourcePositionId}`),
      await fixtureHash(`map-response:${input.position.sourcePositionId}`),
      await fixtureHash(
        `location-candidates:${input.position.sourcePositionId}`
      ),
      await fixtureHash(`location-evidence:${input.position.sourcePositionId}`),
      locationResolutionHash,
      leaseToken,
      resolutionGuard,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_canonical_identity_signals (
        run_id,position_item_id,organization_resolution_id,
        organization_resolution_hash,location_set_hash,role_family,
        normalized_title,normalized_subjects_json,location_ids_json,state,
        signal_hash,signal_payload_hash,created_at
      ) VALUES (?,?,?,?,?,'english_language_teacher','english teacher','[]',?,
        'resolved',?,?,?)`
    ).bind(
      input.runId,
      input.position.itemId,
      organizationResolutionId,
      organizationResolutionHash,
      locationSetHash,
      canonicalJson(["cloc_fixture_tbilisi"]),
      input.canonicalSignalHash,
      signalPayloadHash,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_resolution_seals (
        run_id,position_item_id,source_position_id,position_input_hash,
        duplicate_batch_input_hash,organization_resolution_id,
        organization_resolution_hash,location_count,location_set_hash,
        canonical_signal_hash,state,reason_code,seal_hash,claim_lease_token,
        created_at
      ) VALUES (?,?,?,?,?,?,?,1,?,?,'resolved',
        'canonical_resolution_resolved',?,?,?)`
    ).bind(
      input.runId,
      input.position.itemId,
      input.position.sourcePositionId,
      input.position.inputHash,
      input.batchInputHash,
      organizationResolutionId,
      organizationResolutionHash,
      locationSetHash,
      input.canonicalSignalHash,
      resolutionSealHash,
      leaseToken,
      timestamp
    ),
  ]);
  await testEnv.DB.prepare(
    `UPDATE public_projection_position_items
        SET status='queued',lease_owner=NULL,lease_token=NULL,
            lease_expires_at=NULL,checkpoint_json=?,updated_at=?
      WHERE id=? AND run_id=? AND status='processing' AND lease_token=?`
  )
    .bind(
      canonicalJson({
        ...checkpoint,
        canonicalResolution: {
          canonicalSignalHash: input.canonicalSignalHash,
          locationCount: 1,
          locationSetHash,
          organizationResolutionHash,
          organizationResolutionId,
          reasonCode: "canonical_resolution_resolved",
          sealHash: resolutionSealHash,
          state: "resolved",
        },
      }),
      timestamp,
      input.position.itemId,
      input.runId,
      leaseToken
    )
    .run();
}

async function seedOrganization() {
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO organizations (
      id,country_code,country_name,name,identity_key,city,region,website_url,
      canonical_domain,market_segment,status,outreach_eligibility,evidence_url,
      created_at,updated_at
    ) VALUES ('fixture-organization','GE','Georgia','Example School',
      'example-school','Tbilisi','','https://example.test',
      'example.test','school','active','eligible','https://example.test',?,?)`
  )
    .bind(timestamp, timestamp)
    .run();
}

async function seedPublicRoot(input: {
  createdAt: string;
  id: string;
  published: boolean;
  publishedAt?: string;
  signalHash?: string;
}) {
  const routeListing = await testEnv.DB.prepare(
    "SELECT id FROM job_listings ORDER BY id LIMIT 1"
  ).first<{ id: string }>();
  if (!routeListing) {
    throw new Error("Missing route listing fixture");
  }
  const routeId = `route:${input.id}`;
  const statements = [
    testEnv.DB.prepare(
      `INSERT INTO application_routes (
        id,job_id,kind,destination,status,created_at,updated_at
      ) VALUES (?,?,'email',?,'active',?,?)`
    ).bind(
      routeId,
      routeListing.id,
      `${input.id}@example.test`,
      input.createdAt,
      input.createdAt
    ),
    testEnv.DB.prepare(
      "INSERT INTO public_jobs (id,created_at) VALUES (?,?)"
    ).bind(input.id, input.createdAt),
    testEnv.DB.prepare(
      "INSERT INTO public_job_aliases (public_job_id,slug,created_at) VALUES (?,?,?)"
    ).bind(input.id, input.id, input.createdAt),
    publicVersionStatement(input.id, input.createdAt),
    eligibilityDecisionStatement(input, routeId),
    testEnv.DB.prepare(
      `INSERT INTO public_job_heads (
        public_job_id,current_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(input.id, input.createdAt),
    testEnv.DB.prepare(
      `INSERT INTO public_job_eligibility_heads (
        public_job_id,current_decision_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(input.id, input.createdAt),
  ];
  if (input.signalHash) {
    statements.push(
      testEnv.DB.prepare(
        `INSERT INTO public_job_identity_signals (
          public_job_id,public_job_version,signal_kind,signal_hash,created_at
        ) VALUES (?,1,'canonical_identity_v1',?,?)`
      ).bind(input.id, input.signalHash, input.createdAt)
    );
  }
  await testEnv.DB.batch(statements);
}

function publicVersionStatement(publicJobId: string, createdAt: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_job_versions (
      public_job_id,version,predecessor_version,canonical_slug,title,
      organization_id,organization_name,organization_resolution_state,
      workplace_type,date_posted,date_posted_provenance,valid_through,
      valid_through_provenance,employment_types_json,compensation_json,
      description_html,public_content_hash,public_content_hash_version,
      material_changed_at,content_schema_version,producer_kind,producer_id,
      idempotency_key,created_at
    ) VALUES (?,1,NULL,?,'English Teacher',NULL,'Example School','unresolved',
      'unknown',NULL,'unknown',NULL,'unknown','[]','{}','Description',?,1,?,1,
      'deterministic','final-graph-test',?,?)`
  ).bind(
    publicJobId,
    publicJobId,
    publicJobId.padEnd(64, "0").slice(0, 64),
    createdAt,
    `content:${publicJobId}`,
    createdAt
  );
}

function eligibilityDecisionStatement(
  input: {
    createdAt: string;
    id: string;
    published: boolean;
    publishedAt?: string;
  },
  routeId: string
) {
  return testEnv.DB.prepare(
    `INSERT INTO public_job_eligibility_decisions (
      public_job_id,decision_version,predecessor_version,public_job_version,
      publication_state,route_disposition,browse_eligible,
      organic_index_eligible,job_posting_eligible,source_open_state,
      application_route_id,application_route_state,content_review_state,
      privacy_state,verified_at,redirect_public_job_id,reason_codes_json,
      decision_note,evaluator_kind,evaluator_version,decision_hash,
      idempotency_key,decided_at
    ) VALUES (?,1,NULL,1,?,?,?,?,?,?,?,?,?,?,?,?,
      '["fixture"]','fixture','migration','fixture',?,?,?)`
  ).bind(
    input.id,
    input.published ? "published" : "private",
    input.published ? "serve" : "private",
    input.published ? 1 : 0,
    input.published ? 1 : 0,
    input.published ? 1 : 0,
    input.published ? "open" : "unknown",
    input.published ? routeId : null,
    input.published ? "valid" : "unresolved",
    input.published ? "approved" : "unreviewed",
    input.published ? "passed" : "pending",
    input.published ? (input.publishedAt ?? input.createdAt) : null,
    null,
    input.id.padEnd(64, "1").slice(0, 64),
    `decision:${input.id}`,
    input.publishedAt ?? input.createdAt
  );
}

function seedSourceMapping(position: PositionFixture, publicJobId: string) {
  return seedSourceMappingState(position, {
    publicJobId,
    state: "mapped",
  });
}

function seedUnmappedSourceMapping(position: PositionFixture) {
  return seedSourceMappingState(position, {
    publicJobId: null,
    state: "unmapped",
  });
}

async function seedSourceMappingState(
  position: PositionFixture,
  input: { publicJobId: null | string; state: "mapped" | "unmapped" }
) {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_source_position_mapping_versions (
        source_position_id,version,predecessor_version,listing_id,
        listing_material_version,mapping_state,public_job_id,reason_code,
        mapping_hash,idempotency_key,created_at
      ) VALUES (?,1,NULL,?,1,?,?,'initial',?,?,?)`
    ).bind(
      position.sourcePositionId,
      position.listingId,
      input.state,
      input.publicJobId,
      await fixtureHash(`mapping:${position.sourcePositionId}`),
      `mapping:${position.sourcePositionId}`,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO job_source_position_mapping_heads (
        source_position_id,current_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(position.sourcePositionId, timestamp),
  ]);
}

async function advancePublicJobHead(publicJobId: string, signalHash: string) {
  const successorCreatedAt = "2026-07-22T12:00:01.000Z";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO public_job_versions (
        public_job_id,version,predecessor_version,canonical_slug,title,
        organization_id,organization_name,organization_resolution_state,
        workplace_type,date_posted,date_posted_provenance,valid_through,
        valid_through_provenance,employment_types_json,compensation_json,
        description_html,public_content_hash,public_content_hash_version,
        material_changed_at,content_schema_version,producer_kind,producer_id,
        idempotency_key,created_at
      )
      SELECT public_job_id,2,1,canonical_slug,title,organization_id,
             organization_name,organization_resolution_state,workplace_type,
             date_posted,date_posted_provenance,valid_through,
             valid_through_provenance,employment_types_json,compensation_json,
             description_html,public_content_hash,public_content_hash_version,
             ?,content_schema_version,producer_kind,producer_id,?,?
        FROM public_job_versions
       WHERE public_job_id=? AND version=1`
    ).bind(
      successorCreatedAt,
      `content:${publicJobId}:v2`,
      successorCreatedAt,
      publicJobId
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_job_identity_signals (
        public_job_id,public_job_version,signal_kind,signal_hash,created_at
      ) VALUES (?,2,'canonical_identity_v1',?,?)`
    ).bind(publicJobId, signalHash, successorCreatedAt),
    testEnv.DB.prepare(
      `UPDATE public_job_heads
          SET current_version=2,updated_at=?
        WHERE public_job_id=? AND current_version=1`
    ).bind(successorCreatedAt, publicJobId),
  ]);
}

function advanceSourceMappingHead(
  position: PositionFixture,
  publicJobId: string,
  reasonCode: "correction" | "split" = "correction"
) {
  return advanceSourceMappingState(position, {
    publicJobId,
    reasonCode,
    state: "mapped",
  });
}

function advanceUnmappedSourceMappingHead(
  position: PositionFixture,
  publicJobId: null | string = null
) {
  return advanceSourceMappingState(position, {
    publicJobId,
    reasonCode: publicJobId ? "correction" : "unmapped",
    state: publicJobId ? "mapped" : "unmapped",
  });
}

async function advanceSourceMappingState(
  position: PositionFixture,
  input: {
    publicJobId: null | string;
    reasonCode: string;
    state: "mapped" | "unmapped";
  }
) {
  const successorCreatedAt = "2026-07-22T12:00:01.000Z";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_source_position_mapping_versions (
        source_position_id,version,predecessor_version,listing_id,
        listing_material_version,mapping_state,public_job_id,reason_code,
        mapping_hash,idempotency_key,created_at
      ) VALUES (?,2,1,?,1,?,?,?,?,?,?)`
    ).bind(
      position.sourcePositionId,
      position.listingId,
      input.state,
      input.publicJobId,
      input.reasonCode,
      await fixtureHash(`mapping-v2:${position.sourcePositionId}`),
      `mapping-v2:${position.sourcePositionId}`,
      successorCreatedAt
    ),
    testEnv.DB.prepare(
      `UPDATE job_source_position_mapping_heads
          SET current_version=2,updated_at=?
        WHERE source_position_id=? AND current_version=1`
    ).bind(successorCreatedAt, position.sourcePositionId),
  ]);
}

function beforeFirstBatch(db: D1Database, hook: () => Promise<void>) {
  let pending = true;
  return new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (pending) {
            pending = false;
            await hook();
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;
}

function countingDatabase(db: D1Database) {
  let count = 0;
  return {
    db: new Proxy(db, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            count += 1;
            return target.prepare(query);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database,
    prepareCount: () => count,
  };
}

function syntheticMemberKey(index: number) {
  return `synthetic-member-${index.toString().padStart(6, "0")}`;
}

function syntheticPositionItemId(index: number) {
  return `synthetic-position-${index.toString().padStart(6, "0")}`;
}

async function seedFinalWorkPublicMember(input: {
  publicMemberKey: string;
  runId: string;
  signalHash: string;
}) {
  const publicJobId = "live-query-plan-root";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO public_projection_final_work_public_roots (
        run_id,ordinal,originating_public_job_id,redirect_root_id,
        public_member_key,redirect_path_json,public_job_version,
        eligibility_decision_version,public_job_created_at,served_publicly,
        first_published_at,founding_source_position_id,allocation_hash,
        content_head_hash,redirect_path_hash,history_hash,
        allocation_input_hash,row_hash,encoded_bytes,created_at
      ) VALUES (?,0,?,?,?, ?,1,1,?,0,NULL,NULL,NULL,?,?,?,?,?,2,?)`
    ).bind(
      input.runId,
      publicJobId,
      publicJobId,
      input.publicMemberKey,
      canonicalJson([publicJobId]),
      timestamp,
      "1".repeat(64),
      "2".repeat(64),
      "3".repeat(64),
      "4".repeat(64),
      "5".repeat(64),
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_final_work_canonical_members (
        run_id,public_member_key,signal_hash,created_at
      ) VALUES (?,?,?,?)`
    ).bind(input.runId, input.publicMemberKey, input.signalHash, timestamp),
  ]);
}

async function insertSyntheticSameRelations(input: {
  count: number;
  memberKey: string;
  runId: string;
  start: number;
}) {
  const statement = (side: "left" | "right") => {
    const neighbor = `${side === "left" ? "z" : "a"}-frontier-`;
    const left = side === "left" ? "?" : `printf('${neighbor}%06d',value)`;
    const right = side === "left" ? `printf('${neighbor}%06d',value)` : "?";
    return testEnv.DB.prepare(
      `WITH RECURSIVE sequence(value) AS (
         SELECT ? UNION ALL SELECT value+1 FROM sequence WHERE value+1<?
       )
       INSERT INTO public_projection_final_work_relations (
         run_id,ordinal,id,left_member_key,right_member_key,payload_json,
         operator_decision_id,operator_decision_hash,operator_terminal,
         relation,relation_hash,encoded_bytes,created_at
       )
       SELECT ?,value*2+${side === "left" ? 0 : 1},
              printf('relation-${side}-%06d',value),${left},${right},'{}',
              NULL,NULL,1,'same',printf('%064x',value+${
                side === "left" ? 400_000 : 500_000
              }),2,?
         FROM sequence`
    ).bind(
      input.start,
      input.start + input.count,
      input.runId,
      input.memberKey,
      timestamp
    );
  };
  await testEnv.DB.batch([statement("left"), statement("right")]);
}

async function insertSyntheticResolvedCohort(input: {
  count: number;
  runId: string;
  signalHash: string;
  start: number;
}) {
  await testEnv.DB.prepare(
    `WITH RECURSIVE sequence(value) AS (
       SELECT ?
       UNION ALL
       SELECT value+1 FROM sequence WHERE value+1<?
     )
     INSERT INTO public_projection_final_work_resolution_inputs (
       run_id,ordinal,position_item_id,source_position_id,input_hash,
       checkpoint_json,resolution_state,resolution_reason_code,
       resolution_seal_hash,canonical_signal_hash,member_key,member_hash,
       row_hash,encoded_bytes,created_at
     )
     SELECT ?,value,
            printf('synthetic-position-%06d',value),
            printf('synthetic-source-%06d',value),
            printf('%064x',value+1),'{}','resolved','synthetic',
            printf('%064x',value+100001),?,
            printf('synthetic-member-%06d',value),
            printf('%064x',value+200001),
            printf('%064x',value+300001),2,?
       FROM sequence`
  )
    .bind(
      input.start,
      input.start + input.count,
      input.runId,
      input.signalHash,
      timestamp
    )
    .run();
}

function commitThenLoseFirstBatch(db: D1Database) {
  let pending = true;
  return new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          if (pending) {
            pending = false;
            throw new Error("simulated committed response loss");
          }
          return result;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;
}

function seedSameOperatorDecision(first: string, second: string) {
  return seedOperatorDecision(first, second, "same");
}

async function ensureFixtureOperator() {
  await testEnv.DB.prepare(
    `INSERT OR IGNORE INTO users (
      id,name,email,email_verified,created_at,updated_at,role
    ) VALUES ('fixture-operator','Fixture Operator','operator@example.test',
      1,?,?, 'operator')`
  )
    .bind(timestamp, timestamp)
    .run();
}

async function insertOperatorDecision(input: {
  decision: "deferred" | "different" | "same";
  left: string;
  right: string;
  supersedesDecisionId: null | string;
}) {
  let reasonCode = "operator_deferred";
  if (input.decision === "same") {
    reasonCode = "operator_confirmed_same";
  } else if (input.decision === "different") {
    reasonCode = "operator_confirmed_different";
  }
  const identity = `${input.decision}:${input.left}:${input.right}:${input.supersedesDecisionId ?? "first"}`;
  const decisionId = `pfdec_v1_${await fixtureHash(`id:${identity}`)}`;
  await testEnv.DB.prepare(
    `INSERT INTO public_projection_duplicate_operator_decisions (
      id,left_member_key,right_member_key,decision,reason_code,evidence_hash,
      supersedes_decision_id,operator_user_id,decided_at,decision_hash,
      created_at
    ) VALUES (?,?,?,?,?,?,?,'fixture-operator',?,?,?)`
  )
    .bind(
      decisionId,
      input.left,
      input.right,
      input.decision,
      reasonCode,
      await fixtureHash(`evidence:${identity}`),
      input.supersedesDecisionId,
      timestamp,
      await fixtureHash(`decision:${identity}`),
      timestamp
    )
    .run();
  return decisionId;
}

async function seedOperatorDecision(
  first: string,
  second: string,
  decision: "different" | "same"
) {
  const [left, right] =
    compareUtf8Bytes(first, second) <= 0 ? [first, second] : [second, first];
  const reasonCode =
    decision === "same"
      ? "operator_confirmed_same"
      : "operator_confirmed_different";
  const evidenceHash = await fixtureHash(
    `operator-evidence:${decision}:${left}:${right}`
  );
  const decisionHash = await fixtureHash(
    `operator-decision:${decision}:${left}:${right}`
  );
  const decisionId = `pfdec_v1_${await fixtureHash(
    `id:${decision}:${left}:${right}`
  )}`;
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO users (
        id,name,email,email_verified,created_at,updated_at,role
      ) VALUES ('fixture-operator','Fixture Operator','operator@example.test',
        1,?,?, 'operator')`
    ).bind(timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_projection_duplicate_operator_decisions (
        id,left_member_key,right_member_key,decision,reason_code,evidence_hash,
        supersedes_decision_id,operator_user_id,decided_at,decision_hash,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?,NULL,'fixture-operator',?,?,?)`
    ).bind(
      decisionId,
      left,
      right,
      decision,
      reasonCode,
      evidenceHash,
      timestamp,
      decisionHash,
      timestamp
    ),
  ]);
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

function fixtureHash(value: string) {
  return canonicalSha256({ value });
}

async function finalArtifacts(runId: string) {
  const [components, relations] = await Promise.all([
    testEnv.DB.prepare(
      `SELECT * FROM public_projection_allocation_components
        WHERE run_id=? ORDER BY id`
    )
      .bind(runId)
      .all<Record<string, unknown>>(),
    testEnv.DB.prepare(
      `SELECT * FROM public_projection_final_duplicate_relations
        WHERE run_id=? ORDER BY id`
    )
      .bind(runId)
      .all<Record<string, unknown>>(),
  ]);
  return { components: components.results, relations: relations.results };
}

function allocationRoots(runId: string) {
  return testEnv.DB.prepare(
    `SELECT * FROM public_projection_allocation_roots
      WHERE run_id=? ORDER BY public_job_id`
  )
    .bind(runId)
    .all<Record<string, unknown>>()
    .then((result) => result.results);
}

function positionStages(runId: string) {
  return testEnv.DB.prepare(
    `SELECT stage,status FROM public_projection_position_items
      WHERE run_id=? ORDER BY source_position_id`
  )
    .bind(runId)
    .all<{ stage: string; status: string }>()
    .then((result) => result.results);
}

function appendSealedAllocationMember(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_allocation_members (
      run_id,allocation_id,ordinal,member_key,member_kind,position_item_id,
      source_position_id,input_hash,public_job_id,public_job_version,
      eligibility_decision_version,member_hash,created_at
    )
    SELECT run_id,allocation_id,99,member_key,member_kind,position_item_id,
           source_position_id,input_hash,public_job_id,public_job_version,
           eligibility_decision_version,member_hash,created_at
      FROM public_projection_allocation_members
     WHERE run_id=? ORDER BY allocation_id,ordinal LIMIT 1`
  )
    .bind(runId)
    .run();
}

function appendSealedAllocationRelation(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_allocation_relations (
      run_id,allocation_id,ordinal,relation_id,relation_hash,created_at
    )
    SELECT run_id,allocation_id,99,relation_id,relation_hash,created_at
      FROM public_projection_allocation_relations
     WHERE run_id=? ORDER BY allocation_id,ordinal LIMIT 1`
  )
    .bind(runId)
    .run();
}

function appendSealedAllocationRoot(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_allocation_roots (
      run_id,allocation_id,ordinal,member_key,public_job_id,
      public_job_version,eligibility_decision_version,served_publicly,
      first_published_at,public_job_created_at,founding_source_position_id,
      selected,reason_code,root_hash,created_at
    )
    SELECT run_id,allocation_id,99,member_key,public_job_id,
           public_job_version,eligibility_decision_version,served_publicly,
           first_published_at,public_job_created_at,founding_source_position_id,
           selected,reason_code,root_hash,created_at
      FROM public_projection_allocation_roots
     WHERE run_id=? ORDER BY allocation_id,ordinal LIMIT 1`
  )
    .bind(runId)
    .run();
}

function appendSealedFinalRelation(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_final_duplicate_relations
     SELECT * FROM public_projection_final_duplicate_relations
      WHERE run_id=? ORDER BY id LIMIT 1`
  )
    .bind(runId)
    .run();
}

function appendSealedComponent(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_allocation_components
     SELECT * FROM public_projection_allocation_components
      WHERE run_id=? ORDER BY id LIMIT 1`
  )
    .bind(runId)
    .run();
}

function appendSealedCanonicalInput(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_final_canonical_live_inputs
     SELECT * FROM public_projection_final_canonical_live_inputs
      WHERE run_id=? ORDER BY public_job_id LIMIT 1`
  )
    .bind(runId)
    .run();
}

function appendSealedMappingInput(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_final_source_mapping_inputs
     SELECT * FROM public_projection_final_source_mapping_inputs
      WHERE run_id=? ORDER BY source_position_id LIMIT 1`
  )
    .bind(runId)
    .run();
}

function appendSealedFinalSeal(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_final_duplicate_seals
     SELECT * FROM public_projection_final_duplicate_seals WHERE run_id=?`
  )
    .bind(runId)
    .run();
}

async function runLifecycle(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT run.status run_status,
            (SELECT COUNT(*)
               FROM public_projection_final_duplicate_seals final_seal
              WHERE final_seal.run_id=run.id) final_seal_count
       FROM public_projection_runs run
      WHERE run.id=?`
  )
    .bind(runId)
    .first<{ final_seal_count: number; run_status: string }>();
  if (!row) {
    throw new Error(`Missing run lifecycle fixture ${runId}`);
  }
  return {
    finalSealCount: row.final_seal_count,
    runStatus: row.run_status,
  };
}

async function runState(runId: string) {
  const row = await testEnv.DB.prepare(
    "SELECT status,error_code FROM public_projection_runs WHERE id=?"
  )
    .bind(runId)
    .first<{ error_code: string; status: string }>();
  if (!row) {
    throw new Error(`Missing run state fixture ${runId}`);
  }
  return { errorCode: row.error_code, status: row.status };
}

function stableComponents(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({
    allocationHash: row.allocation_hash,
    foundingSourcePositionId: row.founding_source_position_id,
    id: row.id,
    proposedPublicJobId: row.proposed_public_job_id,
    reasonCode: row.reason_code,
    state: row.state,
    winningPublicJobId: row.winning_public_job_id,
  }));
}

function stableRelations(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({
    id: row.id,
    leftMemberKey: row.left_member_key,
    reasonCode: row.reason_code,
    relation: row.relation,
    relationHash: row.relation_hash,
    rightMemberKey: row.right_member_key,
  }));
}

async function liveGraphCounts() {
  const row = await testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM public_jobs) jobs,
      (SELECT COUNT(*) FROM public_job_versions) versions,
      (SELECT COUNT(*) FROM public_job_heads) heads,
      (SELECT COUNT(*) FROM public_job_allocations) allocations,
      (SELECT COUNT(*) FROM job_source_position_mapping_versions) mappings,
      (SELECT COUNT(*) FROM public_job_eligibility_decisions) decisions,
      (SELECT COUNT(*) FROM public_job_identity_signals) signals`
  ).first<Record<string, number>>();
  return row;
}

async function liveGraphCountsExcludingMappings() {
  const row = await liveGraphCounts();
  if (!row) {
    throw new Error("Missing live graph count snapshot");
  }
  const { mappings: _intentionalMappingMutation, ...publicationCounts } = row;
  return publicationCounts;
}

async function liveGraphSnapshot() {
  const [
    jobs,
    aliases,
    versions,
    heads,
    versionLocations,
    decisions,
    decisionHeads,
    decisionSources,
    signals,
    mappingVersions,
    mappingHeads,
    allocations,
    catalogVersions,
    catalogHead,
    catalogSeals,
    catalogHistory,
    catalogMembers,
    searchIndex,
    searchTerms,
    browseLocations,
    outbox,
  ] = await Promise.all([
    testEnv.DB.prepare("SELECT * FROM public_jobs ORDER BY id").all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_aliases ORDER BY public_job_id,slug"
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_versions ORDER BY public_job_id,version"
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_heads ORDER BY public_job_id"
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_version_locations
        ORDER BY public_job_id,public_job_version,ordinal`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_eligibility_decisions
        ORDER BY public_job_id,decision_version`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_eligibility_heads
        ORDER BY public_job_id`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_decision_sources
        ORDER BY public_job_id,decision_version,source_position_id,
                 source_mapping_version`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_identity_signals
        ORDER BY public_job_id,public_job_version,signal_kind,signal_hash`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM job_source_position_mapping_versions
        ORDER BY source_position_id,version`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM job_source_position_mapping_heads
        ORDER BY source_position_id`
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_allocations ORDER BY public_job_id"
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_catalog_versions ORDER BY version"
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_catalog_head_pointer ORDER BY singleton"
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_catalog_seals ORDER BY catalog_version"
    ).all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_job_catalog_head_history ORDER BY catalog_version"
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_catalog_members
        ORDER BY catalog_version,public_job_id`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_search_index
        ORDER BY public_job_id,public_job_version,search_index_version`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_job_search_terms
        ORDER BY search_index_version,public_job_id,public_job_version,term`
    ).all(),
    testEnv.DB.prepare(
      `SELECT * FROM public_browse_job_locations
        ORDER BY catalog_version,public_job_id,public_job_version,ordinal`
    ).all(),
    testEnv.DB.prepare("SELECT * FROM work_outbox ORDER BY id").all(),
  ]);
  return canonicalJson({
    aliases: aliases.results,
    allocations: allocations.results,
    browseLocations: browseLocations.results,
    catalogHead: catalogHead.results,
    catalogHistory: catalogHistory.results,
    catalogMembers: catalogMembers.results,
    catalogSeals: catalogSeals.results,
    catalogVersions: catalogVersions.results,
    decisionHeads: decisionHeads.results,
    decisionSources: decisionSources.results,
    decisions: decisions.results,
    heads: heads.results,
    jobs: jobs.results,
    mappingHeads: mappingHeads.results,
    mappingVersions: mappingVersions.results,
    outbox: outbox.results,
    searchIndex: searchIndex.results,
    searchTerms: searchTerms.results,
    signals: signals.results,
    versionLocations: versionLocations.results,
    versions: versions.results,
  });
}

async function finalGraphCounts(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM public_projection_allocation_components
        WHERE run_id=?) components,
      (SELECT COUNT(*) FROM public_projection_allocation_members
        WHERE run_id=?) members,
      (SELECT COUNT(*) FROM public_projection_allocation_roots
        WHERE run_id=?) roots,
      (SELECT COUNT(*) FROM public_projection_allocation_relations
        WHERE run_id=?) allocations,
      (SELECT COUNT(*) FROM public_projection_final_duplicate_relations
        WHERE run_id=?) relations,
      (SELECT COUNT(*) FROM public_projection_final_canonical_live_inputs
        WHERE run_id=?) canonical_inputs,
      (SELECT COUNT(*) FROM public_projection_final_source_mapping_inputs
        WHERE run_id=?) mapping_inputs,
      (SELECT COUNT(*) FROM public_projection_final_duplicate_seals
        WHERE run_id=?) seals`
  )
    .bind(runId, runId, runId, runId, runId, runId, runId, runId)
    .first<{
      allocations: number;
      canonical_inputs: number;
      components: number;
      mapping_inputs: number;
      members: number;
      relations: number;
      roots: number;
      seals: number;
    }>();
  if (!row) {
    throw new Error(`Missing final graph count fixture ${runId}`);
  }
  return {
    allocations: row.allocations,
    canonicalInputs: row.canonical_inputs,
    components: row.components,
    mappingInputs: row.mapping_inputs,
    members: row.members,
    relations: row.relations,
    roots: row.roots,
    seals: row.seals,
  };
}

async function finishFinalGraph(
  db: D1Database,
  runId: string,
  frozenAt: string
) {
  for (let invocation = 0; invocation < 512; invocation += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: This helper deliberately drives one durable D3 page per invocation.
    const result = await finalizeCanonicalDuplicateGraph(db, runId, frozenAt);
    if (result.state === "complete") {
      return result;
    }
  }
  throw new Error(`Durable D3 did not finish ${runId}`);
}

async function advanceFinalGraphToReady(
  db: D1Database,
  runId: string,
  frozenAt: string,
  remainingInvocations = 512
) {
  if (remainingInvocations <= 0) {
    throw new Error(`Durable D3 did not reach ready ${runId}`);
  }
  const work = await db
    .prepare(
      `SELECT phase,status FROM public_projection_final_work
        WHERE run_id=? LIMIT 1`
    )
    .bind(runId)
    .first<{ phase: string; status: string }>();
  if (work?.phase === "ready" && work.status === "queued") {
    return;
  }
  const result = await finalizeCanonicalDuplicateGraph(db, runId, frozenAt);
  if (result.state === "complete") {
    throw new Error(`Durable D3 sealed before the ready checkpoint ${runId}`);
  }
  return advanceFinalGraphToReady(
    db,
    runId,
    frozenAt,
    remainingInvocations - 1
  );
}

async function advanceFinalGraphToComponentState(
  runId: string,
  state: "relations" | "sealed"
) {
  for (let invocation = 0; invocation < 512; invocation += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: This helper stops at an exact durable component checkpoint.
    const component = await componentWorkSnapshot(runId);
    if (component?.state === state) {
      return component;
    }
    const result = await finalizeCanonicalDuplicateGraph(
      testEnv.DB,
      runId,
      timestamp
    );
    if (result.state === "complete") {
      throw new Error(`D3 sealed before component state ${state} for ${runId}`);
    }
  }
  throw new Error(`D3 did not reach component state ${state} for ${runId}`);
}

function componentWorkSnapshot(runId: string) {
  return testEnv.DB.prepare(
    `SELECT seed_member_key,state,child_cursor,member_count,relation_count,
            root_count,member_digest,member_last_cursor,relation_digest,
            relation_last_cursor,root_digest,root_last_cursor,
            root_expected_count,root_summary_ready,update_last_cursor,
            allocation_id,allocation_hash,artifact_hash,
            founding_source_position_id,proposed_public_job_id,
            winning_public_job_id,losing_root_count,allocation_state,
            reason_code,encoded_bytes
       FROM public_projection_final_component_work
      WHERE run_id=? ORDER BY seed_member_key LIMIT 1`
  )
    .bind(runId)
    .first<Record<string, null | number | string>>();
}

function makeHostileRelations(
  leftMember: Record<string, unknown>,
  count: number
) {
  return Array.from({ length: count }, (_, index) => {
    const suffix = index.toString().padStart(4, "0");
    return {
      conflictingSignals: [],
      d2ComparisonId: null,
      id: `hostile-relation-${suffix}`,
      left: leftMember,
      matchingSignals: [],
      operatorDecisionId: null,
      padding: "x".repeat(8192),
      reasonCode: "canonical_signal_mismatch",
      relation: "different" as const,
      relationHash: (index + 1).toString(16).padStart(64, "0"),
      right: {
        eligibilityDecisionVersion: 1,
        kind: "public" as const,
        memberHash: (index + 1001).toString(16).padStart(64, "0"),
        memberKey: `zz-hostile-public-${suffix}`,
        publicJobId: `hostile-public-${suffix}`,
        publicJobVersion: 1,
      },
    };
  });
}

async function insertHostileWorkRelations(input: {
  relations: ReturnType<typeof makeHostileRelations>;
  runId: string;
}) {
  for (let offset = 0; offset < input.relations.length; offset += 24) {
    const statements = input.relations
      .slice(offset, offset + 24)
      .map((relation, pageIndex) => {
        const payloadJson = canonicalJson(relation);
        return testEnv.DB.prepare(
          `INSERT INTO public_projection_final_work_relations (
            run_id,ordinal,id,left_member_key,right_member_key,payload_json,
            operator_decision_id,operator_decision_hash,operator_terminal,
            relation,relation_hash,encoded_bytes,created_at
          ) VALUES (?,?,?,?,?,?,NULL,NULL,1,'different',?,?,?)`
        ).bind(
          input.runId,
          offset + pageIndex,
          relation.id,
          String(relation.left.memberKey),
          relation.right.memberKey,
          payloadJson,
          relation.relationHash,
          new TextEncoder().encode(payloadJson).byteLength,
          timestamp
        );
      });
    // biome-ignore lint/performance/noAwaitInLoops: The hostile fixture itself obeys the 24-row durable page boundary.
    await testEnv.DB.batch(statements);
  }
}

async function reductionDigestByPageSize(
  domain: string,
  records: unknown[],
  pageSize: number
) {
  let digest = await canonicalSha256({ domain, state: "empty" });
  for (let offset = 0; offset < records.length; offset += pageSize) {
    for (const record of records.slice(offset, offset + pageSize)) {
      // biome-ignore lint/performance/noAwaitInLoops: The test independently reproduces the specified row-wise fold.
      digest = await canonicalSha256({
        domain,
        previousDigest: digest,
        record,
      });
    }
  }
  return digest;
}

function componentArtifactBounds(runId: string) {
  return testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*)
         FROM pragma_table_info('public_projection_final_component_work')
        WHERE name='component_json') component_json_columns,
      (SELECT COUNT(*)
         FROM public_projection_final_work_component_relations
        WHERE run_id=?) component_relation_count,
      (SELECT MAX(encoded_bytes) FROM (
         SELECT encoded_bytes FROM public_projection_final_work_component_members
          WHERE run_id=?
         UNION ALL
         SELECT encoded_bytes FROM public_projection_final_work_component_roots
          WHERE run_id=?
         UNION ALL
         SELECT encoded_bytes FROM public_projection_final_work_component_relations
          WHERE run_id=?
         UNION ALL
         SELECT encoded_bytes FROM public_projection_final_work_position_updates
          WHERE run_id=?
      )) max_child_bytes,
      (SELECT MAX(encoded_bytes)
         FROM public_projection_final_work_relations
        WHERE run_id=?) max_work_relation_bytes`
  )
    .bind(runId, runId, runId, runId, runId, runId)
    .first<{
      component_json_columns: number;
      component_relation_count: number;
      max_child_bytes: number;
      max_work_relation_bytes: number;
    }>();
}
