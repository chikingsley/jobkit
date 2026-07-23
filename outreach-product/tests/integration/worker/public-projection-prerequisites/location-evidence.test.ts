import { beforeEach, describe, expect, it } from "vitest";
import { processProjectionCanonicalResolutionClaim } from "../../../../worker/services/public-projection/canonical-resolution";
import {
  createMapboxPermanentLocationResolver,
  type PermanentLocationResolver,
} from "../../../../worker/services/public-projection/mapbox-location-resolver";
import { createAuthenticatedUser } from ".././auth";
import {
  addressAnalysis,
  directAnalysis,
  parentAndChildAnalysis,
  parentMismatchAnalysis,
  sourceCountryConflictAnalysis,
  sourceParentConflictAnalysis,
} from "./support/analyses";
import {
  mapboxAddressFixture,
  mapboxGeorgiaFixture,
  mapboxTbilisiFixture,
  permanentFixtureResponse,
} from "./support/mapbox";
import { futureTimestamp, resetPrerequisiteDb, testEnv } from "./support/model";
import { seedAnalyses, seedListing } from "./support/seeding";
import {
  canonicalResolutionClaim,
  seedResolvableOrganization,
} from "./support/state";

beforeEach(resetPrerequisiteDb);

describe("projection prerequisites, source positions, and identity", () => {
  it("rolls back D3 before artifacts when the exact guard loses", async () => {
    const listing = await seedListing("phase-d3-guard-rollback");
    await seedAnalyses(listing, directAnalysis());
    await seedResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "phase-d3-guard-rollback@example.test"
    );
    const { claim, runId } = await canonicalResolutionClaim(
      listing,
      operator.cookie
    );
    let mutationInjected = false;
    const mutatingDb = new Proxy(testEnv.DB, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!mutationInjected) {
              mutationInjected = true;
              await target
                .prepare(
                  "UPDATE job_content_analyses SET updated_at=? WHERE job_id=?"
                )
                .bind("2026-07-22T12:01:00.000Z", listing.job.id)
                .run();
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;
    await expect(
      processProjectionCanonicalResolutionClaim(
        mutatingDb,
        claim,
        futureTimestamp,
        createMapboxPermanentLocationResolver("fixture-token", () =>
          Promise.resolve(Response.json(mapboxTbilisiFixture()))
        )
      )
    ).rejects.toThrow();
    expect(mutationInjected).toBe(true);
    await expect(
      testEnv.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM public_projection_organization_resolutions
            WHERE run_id=?) organizations,
          (SELECT COUNT(*) FROM public_projection_location_resolutions
            WHERE run_id=?) locations,
          json_extract(checkpoint_json,'$.resolutionGuard') guard
         FROM public_projection_position_items WHERE id=?`
      )
        .bind(runId, runId, claim.id)
        .first()
    ).resolves.toEqual({ guard: null, locations: 0, organizations: 0 });
  });

  it("uses a resolved parent bounding box for a child location", async () => {
    const listing = await seedListing("phase-d3-parent-bbox");
    await seedAnalyses(listing, parentAndChildAnalysis());
    await seedResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "phase-d3-parent-bbox@example.test"
    );
    const { claim } = await canonicalResolutionClaim(listing, operator.cookie);
    const queries: Array<{ bbox?: number[] | null; literalLabel: string }> = [];
    const resolver: PermanentLocationResolver = {
      resolve(query) {
        queries.push(query);
        return Promise.resolve(
          permanentFixtureResponse(
            query.literalLabel === "Georgia"
              ? mapboxGeorgiaFixture()
              : mapboxTbilisiFixture(),
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
    expect(queries).toEqual([
      {
        bbox: null,
        countryCode: "GE",
        literalLabel: "Georgia",
        semanticKind: "country",
      },
      {
        bbox: [39.9, 41.0, 46.8, 43.7],
        countryCode: "GE",
        literalLabel: "Tbilisi",
        semanticKind: "city",
      },
    ]);
  });

  it("keeps parent-safe provider queries stable when source locations reverse", async () => {
    const firstListing = await seedListing("phase-d3-parent-order-first");
    const secondListing = await seedListing("phase-d3-parent-order-second");
    const analysis = parentAndChildAnalysis();
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
      "phase-d3-parent-order@example.test"
    );
    const firstClaim = await canonicalResolutionClaim(
      firstListing,
      operator.cookie
    );
    const secondClaim = await canonicalResolutionClaim(
      secondListing,
      operator.cookie
    );
    const queryRuns: Array<
      Array<{ bbox?: number[] | null; literalLabel: string }>
    > = [[], []];
    const resolverForRun = (runIndex: number): PermanentLocationResolver => ({
      resolve(query) {
        queryRuns[runIndex]?.push(query);
        return Promise.resolve(
          permanentFixtureResponse(
            query.literalLabel === "Georgia"
              ? mapboxGeorgiaFixture()
              : mapboxTbilisiFixture(),
            query.literalLabel
          )
        );
      },
    });

    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      firstClaim.claim,
      futureTimestamp,
      resolverForRun(0)
    );
    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      secondClaim.claim,
      futureTimestamp,
      resolverForRun(1)
    );

    const expectedQueries = [
      {
        bbox: null,
        countryCode: "GE",
        literalLabel: "Georgia",
        semanticKind: "country",
      },
      {
        bbox: [39.9, 41, 46.8, 43.7],
        countryCode: "GE",
        literalLabel: "Tbilisi",
        semanticKind: "city",
      },
    ];
    expect(queryRuns[0]).toEqual(expectedQueries);
    expect(queryRuns[1]).toEqual(expectedQueries);
  });

  it("rejects provider candidates with a wrong parent or unmatched address", async () => {
    const parentListing = await seedListing("phase-d3-parent-mismatch");
    await seedAnalyses(parentListing, parentMismatchAnalysis());
    const parentOperator = await createAuthenticatedUser(
      "phase-d3-parent-mismatch@example.test"
    );
    const parentClaim = await canonicalResolutionClaim(
      parentListing,
      parentOperator.cookie
    );
    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      parentClaim.claim,
      futureTimestamp,
      createMapboxPermanentLocationResolver("fixture-token", () =>
        Promise.resolve(Response.json(mapboxTbilisiFixture()))
      )
    );
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,viable_candidate_count
           FROM public_projection_location_resolutions WHERE run_id=?`
      )
        .bind(parentClaim.runId)
        .first()
    ).resolves.toEqual({
      reason_code: "location_parent_conflict",
      state: "ambiguous",
      viable_candidate_count: 0,
    });

    const addressListing = await seedListing("phase-d3-address-mismatch");
    await seedAnalyses(addressListing, addressAnalysis());
    const addressOperator = await createAuthenticatedUser(
      "phase-d3-address-mismatch@example.test"
    );
    const addressClaim = await canonicalResolutionClaim(
      addressListing,
      addressOperator.cookie
    );
    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      addressClaim.claim,
      futureTimestamp,
      createMapboxPermanentLocationResolver("fixture-token", () =>
        Promise.resolve(Response.json(mapboxAddressFixture()))
      )
    );
    await expect(
      testEnv.DB.prepare(
        `SELECT resolution.state,resolution.reason_code,candidate.viable
           FROM public_projection_location_resolutions resolution
           JOIN public_projection_location_candidates candidate
             ON candidate.resolution_id=resolution.id
          WHERE resolution.run_id=?`
      )
        .bind(addressClaim.runId)
        .first()
    ).resolves.toEqual({
      reason_code: "location_no_viable_candidate",
      state: "unresolved",
      viable: 0,
    });
  });

  it("marks conflicting sealed source countries and parents ambiguous", async () => {
    const countryListing = await seedListing("phase-d3-country-conflict");
    await seedAnalyses(countryListing, sourceCountryConflictAnalysis());
    const countryOperator = await createAuthenticatedUser(
      "phase-d3-country-conflict@example.test"
    );
    const countryClaim = await canonicalResolutionClaim(
      countryListing,
      countryOperator.cookie
    );
    let providerQueries = 0;
    const resolver: PermanentLocationResolver = {
      resolve(query) {
        providerQueries += 1;
        return Promise.resolve(
          permanentFixtureResponse(mapboxTbilisiFixture(), query.literalLabel)
        );
      },
    };

    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      countryClaim.claim,
      futureTimestamp,
      resolver
    );
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code FROM public_projection_location_resolutions
          WHERE run_id=?`
      )
        .bind(countryClaim.runId)
        .first()
    ).resolves.toEqual({
      reason_code: "location_country_conflict",
      state: "ambiguous",
    });

    const parentListing = await seedListing("phase-d3-source-parent-conflict");
    await seedAnalyses(parentListing, sourceParentConflictAnalysis());
    const parentOperator = await createAuthenticatedUser(
      "phase-d3-source-parent-conflict@example.test"
    );
    const parentClaim = await canonicalResolutionClaim(
      parentListing,
      parentOperator.cookie
    );
    await processProjectionCanonicalResolutionClaim(
      testEnv.DB,
      parentClaim.claim,
      futureTimestamp,
      resolver
    );
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code FROM public_projection_location_resolutions
          WHERE run_id=?`
      )
        .bind(parentClaim.runId)
        .first()
    ).resolves.toEqual({
      reason_code: "location_parent_conflict",
      state: "ambiguous",
    });
    expect(providerQueries).toBe(0);
  });
});
