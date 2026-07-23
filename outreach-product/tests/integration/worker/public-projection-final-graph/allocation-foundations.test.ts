import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deterministicPublicJobId,
  finalizeCanonicalDuplicateGraph,
  finalPublicMemberKey,
  finalShadowMemberKey,
} from "../../../../worker/services/public-projection/final-graph";
import {
  allocationRoots,
  appendSealedAllocationMember,
  appendSealedAllocationRelation,
  appendSealedAllocationRoot,
  appendSealedCanonicalInput,
  appendSealedComponent,
  appendSealedFinalRelation,
  appendSealedFinalSeal,
  appendSealedMappingInput,
  finalArtifacts,
  fixtureHash,
  positionStages,
  runLifecycle,
  stableComponents,
  stableRelations,
} from "./support/fixtures";
import { finishFinalGraph } from "./support/lifecycle";
import { testEnv, timestamp } from "./support/model";
import { seedPublicRoot, seedSourceMapping } from "./support/seed-public";
import { seedResolvedRun } from "./support/seed-runs";
import { liveGraphSnapshot } from "./support/snapshots";
import {
  ensureFixtureOperator,
  insertOperatorDecision,
  seedOperatorDecision,
  seedSameOperatorDecision,
} from "./support/synthetic";

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
});
