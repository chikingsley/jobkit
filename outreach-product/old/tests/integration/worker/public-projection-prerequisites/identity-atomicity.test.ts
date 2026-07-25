import { beforeEach, describe, expect, it } from "vitest";
import { processProjectionCanonicalResolutionClaim } from "../../../../worker/services/public-projection/canonical-resolution";
import { createMapboxPermanentLocationResolver } from "../../../../worker/services/public-projection/mapbox-location-resolver";
import { createAuthenticatedUser } from ".././auth";
import { directAnalysis } from "./support/analyses";
import { mapboxTbilisiFixture } from "./support/mapbox";
import {
  futureTimestamp,
  resetPrerequisiteDb,
  testEnv,
  timestamp,
} from "./support/model";
import { seedAnalyses, seedListing } from "./support/seeding";
import {
  canonicalResolutionClaim,
  seedResolvableOrganization,
} from "./support/state";

beforeEach(resetPrerequisiteDb);

describe("projection prerequisites, source positions, and identity", () => {
  it("resolves a version-pinned verified registrable employer domain", async () => {
    const listing = await seedListing("phase-d3-verified-domain", {
      applyUrl: "https://careers.school.co.uk/openings/english-teacher",
      company: "Board-supplied employer label",
      sourceUrl: "https://board.example.test/jobs/verified-domain",
    });
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d3-verified-domain@example.test"
    );
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO organizations (
          id,country_code,country_name,name,identity_key,city,canonical_domain,
          market_segment,status,outreach_eligibility,created_at,updated_at
        ) VALUES (
          'organization:verified-domain','GE','Georgia','Verified School',
          'domain:school.co.uk','Tbilisi','school.co.uk','school','active',
          'review',?,?
        )`
      ).bind(timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO organization_domain_mappings (
          id,organization_id,mapping_kind,normalized_host,registrable_domain,
          path_prefix,public_suffix_list_version,accepted_by_user_id,
          accepted_at,evidence_url,created_at
        ) VALUES (
          'domain-mapping:verified-domain','organization:verified-domain',
          'employer_registrable_domain','school.co.uk','school.co.uk','',
          'tldts-7.4.8-icann',?,?,'https://school.co.uk/about',?
        )`
      ).bind(operator.userId, timestamp, timestamp),
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
      reason_code: "organization_employer_domain",
      selected_organization_id: "organization:verified-domain",
      state: "resolved",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT evidence_tier,polarity,source_key,source_reference
           FROM public_projection_organization_evidence
          WHERE run_id=? AND evidence_kind='employer_domain'`
      )
        .bind(runId)
        .first()
    ).resolves.toEqual({
      evidence_tier: 2,
      polarity: "positive",
      source_key: "organization_domain_mappings",
      source_reference: "domain-mapping:verified-domain",
    });
  });

  it("resolves only the explicitly verified hosted ATS tenant", async () => {
    const listing = await seedListing("phase-d3-verified-ats", {
      applyUrl: "https://jobs.greenhouse.io/example-school/jobs/42",
      company: "Shared ATS listing",
      sourceUrl: "https://board.example.test/jobs/verified-ats",
    });
    await seedAnalyses(listing, directAnalysis());
    const operator = await createAuthenticatedUser(
      "phase-d3-verified-ats@example.test"
    );
    await testEnv.DB.batch([
      ...["example", "other"].map((tenant) =>
        testEnv.DB.prepare(
          `INSERT INTO organizations (
            id,country_code,country_name,name,identity_key,city,
            canonical_domain,market_segment,status,outreach_eligibility,
            created_at,updated_at
          ) VALUES (?,?,?,?,?,'Tbilisi',?,'school','active','review',?,?)`
        ).bind(
          `organization:${tenant}-ats`,
          "GE",
          "Georgia",
          `${tenant} ATS School`,
          `domain:${tenant}-school.ge`,
          `${tenant}-school.ge`,
          timestamp,
          timestamp
        )
      ),
      ...["example", "other"].map((tenant) =>
        testEnv.DB.prepare(
          `INSERT INTO organization_domain_mappings (
            id,organization_id,mapping_kind,normalized_host,
            registrable_domain,path_prefix,public_suffix_list_version,
            accepted_by_user_id,accepted_at,evidence_url,created_at
          ) VALUES (?,?, 'hosted_ats_tenant','jobs.greenhouse.io',
                    'greenhouse.io',?,'tldts-7.4.8-icann',?,?,?,?)`
        ).bind(
          `domain-mapping:${tenant}-ats`,
          `organization:${tenant}-ats`,
          `/${tenant}-school`,
          operator.userId,
          timestamp,
          `https://${tenant}-school.ge/`,
          timestamp
        )
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
      reason_code: "organization_employer_domain",
      selected_organization_id: "organization:example-ats",
      state: "resolved",
    });
  });

  it.each([
    ["exact corroboration", ["a"] as const, "resolved"],
    ["overlapping contradiction", ["a", "b"] as const, "ambiguous"],
    ["disjoint contradiction", ["b", "c"] as const, "ambiguous"],
  ] as const)(
    "evaluates the complete Tier-2 verified-domain set for %s",
    async (fixtureName, tierTwoOrganizations, expectedState) => {
      const fixtureKey = fixtureName.replaceAll(" ", "-");
      const listing = await seedListing(
        `phase-d3-tier-conflict-${fixtureKey}`,
        {
          applyUrl: "https://jobs.greenhouse.io/tenant/jobs/english-teacher",
          company: "Tier conflict board label",
          sourceUrl: `https://board.example.test/jobs/${fixtureKey}`,
        }
      );
      await seedAnalyses(listing, directAnalysis());
      const operator = await createAuthenticatedUser(
        `phase-d3-tier-conflict-${fixtureKey}@example.test`
      );
      await testEnv.DB.batch([
        ...["a", "b", "c"].map((organizationKey) =>
          testEnv.DB.prepare(
            `INSERT INTO organizations (
              id,country_code,country_name,name,identity_key,city,
              canonical_domain,market_segment,status,outreach_eligibility,
              created_at,updated_at
            ) VALUES (?,?, 'Georgia',?,?, 'Tbilisi',?,'school','active',
                      'review',?,?)`
          ).bind(
            `organization:tier-${fixtureKey}-${organizationKey}`,
            "GE",
            `Tier ${organizationKey.toUpperCase()} School`,
            `name:tier ${fixtureKey} ${organizationKey} school`,
            `tier-${fixtureKey}-${organizationKey}-school.ge`,
            timestamp,
            timestamp
          )
        ),
        testEnv.DB.prepare(
          `INSERT INTO organization_opportunities (
            organization_id,job_id,evidence_url,linked_at
          ) VALUES (
            ?,?,'https://tier-a-school.ge/jobs',?
          )`
        ).bind(`organization:tier-${fixtureKey}-a`, listing.job.id, timestamp),
        testEnv.DB.prepare(
          `INSERT INTO organization_opportunity_acceptances (
            organization_id,job_id,accepted_by_user_id,accepted_at,created_at
          ) VALUES (?,?,?,?,?)`
        ).bind(
          `organization:tier-${fixtureKey}-a`,
          listing.job.id,
          operator.userId,
          timestamp,
          timestamp
        ),
        ...tierTwoOrganizations.map((organizationKey) => {
          const pathPrefix = {
            a: "/tenant",
            b: "/tenant/jobs",
            c: "/tenant/jobs/english-teacher",
          }[organizationKey];
          return testEnv.DB.prepare(
            `INSERT INTO organization_domain_mappings (
              id,organization_id,mapping_kind,normalized_host,
              registrable_domain,path_prefix,public_suffix_list_version,
              accepted_by_user_id,accepted_at,evidence_url,created_at
            ) VALUES (?,?,'hosted_ats_tenant','jobs.greenhouse.io',
                      'greenhouse.io',?,'tldts-7.4.8-icann',?,?,?,?)`
          ).bind(
            `domain-mapping:tier-${fixtureKey}-${organizationKey}`,
            `organization:tier-${fixtureKey}-${organizationKey}`,
            pathPrefix,
            operator.userId,
            timestamp,
            `https://tier-${organizationKey}-school.ge/careers`,
            timestamp
          );
        }),
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
      ).resolves.toMatchObject({
        blocked: expectedState === "resolved" ? 0 : 1,
        resolved: expectedState === "resolved" ? 1 : 0,
        sealed: 1,
        state: expectedState,
      });
      await expect(
        testEnv.DB.prepare(
          `SELECT state,reason_code,selected_organization_id
             FROM public_projection_organization_resolutions WHERE run_id=?`
        )
          .bind(runId)
          .first()
      ).resolves.toEqual(
        expectedState === "resolved"
          ? {
              reason_code: "organization_explicit_link",
              selected_organization_id: `organization:tier-${fixtureKey}-a`,
              state: "resolved",
            }
          : {
              reason_code: "organization_evidence_conflict",
              selected_organization_id: null,
              state: "ambiguous",
            }
      );
    }
  );

  it("pins domain mappings to an operator and suffix-list version", async () => {
    const operator = await createAuthenticatedUser(
      "phase-d3-domain-mapping-operator@example.test"
    );
    const member = await createAuthenticatedUser(
      "phase-d3-domain-mapping-member@example.test",
      "member"
    );
    await testEnv.DB.prepare(
      `INSERT INTO organizations (
        id,country_code,country_name,name,identity_key,canonical_domain,
        market_segment,status,outreach_eligibility,created_at,updated_at
      ) VALUES (
        'organization:domain-guard','GE','Georgia','Domain Guard School',
        'domain:guard-school.ge','guard-school.ge','school','active','review',?,?
      )`
    )
      .bind(timestamp, timestamp)
      .run();
    const mappingStatement = () =>
      testEnv.DB.prepare(
        `INSERT INTO organization_domain_mappings (
          id,organization_id,mapping_kind,normalized_host,registrable_domain,
          path_prefix,public_suffix_list_version,accepted_by_user_id,
          accepted_at,evidence_url,created_at
        ) VALUES (
          ?,'organization:domain-guard','employer_registrable_domain',
          'guard-school.ge','guard-school.ge','',?,?,?,
          'https://guard-school.ge/about',?
        )`
      );

    await expect(
      mappingStatement()
        .bind(
          "domain-mapping:wrong-psl",
          "tldts-unpinned",
          operator.userId,
          timestamp,
          timestamp
        )
        .run()
    ).rejects.toThrow();
    await expect(
      mappingStatement()
        .bind(
          "domain-mapping:member",
          "tldts-7.4.8-icann",
          member.userId,
          timestamp,
          timestamp
        )
        .run()
    ).rejects.toThrow();
    await expect(
      mappingStatement()
        .bind(
          "domain-mapping:operator",
          "tldts-7.4.8-icann",
          operator.userId,
          timestamp,
          timestamp
        )
        .run()
    ).resolves.toMatchObject({ success: true });
  });

  it("rolls back every D3 artifact when the final claim CAS loses", async () => {
    const listing = await seedListing("phase-d3-final-cas-rollback");
    await seedAnalyses(listing, directAnalysis());
    await seedResolvableOrganization();
    const operator = await createAuthenticatedUser(
      "phase-d3-final-cas-rollback@example.test"
    );
    const { claim, runId } = await canonicalResolutionClaim(
      listing,
      operator.cookie
    );
    await testEnv.DB.prepare(
      `CREATE TRIGGER test_d3_final_cas_sabotage
       AFTER INSERT ON public_projection_resolution_seals
       BEGIN
         UPDATE public_projection_position_items
            SET lease_token='sabotaged'
          WHERE id=NEW.position_item_id AND run_id=NEW.run_id;
       END`
    ).run();
    try {
      await expect(
        processProjectionCanonicalResolutionClaim(
          testEnv.DB,
          claim,
          futureTimestamp,
          createMapboxPermanentLocationResolver("fixture-token", () =>
            Promise.resolve(Response.json(mapboxTbilisiFixture()))
          )
        )
      ).rejects.toThrow();
    } finally {
      await testEnv.DB.prepare("DROP TRIGGER test_d3_final_cas_sabotage").run();
    }
    await expect(
      testEnv.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM public_projection_organization_resolutions
            WHERE run_id=?) organizations,
          (SELECT COUNT(*) FROM public_projection_location_resolutions
            WHERE run_id=?) locations,
          (SELECT COUNT(*) FROM public_projection_resolution_seals
            WHERE run_id=?) seals`
      )
        .bind(runId, runId, runId)
        .first()
    ).resolves.toEqual({ locations: 0, organizations: 0, seals: 0 });
    await expect(
      testEnv.DB.prepare(
        `SELECT json_extract(checkpoint_json,'$.resolutionGuard') guard,
                lease_token
           FROM public_projection_position_items WHERE id=?`
      )
        .bind(claim.id)
        .first()
    ).resolves.toEqual({ guard: null, lease_token: claim.leaseToken });
  });
});
