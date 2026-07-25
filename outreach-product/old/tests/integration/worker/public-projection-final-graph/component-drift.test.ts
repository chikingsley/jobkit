import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { finalizeCanonicalDuplicateGraph } from "../../../../worker/services/public-projection/final-graph";
import { canonicalJson } from "../../../../worker/services/public-projection/hash";
import {
  fixtureHash,
  liveGraphCountsExcludingMappings,
  positionStages,
} from "./support/fixtures";
import {
  advanceFinalGraphToComponentState,
  advanceFinalGraphToReady,
  componentArtifactBounds,
  componentWorkSnapshot,
  insertHostileWorkRelations,
  makeHostileRelations,
  reductionDigestByPageSize,
} from "./support/lifecycle";
import { type PositionFixture, testEnv, timestamp } from "./support/model";
import {
  advancePublicJobHead,
  advanceSourceMappingHead,
  advanceUnmappedSourceMappingHead,
  seedPublicRoot,
  seedSourceMapping,
  seedUnmappedSourceMapping,
} from "./support/seed-public";
import { seedResolvedRun } from "./support/seed-runs";
import { finalGraphCounts } from "./support/snapshots";
import {
  beforeFirstBatch,
  commitThenLoseFirstBatch,
} from "./support/synthetic";

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public projection final duplicate graph", () => {
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
});
