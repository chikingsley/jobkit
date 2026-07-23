import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  claimFinalWork,
  commitFinalWorkPage,
  readFinalWork,
} from "../../../../worker/repositories/public-projection-final-work/controller";
import {
  finalizeCanonicalDuplicateGraph,
  finalShadowMemberKey,
} from "../../../../worker/services/public-projection/final-graph";
import { fixtureHash } from "./support/fixtures";
import { advanceFinalGraphToReady } from "./support/lifecycle";
import { testEnv, timestamp } from "./support/model";
import { seedResolvedRun } from "./support/seed-runs";
import { finalGraphCounts } from "./support/snapshots";
import {
  beforeFirstBatch,
  commitThenLoseFirstBatch,
  seedSameOperatorDecision,
} from "./support/synthetic";

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public projection final duplicate graph", () => {
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
