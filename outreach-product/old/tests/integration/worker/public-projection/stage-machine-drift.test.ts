import { beforeEach, describe, expect, it } from "vitest";
import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import {
  nextActiveRun,
  PROJECTION_RUN_STAGES,
  type ProjectionRunStageName,
} from "../../../../worker/services/public-projection/advancement/stage-machine";
import { claimProjectionListing } from "../../../../worker/services/public-projection/listing-items";
import { createMapboxPermanentLocationResolver } from "../../../../worker/services/public-projection/mapbox-location-resolver";
import { createAuthenticatedUser } from "../auth";
import { directAnalysis } from "../public-projection-prerequisites/support/analyses";
import { mapboxGeorgiaFixture } from "../public-projection-prerequisites/support/mapbox";
import { resetPrerequisiteDb } from "../public-projection-prerequisites/support/model";
import { createRun } from "../public-projection-prerequisites/support/runner";
import {
  seedAnalyses,
  seedListing,
} from "../public-projection-prerequisites/support/seeding";
import { pendingStageNames, readRunRow, runFingerprint } from "./stage-harness";
import { testEnv } from "./support";

beforeEach(resetPrerequisiteDb);

function fixtureResolver() {
  return createMapboxPermanentLocationResolver("fixture-token", () =>
    Promise.resolve(Response.json(mapboxGeorgiaFixture()))
  );
}

/**
 * A countrywide location assertion: the resolver returns a country feature,
 * whose centroid coordinates the public candidate schema accepts.
 */
function countrywideAnalysis() {
  const analysis = directAnalysis();
  return {
    ...analysis,
    positions: analysis.positions.map((position) => ({
      ...position,
      locations: [
        {
          addressComponents: [],
          evidence: "Georgia",
          parentGeographies: [],
          role: "worksite" as const,
          scope: "countrywide" as const,
          semanticKind: "country" as const,
          value: "Georgia",
          workplaceType: "onsite" as const,
        },
      ],
    })),
  };
}

/**
 * An active organization whose canonical domain matches the seeded listing's
 * apply domain, so canonical resolution resolves it by employer domain
 * without needing locality corroboration.
 */
async function seedDomainResolvableOrganization() {
  const timestamp = "2026-07-22T12:00:00.000Z";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO organizations (
        id,country_code,country_name,name,identity_key,city,region,
        website_url,canonical_domain,market_segment,status,
        outreach_eligibility,evidence_url,last_verified_at,created_at,updated_at
      ) VALUES (
        'organization:stage-drift-school','GE','Georgia','Example School',
        'name:example school|city:tbilisi','Tbilisi','',
        'https://example-school.ge','example-school.ge','school','active',
        'eligible','https://example-school.ge/about',?,?,?
      )`
    ).bind(timestamp, timestamp, timestamp),
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO organization_evidence (
        id,organization_id,source_kind,evidence_kind,evidence_status,
        source_label,source_url,observed_at,created_at
      ) VALUES (
        'organization-evidence:stage-drift-school',
        'organization:stage-drift-school','historical_workbook',
        'organization_profile','active','Example School',
        'https://example.test/about',?,?
      )`
    ).bind(timestamp, timestamp),
  ]);
}

/**
 * Advances the run until the selector stops selecting it, asserting the core
 * no-spin invariant at every step: whenever the stage machine reports pending
 * work, one consumer invocation must change durable state.
 */
