import { beforeEach, describe, expect, it } from "vitest";
import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import { processProjectionCanonicalResolutionClaim } from "../../../../worker/services/public-projection/canonical-resolution";
import { processProjectionIdentityClaim } from "../../../../worker/services/public-projection/identity";
import type { PermanentLocationResolver } from "../../../../worker/services/public-projection/mapbox-location-resolver";
import { claimProjectionPosition } from "../../../../worker/services/public-projection/position-items";
import { createAuthenticatedUser } from ".././auth";
import {
  directAnalysis,
  manyLocationAnalysis,
  sameLabelRoleAndScopeAnalysis,
} from "./support/analyses";
import {
  advanceUntilFinalDuplicateComplete,
  mapboxCityFixture,
  mapboxTbilisiFixture,
  permanentFixtureResponse,
} from "./support/mapbox";
import {
  futureTimestamp,
  resetPrerequisiteDb,
  SHA256_HEX_PATTERN,
  testEnv,
} from "./support/model";
import { positionItem, runStatus } from "./support/queries";
import {
  advanceRunThroughExpansion,
  countingD1Database,
  createRun,
} from "./support/runner";
import { seedAnalyses, seedListing } from "./support/seeding";
import {
  advanceListingMaterial,
  canonicalResolutionClaim,
  seedOrganizationForCity,
  seedResolvableOrganization,
} from "./support/state";

beforeEach(resetPrerequisiteDb);

