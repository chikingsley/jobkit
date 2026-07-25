import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { serializePublicJobListItem } from "../../../../worker/public-jobs/schemas";
import {
  readPublicJobDetail,
  readPublicJobList,
} from "../../../../worker/repositories/public-jobs";
import {
  candidateRow,
  hash,
  makePublicId,
  publishCatalog,
} from "./support/appendterminaldecision";
import {
  allFields,
  catalogMembershipMismatchPattern,
  catalogSealMismatchPattern,
  locationFacetCountPattern,
  payloadIdentityPattern,
  request,
  routingIdentityPattern,
  searchCountPattern,
  seedPublishedJob,
  seedSource,
  testEnv,
  timestamp,
} from "./support/model";

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public job read model", () => {
  it("starts with the immutable policy-reviewed empty catalog", async () => {
    const response = await readPublicJobList(
      testEnv.DB,
      request(new URLSearchParams())
    );
    expect(response).toMatchObject({
      catalog: { version: "policy-invalidation:seriousteachers:2" },
      items: [],
      page: { hasMore: false, nextCursor: null },
      schemaVersion: "public-job-list-v1",
    });
    await expect(
      testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM public_browse_jobs"
      ).first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count
           FROM source_publication_policy_label_versions binding
           JOIN public_source_display_label_heads head
             ON head.source_key=binding.source_key
            AND head.current_version=binding.label_version
          WHERE binding.policy_version=1`
      ).first()
    ).resolves.toEqual({ count: 5 });
    await expect(
      testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM public_job_catalog_head_history"
      ).first()
    ).resolves.toEqual({ count: 3 });
  });

  it("blocks activation until the exact immutable catalog seal is complete", async () => {
    const current = await testEnv.DB.prepare(
      "SELECT version FROM public_job_catalog_head"
    ).first<{ version: string }>();
    if (!current) {
      throw new Error("Catalog head is missing");
    }
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO public_job_catalog_versions (
          version,predecessor_version,membership_hash,member_count,
          search_document_count,search_content_hash,search_term_count,
          location_facet_count,representation_updated_at,
          material_changed_at,search_index_version,created_at,ordinal
        )
        SELECT 'catalog:fabricated-empty',?,?,0,0,?,0,0,?,?,?,?,
               (SELECT COALESCE(MAX(version.ordinal),0)+1
                  FROM public_job_catalog_versions version)`
      ).bind(
        current.version,
        hash(7001),
        hash(7002),
        timestamp,
        timestamp,
        "search:fabricated-empty",
        timestamp
      ),
      testEnv.DB.prepare(
        `INSERT INTO public_job_catalog_seals (
          catalog_version,membership_hash,member_count,search_document_count,
          search_content_hash,search_term_count,location_facet_count,sealed_at
        ) VALUES ('catalog:fabricated-empty',?,0,0,?,0,0,?)`
      ).bind(hash(7001), hash(7002), timestamp),
    ]);
    await expect(
      testEnv.DB.prepare(
        `UPDATE public_job_catalog_head_pointer
            SET current_version='catalog:fabricated-empty',updated_at=?
          WHERE singleton=1`
      )
        .bind(timestamp)
        .run()
    ).rejects.toThrow(catalogSealMismatchPattern);

    const source = "public-read-activation-seal";
    await seedSource(source);
    const job = await seedPublishedJob({ index: 91, source });
    await expect(
      publishCatalog("seal-hash-mismatch", [job.publicId], {
        versionMembershipHash: hash(7002),
      })
    ).rejects.toThrow(catalogMembershipMismatchPattern);
    await expect(
      publishCatalog("seal-missing-search", [job.publicId], {
        omitSearch: true,
      })
    ).rejects.toThrow(searchCountPattern);
    await expect(
      publishCatalog("seal-missing-facets", [job.publicId], {
        omitFacets: true,
      })
    ).rejects.toThrow(locationFacetCountPattern);
  });

  it("applies required and optional field policy and suppresses malformed values", async () => {
    const source = "public-read-policy";
    await seedSource(source);
    const optionalSource = "public-read-optional-policy";
    await seedSource(optionalSource, [
      "title",
      "organization_name",
      "locations",
      "description",
    ]);
    const active = await seedPublishedJob({ index: 101, source });
    const optional = await seedPublishedJob({
      fields: ["title", "organization_name", "locations", "description"],
      index: 102,
      source: optionalSource,
    });
    const requiredSuppressed = await seedPublishedJob({
      fields: allFields.filter((field) => field !== "description"),
      index: 103,
      source,
    });
    const malformed = await seedPublishedJob({
      employmentTypesJson: '["FULL_TIME"]',
      index: 104,
      source,
    });
    const crossOrigin = await seedPublishedJob({
      index: 105,
      source,
      sourceUrl: "https://unapproved.example.test/jobs/105",
    });
    await testEnv.DB.prepare(
      `UPDATE job_listings SET source_url='https://mutated.example.test/jobs/101'
        WHERE id='listing-private-101'`
    ).run();

    expect(await candidateRow(requiredSuppressed.publicId)).toBeNull();
    const malformedRow = await candidateRow(malformed.publicId);
    if (!malformedRow) {
      throw new Error("Malformed candidate row is missing");
    }
    expect(() => serializePublicJobListItem(malformedRow)).toThrow();

    await publishCatalog("policy-shapes", [
      active.publicId,
      optional.publicId,
      crossOrigin.publicId,
    ]);
    const list = await readPublicJobList(
      testEnv.DB,
      request(new URLSearchParams("sort=recent"))
    );
    const listedIds = list.items.map(({ publicId }) => publicId);
    expect(listedIds).toContain(active.publicId);
    expect(listedIds).toContain(optional.publicId);
    expect(listedIds).toContain(crossOrigin.publicId);
    expect(listedIds).not.toContain(requiredSuppressed.publicId);
    expect(listedIds).not.toContain(malformed.publicId);

    const optionalItem = list.items.find(
      ({ publicId }) => publicId === optional.publicId
    );
    expect(optionalItem).toMatchObject({
      compensation: null,
      datePosted: null,
      employmentTypes: [],
      sources: [],
      validThrough: null,
    });
    expect(
      list.items.find(({ publicId }) => publicId === active.publicId)?.sources
    ).toEqual([
      {
        name: `Source ${source}`,
        url: `https://${source}.example.test/jobs/101`,
      },
    ]);
    expect(
      list.items.find(({ publicId }) => publicId === crossOrigin.publicId)
        ?.sources
    ).toEqual([{ name: `Source ${source}`, url: null }]);
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: active.publicId,
        slug: active.slug,
      })
    ).resolves.toMatchObject({
      data: {
        application: { available: true },
        descriptionHtml: expect.stringContaining("Teach English"),
        publicId: active.publicId,
        status: "active",
      },
      kind: "serve",
      noindex: false,
    });
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: requiredSuppressed.publicId,
        slug: requiredSuppressed.slug,
      })
    ).resolves.toEqual({ kind: "missing" });
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: malformed.publicId,
        slug: malformed.slug,
      })
    ).resolves.toEqual({ kind: "missing" });
  });

  it("suppresses mixed-source content when any contributor uses a disallowed field", async () => {
    const approvedSource = "public-read-mixed-policy-approved";
    const restrictedSource = "public-read-mixed-policy-restricted";
    await seedSource(approvedSource);
    await seedSource(
      restrictedSource,
      allFields.filter((field) => field !== "compensation")
    );
    const target = await seedPublishedJob({
      index: 111,
      source: approvedSource,
    });
    await seedPublishedJob({ index: 112, source: restrictedSource });
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO job_source_position_mapping_versions (
          source_position_id,version,predecessor_version,listing_id,
          listing_material_version,mapping_state,public_job_id,reason_code,
          mapping_hash,idempotency_key,created_at
        ) VALUES ('source-position-private-112',2,1,'listing-private-112',1,
          'mapped',?,'correction',?,'mapping-v2',?)`
      ).bind(target.publicId, hash(7112), timestamp),
      testEnv.DB.prepare(
        `UPDATE job_source_position_mapping_heads
            SET current_version=2,updated_at=?
          WHERE source_position_id='source-position-private-112'`
      ).bind(timestamp),
      testEnv.DB.prepare(
        `INSERT INTO public_job_eligibility_decisions (
          public_job_id,decision_version,predecessor_version,
          public_job_version,publication_state,route_disposition,
          browse_eligible,organic_index_eligible,job_posting_eligible,
          source_open_state,application_route_id,application_route_state,
          content_review_state,privacy_state,verified_at,
          redirect_public_job_id,reason_codes_json,decision_note,
          evaluator_kind,evaluator_version,decision_hash,idempotency_key,
          decided_at
        ) SELECT public_job_id,2,1,public_job_version,publication_state,
                 route_disposition,browse_eligible,organic_index_eligible,
                 job_posting_eligible,source_open_state,application_route_id,
                 application_route_state,content_review_state,privacy_state,
                 verified_at,redirect_public_job_id,reason_codes_json,
                 decision_note,evaluator_kind,evaluator_version,?,
                 'mixed-policy-v2',?
            FROM public_job_eligibility_decisions
           WHERE public_job_id=? AND decision_version=1`
      ).bind(hash(7111), timestamp, target.publicId),
      testEnv.DB.prepare(
        `INSERT INTO public_job_decision_sources (
          public_job_id,decision_version,source_position_id,
          source_mapping_version,source_key,policy_version,contribution_kind,
          fields_used_json,created_at
        ) SELECT public_job_id,2,source_position_id,source_mapping_version,
                 source_key,policy_version,contribution_kind,
                 fields_used_json,created_at
            FROM public_job_decision_sources
           WHERE public_job_id=? AND decision_version=1`
      ).bind(target.publicId),
      testEnv.DB.prepare(
        `INSERT INTO public_job_decision_sources (
          public_job_id,decision_version,source_position_id,
          source_mapping_version,source_key,policy_version,contribution_kind,
          fields_used_json,created_at
        ) VALUES (?,2,'source-position-private-112',2,?,1,
          'public_content','["compensation"]',?)`
      ).bind(target.publicId, restrictedSource, timestamp),
      testEnv.DB.prepare(
        `UPDATE public_job_eligibility_heads
            SET current_decision_version=2,updated_at=?
          WHERE public_job_id=?`
      ).bind(timestamp, target.publicId),
    ]);

    await expect(candidateRow(target.publicId)).resolves.toBeNull();
  });

  it("rejects a forged catalog payload before activation", async () => {
    const source = "public-read-forged-catalog";
    await seedSource(source);
    const job = await seedPublishedJob({ index: 151, source });
    await expect(
      publishCatalog("forged-item", [job.publicId], {
        itemValue: (item) => ({
          ...item,
          application: { available: false },
          publicId: makePublicId(9999),
          publicJobVersion: 2,
          sources: [
            ...item.sources,
            ...item.sources,
            { name: "Unapproved", url: "https://unapproved.example.test/" },
          ],
        }),
      })
    ).rejects.toThrow(payloadIdentityPattern);
  });

  it("rejects country and city facets that differ from pinned routing", async () => {
    const source = "public-read-forged-routing";
    await seedSource(source);
    const job = await seedPublishedJob({ index: 152, source });
    await expect(
      publishCatalog("forged-country-route", [job.publicId], {
        facetValue: (facet) => ({ ...facet, countrySlug: "korea" }),
      })
    ).rejects.toThrow(routingIdentityPattern);
    await expect(
      publishCatalog("forged-city-route", [job.publicId], {
        facetValue: (facet) => ({ ...facet, citySlug: "busan" }),
      })
    ).rejects.toThrow(routingIdentityPattern);
  });
});