async function walkRunToTermination(runId: string, maxSteps = 60) {
  const frontier: ProjectionRunStageName[][] = [await pendingStageNames(runId)];
  for (let step = 0; step < maxSteps; step += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: The walk is serial by design; every step models one queue delivery.
    const selected = await nextActiveRun(testEnv.DB, true);
    if (!selected) {
      return frontier;
    }
    // biome-ignore lint/suspicious/noMisplacedAssertion: The walk helper only runs inside tests and asserts the per-step no-spin invariant.
    expect(selected.id).toBe(runId);
    const before = await runFingerprint(runId);
    await advancePublicProjectionRuns(testEnv.DB, {
      locationResolver: fixtureResolver(),
    });
    const after = await runFingerprint(runId);
    // biome-ignore lint/suspicious/noMisplacedAssertion: A selected run whose invocation changes no durable state is the spin regression this file guards against.
    expect(after).not.toBe(before);
    const pending = await pendingStageNames(runId);
    const previous = frontier.at(-1);
    if (JSON.stringify(previous) !== JSON.stringify(pending)) {
      frontier.push(pending);
    }
  }
  throw new Error(`The projection walk exceeded ${maxSteps} steps`);
}

describe("public projection stage machine drift proofing", () => {
  it("declares the full ordered stage list", () => {
    expect(PROJECTION_RUN_STAGES.map((stage) => stage.name)).toEqual([
      "selection",
      "listing_validation",
      "prerequisites",
      "source_positions",
      "identity",
      "duplicate_comparisons",
      "canonical_resolution",
      "final_graph",
      "candidates",
    ]);
  });

  it("walks every stage with selector and consumers in agreement", async () => {
    const listing = await seedListing("stage-drift-listing", {
      applyEmail: "jobs@example-school.ge",
      applyUrl: "https://example-school.ge/apply",
    });
    await seedAnalyses(listing, countrywideAnalysis());
    await seedDomainResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "projection-stage-drift@example.test"
    );
    await testEnv.DB.prepare(
      `INSERT INTO organization_source_employer_mappings (
        source_key,employer_id,organization_id,accepted_by_user_id,
        accepted_at,created_at
      ) VALUES ('tefl','employer-42','organization:stage-drift-school',?,
        '2026-07-22T12:00:00.000Z','2026-07-22T12:00:00.000Z')`
    )
      .bind(operator.userId)
      .run();
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });

    const frontier = await walkRunToTermination(runId);
    expect(frontier).toEqual([
      ["selection"],
      ["prerequisites"],
      ["source_positions"],
      ["identity"],
      ["duplicate_comparisons"],
      ["canonical_resolution"],
      ["final_graph"],
      ["candidates"],
      [],
    ]);

    await expect(readRunRow(runId)).resolves.toMatchObject({
      error_code: "",
      status: "completed",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code
           FROM public_projection_candidate_results WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      reason_code: "candidate_prepared",
      state: "prepared",
    });
    await expect(nextActiveRun(testEnv.DB, true)).resolves.toBeNull();
  });

  it("terminalizes a run whose page attempts exhaust instead of wedging it", async () => {
    const listing = await seedListing("stage-attempts-listing");
    const operator = await createAuthenticatedUser(
      "projection-stage-attempts@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({ advanced: 1, runId });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: Each cycle models one real lease expiry before the next claim.
      const claim = await claimProjectionListing(
        testEnv.DB,
        runId,
        "prerequisites",
        new Date().toISOString()
      );
      expect(claim?.attemptCount).toBe(attempt);
      await testEnv.DB.prepare(
        `UPDATE public_projection_listing_items
            SET lease_expires_at='2000-01-01T00:00:00.000Z'
          WHERE run_id=? AND status='processing'`
      )
        .bind(runId)
        .run();
      await advancePublicProjectionRuns(testEnv.DB);
    }
    await expect(
      testEnv.DB.prepare(
        `SELECT status,error_code,attempt_count
           FROM public_projection_listing_items WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      attempt_count: 3,
      error_code: "projection_attempts_exhausted",
      status: "failed",
    });

    // The exhausted item is terminal, so the machine must carry the run
    // through the remaining stages instead of stranding it in limbo.
    const frontier = await walkRunToTermination(runId);
    expect(frontier.at(-1)).toEqual([]);
    await expect(readRunRow(runId)).resolves.toMatchObject({
      status: "completed_with_blocks",
    });
    await expect(nextActiveRun(testEnv.DB, true)).resolves.toBeNull();
  });
});
