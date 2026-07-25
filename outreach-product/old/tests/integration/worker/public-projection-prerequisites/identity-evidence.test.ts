import { beforeEach, describe, expect, it } from "vitest";
import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import { processProjectionCanonicalResolutionClaim } from "../../../../worker/services/public-projection/canonical-resolution";
import { createMapboxPermanentLocationResolver } from "../../../../worker/services/public-projection/mapbox-location-resolver";
import { claimProjectionPosition } from "../../../../worker/services/public-projection/position-items";
import { createAuthenticatedUser } from ".././auth";
import { directAnalysis } from "./support/analyses";
import { mapboxTbilisiFixture } from "./support/mapbox";
import {
  futureTimestamp,
  resetPrerequisiteDb,
  testEnv,
  timestamp,
} from "./support/model";
import { advanceRunThroughExpansion, createRun } from "./support/runner";
import { seedAnalyses, seedListing } from "./support/seeding";
import {
  canonicalResolutionClaim,
  seedResolvableOrganization,
} from "./support/state";

beforeEach(resetPrerequisiteDb);

describe("projection prerequisites, source positions, and identity", () => {
  it("seals a provider-auth block without publishing a canonical signal", async () => {
    const listing = await seedListing("phase-d3-provider-auth-block");
    await seedAnalyses(listing, directAnalysis());
    await seedResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "phase-d3-provider-auth-block@example.test"
    );
    const runId = await createRun(operator.cookie, {
      boards: [],
      listingIds: [listing.job.id],
    });
    await advanceRunThroughExpansion();
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);
    const claim = await claimProjectionPosition(
      testEnv.DB,
      runId,
      "canonical_resolution",
      futureTimestamp,
      { requireUnsealedCanonicalResolution: true }
    );
    if (!claim) {
      throw new Error("Expected a provider-auth canonical-resolution claim");
    }

    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        createMapboxPermanentLocationResolver(undefined)
      )
    ).resolves.toMatchObject({ blocked: 1, sealed: 1, state: "blocked" });
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,canonical_signal_hash
           FROM public_projection_resolution_seals WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      canonical_signal_hash: null,
      reason_code: "location_provider_auth",
      state: "blocked",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT state,signal_hash
           FROM public_projection_canonical_identity_signals WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({ signal_hash: null, state: "blocked" });
  });

  it("keeps raw opportunity and hostname matches as candidate evidence", async () => {
    const listing = await seedListing("phase-d3-unaccepted-organization", {
      applyUrl: "https://unaccepted.example.test/apply",
      company: "Unaccepted Board Listing",
      employerId: "unaccepted-employer",
      sourceUrl: "https://unaccepted.example.test/jobs/1",
    });
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d3-unaccepted-organization@example.test"
    );
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO organizations (
          id,country_code,country_name,name,identity_key,city,canonical_domain,
          market_segment,status,outreach_eligibility,created_at,updated_at
        ) VALUES (
          'organization:unaccepted','GE','Georgia','Unaccepted Recruiter',
          'domain:unaccepted.example.test','Batumi','unaccepted.example.test','school','active',
          'review',?,?
        )`
      ).bind(timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO organization_evidence (
          id,organization_id,source_kind,evidence_kind,evidence_status,
          source_url,observed_at,created_at
        ) VALUES (
          'organization-evidence:unaccepted','organization:unaccepted',
          'historical_workbook','vacancy','active','https://unaccepted.example.test/jobs',
          ?,?
        )`
      ).bind(timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO organization_opportunities (
          organization_id,job_id,evidence_url,linked_at
        ) VALUES (
          'organization:unaccepted',?,'https://unaccepted.example.test/jobs',?
        )`
      ).bind(listing.job.id, timestamp),
    ]);
    const { claim, runId } = await canonicalResolutionClaim(
      listing,
      operator.cookie
    );
    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        createMapboxPermanentLocationResolver("fixture-token", () =>
          Promise.resolve(Response.json(mapboxTbilisiFixture()))
        )
      )
    ).resolves.toMatchObject({ blocked: 1, sealed: 1, state: "unresolved" });
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,selected_organization_id
           FROM public_projection_organization_resolutions WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      reason_code: "organization_candidate_only",
      selected_organization_id: null,
      state: "unresolved",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT evidence_tier,polarity
           FROM public_projection_organization_evidence
          WHERE run_id=? AND evidence_kind='employer_domain'`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({ evidence_tier: 4, polarity: "candidate" });
  });

  it("resolves an operator-accepted source employer identity", async () => {
    const listing = await seedListing("phase-d3-source-employer", {
      company: "Source Employer Listing",
      employerId: "source-employer-unique",
    });
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d3-source-employer@example.test"
    );
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO organizations (
          id,country_code,country_name,name,identity_key,city,market_segment,
          status,outreach_eligibility,created_at,updated_at
        ) VALUES (
          'organization:source-employer','GE','Georgia','Mapped School',
          'name:mapped school','Batumi','school','active','review',?,?
        )`
      ).bind(timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO organization_source_employer_mappings (
          source_key,employer_id,organization_id,accepted_by_user_id,
          accepted_at,created_at
        ) VALUES (
          ?,?,'organization:source-employer',?,?,?
        )`
      ).bind(
        listing.job.board,
        listing.job.employerId,
        operator.userId,
        timestamp,
        timestamp
      ),
    ]);
    const { claim, runId } = await canonicalResolutionClaim(
      listing,
      operator.cookie
    );
    await expect(
      processProjectionCanonicalResolutionClaim(
        testEnv.DB,
        claim,
        futureTimestamp,
        createMapboxPermanentLocationResolver("fixture-token", () =>
          Promise.resolve(Response.json(mapboxTbilisiFixture()))
        )
      )
    ).resolves.toMatchObject({ blocked: 0, resolved: 1, sealed: 1 });
    await expect(
      testEnv.DB.prepare(
        `SELECT state,reason_code,selected_organization_id
           FROM public_projection_organization_resolutions WHERE run_id=?`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      reason_code: "organization_source_employer_id",
      selected_organization_id: "organization:source-employer",
      state: "resolved",
    });
  });
});
