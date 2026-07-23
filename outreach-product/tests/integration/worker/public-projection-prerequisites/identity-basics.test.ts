import { beforeEach, describe, expect, it } from "vitest";
import {
  materialCloneSignal,
  sourceReferenceSignal,
} from "../../../../src/features/public/identity-signals";
import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import { processProjectionCanonicalResolutionClaim } from "../../../../worker/services/public-projection/canonical-resolution";
import { createMapboxPermanentLocationResolver } from "../../../../worker/services/public-projection/mapbox-location-resolver";
import { claimProjectionPosition } from "../../../../worker/services/public-projection/position-items";
import { createAuthenticatedUser } from ".././auth";
import { directAnalysis } from "./support/analyses";
import { mapboxTbilisiFixture } from "./support/mapbox";
import { futureTimestamp, resetPrerequisiteDb, testEnv } from "./support/model";
import { listingItem, positionItem, runStatus } from "./support/queries";
import { advanceRunThroughExpansion, createRun } from "./support/runner";
import { seedAnalyses, seedListing } from "./support/seeding";
import {
  advanceListingMaterial,
  publicGraphSnapshot,
  seedExistingPublicGraph,
  seedResolvableOrganization,
} from "./support/state";

beforeEach(resetPrerequisiteDb);

describe("projection prerequisites, source positions, and identity", () => {
  it("supersedes active children atomically when the source cohort drifts", async () => {
    const listing = await seedListing("phase-c-active-supersession");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-c-active-supersession@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advancePublicProjectionRuns(testEnv.DB);
    await advanceListingMaterial(listing);

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      drift: "source_watermark_changed",
      runId,
    });
    expect(await listingItem(runId)).toMatchObject({
      error_code: "projection_run_failed",
      status: "superseded",
    });
    await expect(runStatus(runId)).resolves.toBe("failed");
    await expect(
      testEnv.DB.prepare(
        `SELECT listing_superseded,listing_total
           FROM public_projection_runs WHERE id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({ listing_superseded: 1, listing_total: 1 });
  });

  it("fails run drift before inspecting a waiting analysis item", async () => {
    const listing = await seedListing("phase-c-waiter-supersession");
    const operator = await createAuthenticatedUser(
      "phase-c-waiter-supersession@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);
    expect(await listingItem(runId)).toMatchObject({
      stage: "prerequisites",
      status: "waiting_analysis",
    });
    await advanceListingMaterial(listing);

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      drift: "source_watermark_changed",
      runId,
    });
    expect(await listingItem(runId)).toMatchObject({
      error_code: "projection_run_failed",
      status: "superseded",
    });
    await expect(runStatus(runId)).resolves.toBe("failed");
    await expect(
      testEnv.DB.prepare(
        `SELECT listing_blocked,listing_superseded
           FROM public_projection_runs WHERE id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({ listing_blocked: 0, listing_superseded: 1 });
  });

  it("derives exact versioned identity signals and queues canonical resolution", async () => {
    const listing = await seedListing("phase-d1-identity-signals");
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d1-identity-signals@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      blocked: 0,
      identified: 1,
      runId,
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      duplicateComparisons: 0,
      duplicateState: "complete",
      runId,
    });

    const item = await positionItem(runId);
    const checkpoint = JSON.parse(item.checkpoint_json) as {
      identity: {
        contractVersion: number;
        signals: Array<{ hash: string; kind: string }>;
        state: string;
      };
    };
    const expectedSignals = await Promise.all([
      materialCloneSignal(listing.materialHash),
      sourceReferenceSignal({
        sourceKey: listing.job.board,
        sourceReference: listing.job.sourceReference,
      }),
    ]);
    expectedSignals.sort((left, right) =>
      left.kind.localeCompare(right.kind, "en")
    );
    expect(item).toMatchObject({
      attempt_count: 1,
      error_code: "",
      stage: "canonical_resolution",
      status: "queued",
    });
    expect(checkpoint.identity).toMatchObject({
      contractVersion: 1,
      signals: expectedSignals,
      state: "derived",
    });
    await expect(runStatus(runId)).resolves.toBe("running");
    await expect(
      testEnv.DB.prepare(
        `SELECT canonical_identity_state,comparison_count,
                position_member_count
           FROM public_projection_duplicate_batches WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      canonical_identity_state: "pending",
      comparison_count: 0,
      position_member_count: 1,
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ runId: null });
  });

  it("seals one exact canonical resolution without mutating a nonempty public graph", async () => {
    const listing = await seedListing("phase-d3-canonical-resolution");
    await seedAnalyses(listing, directAnalysis());
    await seedResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "phase-d3-canonical-resolution@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ identified: 1, runId });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ duplicateState: "complete", runId });

    await seedExistingPublicGraph();
    const publicGraphBefore = await publicGraphSnapshot();
    expect(publicGraphBefore.publicJobs).toHaveLength(1);
    const resolver = createMapboxPermanentLocationResolver(
      "fixture-token",
      async () => Response.json(mapboxTbilisiFixture())
    );
    const claim = await claimProjectionPosition(
      testEnv.DB,
      runId,
      "canonical_resolution",
      futureTimestamp,
      { requireUnsealedCanonicalResolution: true }
    );
    if (!claim) {
      throw new Error("Expected a sealed D2 canonical-resolution claim");
    }
    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        resolver
      )
    ).resolves.toMatchObject({
      blocked: 0,
      resolved: 1,
      sealed: 1,
      state: "resolved",
    });

    await expect(publicGraphSnapshot()).resolves.toEqual(publicGraphBefore);
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,selected_organization_id
           FROM public_projection_organization_resolutions WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      reason_code: "organization_name_country_locality",
      selected_organization_id: "organization:example-school-ge",
      state: "resolved",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT resolution.state,resolution.reason_code,
                provider.provider,provider.permanent
           FROM public_projection_location_resolutions resolution
           JOIN public_projection_location_provider_evidence provider
             ON provider.resolution_id=resolution.id
          WHERE resolution.run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      permanent: 1,
      provider: "mapbox-geocoding-v6",
      reason_code: "location_exact_provider_match",
      state: "resolved",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,canonical_signal_hash,seal_hash
           FROM public_projection_resolution_seals WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toMatchObject({
      reason_code: "canonical_resolution_resolved",
      state: "resolved",
    });
    await expect(
      testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM canonical_locations"
      ).first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      claimProjectionPosition(
        testEnv.DB,
        runId,
        "canonical_resolution",
        futureTimestamp,
        { requireUnsealedCanonicalResolution: true }
      )
    ).resolves.toBeNull();
    await expect(
      testEnv.DB.prepare(
        `UPDATE public_projection_resolution_seals
            SET reason_code='changed' WHERE run_id=?`
      )
        .bind(runId)
        .run()
    ).rejects.toThrow("canonical resolution seals are immutable");
    await expect(
      testEnv.DB.prepare(
        "DELETE FROM public_projection_location_resolutions WHERE run_id=?"
      )
        .bind(runId)
        .run()
    ).rejects.toThrow("location resolutions are append-only");
  });

  it("ignores blank organization domains when a listing has one route host", async () => {
    const listing = await seedListing("phase-d3-one-route-host", {
      applyUrl: "https://jobs.example.test/opening",
      company: "Linked School",
      country: "",
      sourceUrl: "https://jobs.example.test/opening",
    });
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d3-one-route-host@example.test"
    );
    const unrelatedOrganizations = Array.from({ length: 51 }, (_, index) =>
      testEnv.DB.prepare(
        `INSERT INTO organizations (
          id,country_code,country_name,name,identity_key,city,region,
          website_url,canonical_domain,market_segment,status,
          outreach_eligibility,created_at,updated_at
        ) VALUES (?, 'ZZ','Unspecified',?,?,'','','','','school','active',
                  'review',?,?)`
      ).bind(
        `organization:blank-domain:${index}`,
        `Unrelated School ${index}`,
        `unrelated-school-${index}`,
        futureTimestamp,
        futureTimestamp
      )
    );
    await testEnv.DB.batch([
      ...unrelatedOrganizations,
      testEnv.DB.prepare(
        `INSERT INTO organizations (
          id,country_code,country_name,name,identity_key,city,region,
          website_url,canonical_domain,market_segment,status,
          outreach_eligibility,created_at,updated_at
        ) VALUES (
          'organization:linked-school','ZZ','Unspecified','Linked School',
          'linked-school','','','','','school','active','review',?,?
        )`
      ).bind(futureTimestamp, futureTimestamp),
      testEnv.DB.prepare(
        `INSERT INTO organization_opportunities (
          organization_id,job_id,evidence_url,linked_at
        ) VALUES ('organization:linked-school',?,?,?)`
      ).bind(listing.job.id, listing.job.sourceUrl, futureTimestamp),
      testEnv.DB.prepare(
        `INSERT INTO organization_opportunity_acceptances (
          organization_id,job_id,accepted_by_user_id,accepted_at,created_at
        ) VALUES ('organization:linked-school',?,?,?,?)`
      ).bind(listing.job.id, operator.userId, futureTimestamp, futureTimestamp),
    ]);
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ identified: 1, runId });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ duplicateState: "complete", runId });
    const claim = await claimProjectionPosition(
      testEnv.DB,
      runId,
      "canonical_resolution",
      futureTimestamp,
      { requireUnsealedCanonicalResolution: true }
    );
    if (!claim) {
      throw new Error("Expected a canonical-resolution claim");
    }
    const resolver = createMapboxPermanentLocationResolver(
      "fixture-token",
      async () => Response.json(mapboxTbilisiFixture())
    );

    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        resolver
      )
    ).resolves.toMatchObject({
      blocked: 0,
      resolved: 1,
      sealed: 1,
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT candidate_count,reason_code,selected_organization_id,state
           FROM public_projection_organization_resolutions WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      candidate_count: 1,
      reason_code: "organization_explicit_link",
      selected_organization_id: "organization:linked-school",
      state: "resolved",
    });
  });
});