describe("projection prerequisites, source positions, and identity", () => {
  it("orders location roles and scopes by contract independent of source order", async () => {
    const firstListing = await seedListing("phase-d3-location-order-first");
    const secondListing = await seedListing("phase-d3-location-order-second");
    const analysis = sameLabelRoleAndScopeAnalysis();
    await seedAnalyses(firstListing, analysis);
    await seedAnalyses(secondListing, {
      ...analysis,
      positions: analysis.positions.map((value) => ({
        ...value,
        locations: [...value.locations].reverse(),
      })),
    });
    await seedResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "phase-d3-location-order@example.test"
    );
    const firstClaim = await canonicalResolutionClaim(
      firstListing,
      operator.cookie
    );
    const secondClaim = await canonicalResolutionClaim(
      secondListing,
      operator.cookie
    );
    const resolver: PermanentLocationResolver = {
      resolve(query) {
        return Promise.resolve(
          permanentFixtureResponse(mapboxTbilisiFixture(), query.literalLabel)
        );
      },
    };

    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      firstClaim.claim,
      futureTimestamp,
      resolver
    );
    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      secondClaim.claim,
      futureTimestamp,
      resolver
    );
    const orderedLocations = async (runId: string) =>
      (
        await testEnv.DB.prepare(
          `SELECT ordinal,literal_label,location_role,scope,workplace_type,
                  selected_provider_place_id,resolution_hash
             FROM public_projection_location_resolutions
            WHERE run_id=? ORDER BY ordinal`
        )
          .bind(runId)
          .all<{
            literal_label: string;
            location_role: string;
            ordinal: number;
            resolution_hash: string;
            scope: string;
            selected_provider_place_id: string;
            workplace_type: string;
          }>()
      ).results;
    const first = await orderedLocations(firstClaim.runId);
    const second = await orderedLocations(secondClaim.runId);
    expect(
      first.map(({ resolution_hash: _hash, ...location }) => location)
    ).toEqual(
      second.map(({ resolution_hash: _hash, ...location }) => location)
    );
    expect(
      first.map(({ location_role, ordinal, scope }) => ({
        location_role,
        ordinal,
        scope,
      }))
    ).toEqual([
      { location_role: "worksite", ordinal: 0, scope: "locality" },
      { location_role: "worksite", ordinal: 1, scope: "region" },
      { location_role: "applicant_area", ordinal: 2, scope: "region" },
    ]);
    expect(first.map((location) => location.resolution_hash)).toEqual([
      expect.stringMatching(SHA256_HEX_PATTERN),
      expect.stringMatching(SHA256_HEX_PATTERN),
      expect.stringMatching(SHA256_HEX_PATTERN),
    ]);
    expect(second.map((location) => location.resolution_hash)).toEqual([
      expect.stringMatching(SHA256_HEX_PATTERN),
      expect.stringMatching(SHA256_HEX_PATTERN),
      expect.stringMatching(SHA256_HEX_PATTERN),
    ]);
  });

  it("persists large provider evidence in bounded D1 pages", async () => {
    const listing = await seedListing("phase-d3-paged-provider-evidence");
    await seedAnalyses(listing, manyLocationAnalysis());
    await seedOrganizationForCity("City 0");
    const operator = await createAuthenticatedUser(
      "phase-d3-paged-provider-evidence@example.test"
    );
    const { claim, runId } = await canonicalResolutionClaim(
      listing,
      operator.cookie
    );
    const resolver: PermanentLocationResolver = {
      resolve(query) {
        return Promise.resolve(
          permanentFixtureResponse(
            mapboxCityFixture(query.literalLabel, "x".repeat(125_000)),
            query.literalLabel
          )
        );
      },
    };
    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        resolver
      )
    ).resolves.toMatchObject({ resolved: 1, sealed: 1 });
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count
           FROM public_projection_location_provider_evidence WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({ count: 10 });
  });

  it("fences exact position claims after their lease expires", async () => {
    const listing = await seedListing("phase-d1-position-lease-fence");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d1-position-lease-fence@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();
    const claim = await claimProjectionPosition(
      testEnv.DB,
      runId,
      "identity",
      futureTimestamp
    );
    expect(claim).toMatchObject({ attemptCount: 1, runId, stage: "identity" });
    await expect(
      claimProjectionPosition(testEnv.DB, runId, "identity", futureTimestamp)
    ).resolves.toBeNull();
    if (!claim) {
      throw new Error("Expected an exact position claim fixture");
    }
    await testEnv.DB.prepare(
      `UPDATE public_projection_position_items
          SET lease_expires_at='2000-01-01T00:00:00.000Z'
        WHERE id=?`
    )
      .bind(claim.id)
      .run();

    await expect(
      processProjectionIdentityClaim(testEnv.DB, claim, futureTimestamp)
    ).rejects.toThrow("Projection position lease changed during processing");
    expect(await positionItem(runId)).toMatchObject({
      attempt_count: 1,
      stage: "identity",
      status: "processing",
    });
  });

  it("fails an expired position lease at its exact retry ceiling", async () => {
    const listing = await seedListing("phase-d1-position-attempt-ceiling");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d1-position-attempt-ceiling@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: Lease attempts must advance sequentially.
      const claim = await claimProjectionPosition(
        testEnv.DB,
        runId,
        "identity",
        futureTimestamp
      );
      expect(claim?.attemptCount).toBe(attempt);
      if (attempt < 3 && claim) {
        await testEnv.DB.prepare(
          `UPDATE public_projection_position_items
              SET status='queued',lease_owner=NULL,lease_token=NULL,
                  lease_expires_at=NULL,updated_at=? WHERE id=?`
        )
          .bind(futureTimestamp, claim.id)
          .run();
      }
    }
    await testEnv.DB.prepare(
      `UPDATE public_projection_position_items
          SET lease_expires_at='2000-01-01T00:00:00.000Z'
        WHERE run_id=? AND status='processing'`
    )
      .bind(runId)
      .run();

    const countedRecovery = countingD1Database(testEnv.DB);
    await expect(
      advancePublicProjectionRuns(countedRecovery.db)
    ).resolves.toMatchObject({
      requeued: 1,
      runId,
    });
    expect(countedRecovery.count()).toBe(4);
    const item = await positionItem(runId);
    expect(item).toMatchObject({
      attempt_count: 3,
      error_code: "projection_attempts_exhausted",
      stage: "identity",
      status: "failed",
    });
    expect(item.completed_at).not.toBe(futureTimestamp);
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ duplicateState: "complete", runId });
    await expect(runStatus(runId)).resolves.toBe("running");
    await expect(advanceUntilFinalDuplicateComplete()).resolves.toMatchObject({
      finalDuplicateState: "complete",
      runId,
    });
    await expect(runStatus(runId)).resolves.toBe("completed_with_blocks");
  });

  it("blocks a corrupt identity seal and completes the terminal run", async () => {
    const listing = await seedListing("phase-d1-corrupt-seal");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d1-corrupt-seal@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();
    await testEnv.DB.prepare(
      `UPDATE public_projection_position_items
          SET checkpoint_json=json_set(
            checkpoint_json,'$.positionPayloadHash',?
          )
        WHERE run_id=? AND stage='identity' AND status='queued'`
    )
      .bind("0".repeat(64), runId)
      .run();

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ blocked: 1, identified: 0, runId });
    expect(await positionItem(runId)).toMatchObject({
      error_code: "identity_seal_mismatch",
      stage: "identity",
      status: "blocked",
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ duplicateState: "complete", runId });
    await expect(runStatus(runId)).resolves.toBe("running");
    await expect(advanceUntilFinalDuplicateComplete()).resolves.toMatchObject({
      finalDuplicateState: "complete",
      runId,
    });
    await expect(runStatus(runId)).resolves.toBe("completed_with_blocks");
  });

  it("supersedes queued identity work when its source snapshot drifts", async () => {
    const listing = await seedListing("phase-d1-identity-supersession");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d1-identity-supersession@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();
    await advanceListingMaterial(listing);

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      drift: "source_watermark_changed",
      identified: 0,
      runId,
    });
    expect(await positionItem(runId)).toMatchObject({
      error_code: "projection_run_failed",
      stage: "identity",
      status: "superseded",
    });
    await expect(runStatus(runId)).resolves.toBe("failed");
  });

  it("rotates from older identity work to a competing queued run", async () => {
    const first = await seedListing("phase-d1-fair-identity");
    const second = await seedListing("phase-d1-fair-selection");
    await seedAnalyses(first, directAnalysis());
    await seedAnalyses(second, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d1-fair-rotation@example.test"
    );
    const firstRunId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [first.job.id],
    });
    await advanceRunThroughExpansion();
    const secondRunId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [second.job.id],
    });
    await testEnv.DB.prepare(
      "UPDATE public_projection_runs SET updated_at=? WHERE id=?"
    )
      .bind("2000-01-01T00:00:00.000Z", firstRunId)
      .run();

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ identified: 1, runId: firstRunId });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      advanced: 1,
      runId: secondRunId,
      selected: 1,
    });
  });
});
