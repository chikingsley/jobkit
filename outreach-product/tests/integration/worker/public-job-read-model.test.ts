import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  derivePublicJobCatalogMembership,
  derivePublicJobCatalogSearch,
  derivePublicJobSearchEntry,
  type PublicJobCatalogLocationFacet,
  sealAndActivatePublicJobCatalog,
} from "../../../worker/public-jobs/catalog";
import {
  normalizePublicJobListRequest,
  PublicJobCursorError,
  PublicJobQueryError,
} from "../../../worker/public-jobs/query";
import {
  type PublicJobListItem,
  type PublicJobReadRow,
  serializePublicJobListItem,
} from "../../../worker/public-jobs/schemas";
import { publicJobDetailEtag } from "../../../worker/public-jobs/validators";
import {
  readPublicJobDetail,
  readPublicJobDetailWithMetadata,
  readPublicJobList,
  readPublicJobListWithMetadata,
  resolvePublicJobMarketScope,
} from "../../../worker/repositories/public-jobs";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;
const timestamp = "2026-07-22T12:00:00.000Z";
const cursorSecret = "public-cursor-integration-secret";
const activationSealPattern = /must precede activation/u;
const catalogSealMismatchPattern = /seal does not match version/u;
const locationFacetCountPattern = /location facet count/u;
const payloadIdentityPattern = /catalog item is invalid|payload identity/u;
const malformedCatalogItemPattern = /catalog item is invalid/u;
const malformedCatalogDetailPattern = /catalog detail is invalid/u;
const privateSearchContentPattern = /differs from its public member/u;
const routingIdentityPattern = /location facets do not match payload/u;
const searchCountPattern = /search count|does not match its search rows/u;
const searchRowsMismatchPattern = /does not match its search rows/u;
const catalogMembershipMismatchPattern =
  /does not match its derived membership/u;
const hashPattern = /^[0-9a-f]{64}$/u;
const searchImmutablePattern = /search rows are immutable/u;
const allFields = [
  "title",
  "organization_name",
  "locations",
  "description",
  "date_posted",
  "valid_through",
  "employment_types",
  "compensation",
  "source_name",
  "source_url",
];

interface CatalogCandidateRow extends PublicJobReadRow {
  detail_json: string;
  eligibility_decision_hash: string;
  eligibility_decision_version: number;
  item_json: string;
  public_content_hash: string;
  representation_updated_at: string;
}

interface PublishCatalogOptions {
  detailValue?: (detail: unknown) => unknown;
  facetValue?: (
    facet: PublicJobCatalogLocationFacet
  ) => PublicJobCatalogLocationFacet;
  itemValue?: (item: PublicJobListItem) => unknown;
  omitFacets?: boolean;
  omitSearch?: boolean;
  sealMembershipHash?: string;
  searchValue?: (
    search: ReturnType<typeof derivePublicJobSearchEntry>
  ) => ReturnType<typeof derivePublicJobSearchEntry>;
  versionMembershipHash?: string;
  versionSearchContentHash?: string;
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public job read model", () => {
  it("starts with one immutable empty catalog and publishes zero jobs", async () => {
    const response = await readPublicJobList(
      testEnv.DB,
      request(new URLSearchParams())
    );
    expect(response).toMatchObject({
      catalog: { version: "public-catalog-v0" },
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
    ).resolves.toEqual({ count: 1 });
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
          material_changed_at,search_index_version,created_at
        ) VALUES ('catalog:fabricated-empty',?,?,0,0,?,0,0,?,?,?,?)`
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

  it("rejects malformed members before activation and reports a truthful final page", async () => {
    const source = "public-read-malformed-member";
    await seedSource(source);
    const valid = await seedPublishedJob({ index: 161, source });
    const malformed = await seedPublishedJob({
      employmentTypesJson: '["FULL_TIME"]',
      index: 162,
      source,
    });
    const laterValid = await seedPublishedJob({ index: 163, source });
    await expect(
      publishCatalog("malformed-member", [
        valid.publicId,
        malformed.publicId,
        laterValid.publicId,
      ])
    ).rejects.toThrow(malformedCatalogItemPattern);
    await publishCatalog("valid-final-page", [
      valid.publicId,
      laterValid.publicId,
    ]);
    const finalPage = await readPublicJobList(
      testEnv.DB,
      request(new URLSearchParams("limit=2&sort=recent"))
    );
    expect(finalPage.items.map(({ publicId }) => publicId)).toEqual([
      valid.publicId,
      laterValid.publicId,
    ]);
    expect(finalPage.page).toEqual({ hasMore: false, nextCursor: null });
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: malformed.publicId,
        slug: malformed.slug,
      })
    ).resolves.toEqual({ kind: "missing" });
  });

  it("rejects catalog detail markup and private contacts before activation", async () => {
    const source = "public-read-private-detail";
    await seedSource(source);
    const job = await seedPublishedJob({ index: 164, source });

    await expect(
      publishCatalog("private-detail", [job.publicId], {
        detailValue: (detail) => ({
          ...(detail as Record<string, unknown>),
          descriptionHtml:
            "<script>alert(1)</script><p>Email recipient-private@example.test</p>",
        }),
      })
    ).rejects.toThrow(malformedCatalogDetailPattern);
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: job.publicId,
        slug: job.slug,
      })
    ).resolves.toEqual({ kind: "missing" });
  });

  it("keeps published search independent from mutable FTS state", async () => {
    const source = "public-read-search-authority";
    await seedSource(source);
    const job = await seedPublishedJob({ index: 171, source });
    await publishCatalog("search-authority", [job.publicId]);
    const search = () =>
      readPublicJobList(
        testEnv.DB,
        request(new URLSearchParams("q=Teacher+171&sort=relevance"))
      );

    await expect(search()).resolves.toMatchObject({
      items: [{ publicId: job.publicId }],
    });
    await expect(
      testEnv.DB.prepare(
        `INSERT INTO public_job_search_fts(rowid,search_document)
         VALUES (1,'forged external content')`
      ).run()
    ).rejects.toThrow();
    await expect(
      testEnv.DB.prepare(
        `UPDATE public_job_search_index
            SET search_document='forged mutable search'
          WHERE search_index_version='search:search-authority'`
      ).run()
    ).rejects.toThrow(searchImmutablePattern);
    await expect(search()).resolves.toMatchObject({
      items: [{ publicId: job.publicId }],
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT name FROM sqlite_master
          WHERE name='public_job_search_fts' LIMIT 1`
      ).first()
    ).resolves.toBeNull();
  });

  it("derives private-safe search content, rejects forged digests, and ranks deterministically", async () => {
    const source = "public-read-ranked-search";
    await seedSource(source);
    const titleMatch = await seedPublishedJob({
      index: 172,
      source,
      title: "Seoul English Teacher",
    });
    const locationMatch = await seedPublishedJob({ index: 173, source });
    const tiedMatch = await seedPublishedJob({ index: 174, source });
    await expect(
      publishCatalog("forged-search-digest", [titleMatch.publicId], {
        versionSearchContentHash: hash(7172),
      })
    ).rejects.toThrow(searchRowsMismatchPattern);
    await expect(
      publishCatalog("private-search-content", [titleMatch.publicId], {
        searchValue: (search) => ({
          ...search,
          searchDocument: `${search.searchDocument} recipient-private@example.test`,
        }),
      })
    ).rejects.toThrow(privateSearchContentPattern);

    await publishCatalog("ranked-search", [
      titleMatch.publicId,
      locationMatch.publicId,
      tiedMatch.publicId,
    ]);
    const ranked = await readPublicJobList(
      testEnv.DB,
      request(new URLSearchParams("q=seoul&sort=relevance"))
    );
    expect(ranked.items.map(({ publicId }) => publicId)).toEqual([
      titleMatch.publicId,
      locationMatch.publicId,
      tiedMatch.publicId,
    ]);
    expect(JSON.stringify(ranked)).not.toContain("recipient-private");
    const plan = await testEnv.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT public_job_id FROM public_job_search_terms
        WHERE search_index_version=? AND term=?`
    )
      .bind("search:ranked-search", "seoul")
      .all<{ detail: string }>();
    expect(plan.results.map(({ detail }) => detail).join(" ")).toContain(
      "idx_public_job_search_terms_lookup"
    );
  });

  it("exposes representation metadata only through server read helpers", async () => {
    const source = "public-read-server-metadata";
    await seedSource(source);
    const job = await seedPublishedJob({ index: 181, source });
    await publishCatalog("server-metadata", [job.publicId]);
    const listRequest = request(new URLSearchParams("q=Teacher+181"));
    const list = await readPublicJobListWithMetadata(testEnv.DB, listRequest);

    expect(list.metadata).toEqual({
      cursor: null,
      membershipHash: expect.stringMatching(hashPattern),
      queryHash: expect.stringMatching(hashPattern),
      representationUpdatedAt: timestamp,
    });
    expect(Object.keys(list.data.catalog).sort()).toEqual([
      "materialChangedAt",
      "searchIndexVersion",
      "version",
    ]);
    expect(JSON.stringify(list.data)).not.toContain("membershipHash");
    expect(JSON.stringify(list.data)).not.toContain("queryHash");

    const detail = await readPublicJobDetailWithMetadata(testEnv.DB, {
      publicId: job.publicId,
      slug: job.slug,
    });
    expect(detail).toMatchObject({
      kind: "serve",
      metadata: {
        canonicalPath: `/job/${job.publicId}/${job.slug}`,
        eligibilityDecisionHash: expect.stringMatching(hashPattern),
        publicContentHash: expect.stringMatching(hashPattern),
        representationUpdatedAt: timestamp,
      },
    });
    const publicDetail = await readPublicJobDetail(testEnv.DB, {
      publicId: job.publicId,
      slug: job.slug,
    });
    expect(publicDetail).not.toHaveProperty("metadata");
    expect(publicDetail).not.toHaveProperty("publicContentHash");
  });

  it("resolves active, closed, historical, merged, gone, and unknown routes", async () => {
    const source = "public-read-routes";
    await seedSource(source);
    const winner = await seedPublishedJob({
      aliases: ["old-winner-role"],
      index: 201,
      source,
    });
    const closed = await seedPublishedJob({ index: 202, source });
    const gone = await seedPublishedJob({ index: 203, source });
    const loser = await seedPublishedJob({ index: 204, source });
    const goneLoser = await seedPublishedJob({ index: 205, source });
    const neverCataloged = await seedPublishedJob({ index: 206, source });
    await publishCatalog("routes-active", [
      winner.publicId,
      closed.publicId,
      gone.publicId,
      loser.publicId,
      goneLoser.publicId,
    ]);
    await appendTerminalDecision(closed.publicId, "closed", null);
    await appendTerminalDecision(gone.publicId, "gone", null);
    await appendTerminalDecision(loser.publicId, "merged", winner.publicId);
    await appendTerminalDecision(goneLoser.publicId, "merged", gone.publicId);
    await appendTerminalDecision(neverCataloged.publicId, "gone", null);
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: closed.publicId,
        slug: closed.slug,
      })
    ).resolves.toMatchObject({ data: { status: "active" }, kind: "serve" });
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: gone.publicId,
        slug: gone.slug,
      })
    ).resolves.toMatchObject({ data: { status: "active" }, kind: "serve" });
    await publishCatalog("routes-terminal", [winner.publicId]);

    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: winner.publicId,
        slug: "old-winner-role",
      })
    ).resolves.toEqual({
      kind: "redirect",
      targetPath: `/job/${winner.publicId}/${winner.slug}`,
    });
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: winner.publicId,
        slug: "invented-role",
      })
    ).resolves.toEqual({ kind: "missing" });
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: closed.publicId,
        slug: closed.slug,
      })
    ).resolves.toMatchObject({
      data: {
        application: { available: false },
        status: "closed",
      },
      kind: "serve",
      noindex: true,
    });
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: gone.publicId,
        slug: gone.slug,
      })
    ).resolves.toEqual({ kind: "gone" });
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: loser.publicId,
        slug: loser.slug,
      })
    ).resolves.toEqual({
      kind: "redirect",
      targetPath: `/job/${winner.publicId}/${winner.slug}`,
    });
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: goneLoser.publicId,
        slug: goneLoser.slug,
      })
    ).resolves.toEqual({ kind: "gone" });
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: neverCataloged.publicId,
        slug: neverCataloged.slug,
      })
    ).resolves.toEqual({ kind: "missing" });
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: makePublicId(999),
        slug: "unknown-role",
      })
    ).resolves.toEqual({ kind: "missing" });
  });

  it("resolves detail lifecycle and content in one D1 statement", async () => {
    const source = "public-read-single-detail-statement";
    await seedSource(source);
    const job = await seedPublishedJob({ index: 251, source });
    await publishCatalog("single-detail-active", [job.publicId]);
    await appendTerminalDecision(job.publicId, "closed", null);
    await publishCatalog("single-detail-closed", []);
    let prepareCount = 0;
    const countingDb = {
      prepare(query: string) {
        prepareCount += 1;
        return testEnv.DB.prepare(query);
      },
    } satisfies Pick<D1Database, "prepare">;

    await expect(
      readPublicJobDetail(countingDb, {
        publicId: job.publicId,
        slug: job.slug,
      })
    ).resolves.toMatchObject({
      data: { status: "closed" },
      kind: "serve",
      noindex: true,
    });
    expect(prepareCount).toBe(1);
  });

  it("changes retained-closed validators with the terminal decision", async () => {
    const source = "public-read-closed-validators";
    const closedAt = "2026-07-23T12:00:00.000Z";
    await seedSource(source);
    const job = await seedPublishedJob({ index: 252, source });
    await publishCatalog("closed-validators-active", [job.publicId]);
    const active = await readPublicJobDetailWithMetadata(testEnv.DB, {
      publicId: job.publicId,
      slug: job.slug,
    });
    if (active.kind !== "serve") {
      throw new Error("Active public detail is missing");
    }
    const activeEtag = await publicJobDetailEtag(active.metadata);

    await appendTerminalDecision(job.publicId, "closed", null, closedAt);
    await publishCatalog("closed-validators-terminal", []);
    const closed = await readPublicJobDetailWithMetadata(testEnv.DB, {
      publicId: job.publicId,
      slug: job.slug,
    });
    if (closed.kind !== "serve") {
      throw new Error("Retained closed public detail is missing");
    }
    const closedDecision = await testEnv.DB.prepare(
      `SELECT decision_hash,decided_at
         FROM public_job_eligibility_decisions
        WHERE public_job_id=? AND decision_version=2`
    )
      .bind(job.publicId)
      .first<{ decided_at: string; decision_hash: string }>();
    const closedEtag = await publicJobDetailEtag(closed.metadata);

    expect(closed.data).toMatchObject({
      application: { available: false },
      status: "closed",
    });
    expect(closed.metadata).toMatchObject({
      eligibilityDecisionHash: closedDecision?.decision_hash,
      representationUpdatedAt: closedDecision?.decided_at,
    });
    expect(closed.metadata.eligibilityDecisionHash).not.toBe(
      active.metadata.eligibilityDecisionHash
    );
    expect(closed.metadata.representationUpdatedAt).not.toBe(
      active.metadata.representationUpdatedAt
    );
    expect(closedEtag).not.toBe(activeEtag);
  });

  it("serves coordinates and bounds from the immutable location snapshot", async () => {
    const source = "public-read-location-snapshot";
    await seedSource(source);
    const job = await seedPublishedJob({ index: 261, source });
    await publishCatalog("location-snapshot", [job.publicId]);
    await testEnv.DB.prepare(
      `UPDATE canonical_locations
          SET latitude=1,longitude=2,bounds_json='[0,0,3,3]',updated_at=?
        WHERE id=?`
    )
      .bind(timestamp, "location-private-261")
      .run();

    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: job.publicId,
        slug: job.slug,
      })
    ).resolves.toMatchObject({
      data: {
        locations: [
          {
            bounds: [126.8, 37.4, 127.1, 37.7],
            coordinates: { latitude: 37.5665, longitude: 126.978 },
          },
        ],
      },
      kind: "serve",
    });
  });

  it("pins list membership, validates keyset cursors, and excludes private sentinels", async () => {
    const source = "public-read-cursors";
    await seedSource(source);
    const first = await seedPublishedJob({ index: 301, source });
    const second = await seedPublishedJob({ index: 302, source });
    await publishCatalog("cursor-page", [first.publicId, second.publicId]);
    await expect(
      resolvePublicJobMarketScope(testEnv.DB, {
        countrySlug: "south-korea",
      })
    ).resolves.toEqual({
      countryCode: "KR",
      countrySlug: "south-korea",
      kind: "country",
    });
    await expect(
      resolvePublicJobMarketScope(testEnv.DB, {
        citySlug: "seoul",
        countrySlug: "south-korea",
      })
    ).resolves.toEqual({
      citySlug: "seoul",
      countryCode: "KR",
      countrySlug: "south-korea",
      displayName: "Seoul, South Korea",
      kind: "city",
    });
    await expect(
      resolvePublicJobMarketScope(testEnv.DB, {
        citySlug: "invented-city",
        countrySlug: "south-korea",
      })
    ).resolves.toBeNull();
    const outsider = await seedPublishedJob({ index: 303, source });
    const outsiderRow = await catalogCandidateRow(outsider.publicId);
    if (!outsiderRow) {
      throw new Error("Post-activation catalog candidate is missing");
    }
    const outsiderItem = JSON.parse(outsiderRow.item_json) as PublicJobListItem;
    await expect(
      testEnv.DB.prepare(
        `INSERT INTO public_job_catalog_members (
          catalog_version,public_job_id,public_job_version,
          eligibility_decision_version,item_json,detail_json,public_content_hash,
          eligibility_decision_hash,location_facets_json,
          representation_updated_at,created_at
        ) VALUES ('catalog:cursor-page',?,1,1,?,?,?,?,?,?,?)`
      )
        .bind(
          outsider.publicId,
          JSON.stringify(outsiderItem),
          outsiderRow.detail_json,
          hash(303),
          hash(304),
          JSON.stringify([
            {
              citySlug: "seoul",
              countryCode: "KR",
              countrySlug: "south-korea",
              displayName: "Seoul, South Korea",
              role: "worksite",
            },
          ]),
          timestamp,
          timestamp
        )
        .run()
    ).rejects.toThrow(activationSealPattern);
    await expect(
      testEnv.DB.prepare(
        `INSERT INTO public_job_search_index (
          public_job_id,public_job_version,search_index_version,
          search_document,search_terms_json,title_sort_key,effective_recency,
          conservative_hourly_usd,created_at
        ) VALUES (?,1,'search:cursor-page','outsider',
          '[{"term":"outsider","score":1}]','outsider',?,?,?)`
      )
        .bind(outsider.publicId, timestamp, null, timestamp)
        .run()
    ).rejects.toThrow(activationSealPattern);
    await expect(
      testEnv.DB.prepare(
        `INSERT INTO public_browse_job_locations (
          catalog_version,public_job_id,public_job_version,ordinal,
          location_role,country_code,country_slug,city_slug,display_name,
          created_at
        ) VALUES ('catalog:cursor-page',?,1,99,'worksite','KR',
          'south-korea','seoul','Seoul',?)`
      )
        .bind(first.publicId, timestamp)
        .run()
    ).rejects.toThrow(activationSealPattern);

    const normalized = normalizePublicJobListRequest(
      new URLSearchParams(
        "country=kr&country=US&workplace=onsite&limit=1&sort=recent&ignored=private"
      )
    );
    expect(normalized.query).toMatchObject({
      country: "KR",
      limit: 1,
      sort: "recent",
      workplace: "onsite",
    });
    const searched = await readPublicJobList(
      testEnv.DB,
      request(
        new URLSearchParams(
          "q=Teacher+302&employmentType=fullTime&compensation=stated&sort=relevance"
        )
      )
    );
    expect(searched.items.map(({ publicId }) => publicId)).toEqual([
      second.publicId,
    ]);
    const titleSorted = await readPublicJobList(
      testEnv.DB,
      request(new URLSearchParams("sort=title"))
    );
    expect(titleSorted.items.slice(-2).map(({ publicId }) => publicId)).toEqual(
      [first.publicId, second.publicId]
    );
    const hourlySorted = await readPublicJobList(
      testEnv.DB,
      request(new URLSearchParams("sort=hourlyUsd"))
    );
    expect(hourlySorted.items.map(({ publicId }) => publicId)).toEqual([
      first.publicId,
      second.publicId,
    ]);
    const negotiable = await readPublicJobList(
      testEnv.DB,
      request(new URLSearchParams("compensation=negotiable"))
    );
    expect(negotiable.items).toEqual([]);
    const cityRequest = normalizePublicJobListRequest(
      new URLSearchParams("country=US"),
      {
        citySlug: "seoul",
        countryCode: "KR",
        countrySlug: "south-korea",
        displayName: "Seoul",
        kind: "city",
      }
    );
    expect(cityRequest.query.country).toBeNull();
    const cityList = await readPublicJobList(testEnv.DB, {
      ...cityRequest,
      cursorSecret,
    });
    expect(cityList.items.map(({ publicId }) => publicId)).toEqual([
      first.publicId,
      second.publicId,
    ]);
    const firstPage = await readPublicJobList(testEnv.DB, {
      ...normalized,
      cursorSecret,
    });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.page).toMatchObject({ hasMore: true });
    expect(firstPage.page.nextCursor).toEqual(expect.any(String));
    const { nextCursor } = firstPage.page;
    if (!nextCursor) {
      throw new Error("First page cursor is missing");
    }
    const secondPage = await readPublicJobList(
      testEnv.DB,
      request(
        new URLSearchParams(
          `country=kr&workplace=onsite&limit=1&sort=recent&cursor=${encodeURIComponent(nextCursor)}`
        )
      )
    );
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.publicId).not.toBe(
      firstPage.items[0]?.publicId
    );

    const firstDetail = await readPublicJobDetail(testEnv.DB, {
      publicId: first.publicId,
      slug: first.slug,
    });
    const serialized = JSON.stringify([
      ...firstPage.items,
      ...secondPage.items,
      firstDetail,
    ]);
    for (const sentinel of [
      "recipient-private-301@example.test",
      "candidate-private-301",
      "private-document-301.pdf",
      "private-gmail-thread-301",
      "source-position-private-301",
      "organization-private-301",
      "location-private-301",
      "mapbox-private-301",
      "route-private-301",
      "apply-private.example.test/301",
      "employer-private-301",
      "reference-private-301",
      "listing-private-301",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }

    const tampered = `${nextCursor.slice(0, -1)}x`;
    await expect(
      readPublicJobList(
        testEnv.DB,
        request(
          new URLSearchParams(
            `country=kr&workplace=onsite&limit=1&sort=recent&cursor=${encodeURIComponent(tampered)}`
          )
        )
      )
    ).rejects.toMatchObject({ code: "invalid" });

    await appendTerminalDecision(first.publicId, "closed", null);
    await publishCatalog("cursor-expiry", [second.publicId]);
    await expect(
      readPublicJobList(
        testEnv.DB,
        request(
          new URLSearchParams(
            `country=kr&workplace=onsite&limit=1&sort=recent&cursor=${encodeURIComponent(nextCursor)}`
          )
        )
      )
    ).rejects.toMatchObject({ code: "stale" });
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: first.publicId,
        slug: first.slug,
      })
    ).resolves.toMatchObject({
      data: { application: { available: false }, status: "closed" },
      kind: "serve",
    });
  });

  it("keeps activated list and detail bytes stable across mutable source drift", async () => {
    const source = "public-read-current-drift";
    await seedSource(source);
    const inventoryDrift = await seedPublishedJob({ index: 371, source });
    const materialDrift = await seedPublishedJob({ index: 372, source });
    const mappingDrift = await seedPublishedJob({ index: 373, source });
    await publishCatalog("current-drift", [
      inventoryDrift.publicId,
      materialDrift.publicId,
      mappingDrift.publicId,
    ]);
    const before = await readPublicJobListWithMetadata(
      testEnv.DB,
      request(new URLSearchParams("limit=1&sort=recent"))
    );

    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `UPDATE job_listings SET inventory_status='closed',updated_at=?
          WHERE id='listing-private-371'`
      ).bind(timestamp),
      testEnv.DB.prepare(
        `INSERT INTO job_listing_versions (
          listing_id,material_version,material_hash,material_hash_version,
          material_json,source_posted_date,source_posted_date_raw,
          source_posted_date_provenance,source_expiry_date,
          source_expiry_date_raw,source_expiry_date_provenance,created_at
        ) VALUES ('listing-private-372',2,?,1,'{}','2026-07-01','',
          'board-published','2099-12-31','','board-published',?)`
      ).bind(hash(7372), timestamp),
      testEnv.DB.prepare(
        `UPDATE job_listings
            SET material_version=2,material_hash=?,material_changed_at=?,
                updated_at=?
          WHERE id='listing-private-372'`
      ).bind(hash(7372), timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO job_source_position_mapping_versions (
          source_position_id,version,predecessor_version,listing_id,
          listing_material_version,mapping_state,public_job_id,reason_code,
          mapping_hash,idempotency_key,created_at
        ) VALUES ('source-position-private-373',2,1,'listing-private-373',1,
          'mapped',?,'correction',?,'mapping-v2',?)`
      ).bind(mappingDrift.publicId, hash(7373), timestamp),
      testEnv.DB.prepare(
        `UPDATE job_source_position_mapping_heads
            SET current_version=2,updated_at=?
          WHERE source_position_id='source-position-private-373'`
      ).bind(timestamp),
    ]);

    const after = await readPublicJobListWithMetadata(
      testEnv.DB,
      request(new URLSearchParams("limit=1&sort=recent"))
    );
    expect(after).toEqual(before);
    for (const job of [inventoryDrift, materialDrift, mappingDrift]) {
      // biome-ignore lint/performance/noAwaitInLoops: each route proves one independent pinned representation.
      await expect(
        readPublicJobDetail(testEnv.DB, {
          publicId: job.publicId,
          slug: job.slug,
        })
      ).resolves.toMatchObject({
        data: { publicId: job.publicId, status: "active" },
        kind: "serve",
      });
    }
  });

  it("invalidates the catalog immediately when a source policy rotates", async () => {
    const source = "public-read-rotation";
    await seedSource(source);
    const job = await seedPublishedJob({ index: 401, source });
    await publishCatalog("before-policy-rotation", [job.publicId]);
    const before = await readPublicJobList(
      testEnv.DB,
      request(new URLSearchParams("limit=1"))
    );
    expect(before.items.some(({ publicId }) => publicId === job.publicId)).toBe(
      true
    );

    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO source_publication_policy_versions (
          source_key,version,predecessor_version,approval_state,
          publication_scope,publication_enabled,allowed_fields_json,
          attribution_mode,max_verbatim_chars,source_origin_url,terms_url,
          terms_checked_at,robots_url,robots_checked_at,evidence_json,
          decision_note,policy_hash,idempotency_key,created_at
        ) VALUES (?,2,1,'revoked','blocked',0,'[]','none',0,'','',NULL,'',NULL,
          '{}','rotation',?,'policy-v2',?)`
      ).bind(source, hash(402), timestamp),
      testEnv.DB.prepare(
        `UPDATE source_publication_policy_heads
            SET current_version=2,updated_at=?
          WHERE source_key=?`
      ).bind(timestamp, source),
    ]);
    const after = await readPublicJobList(
      testEnv.DB,
      request(new URLSearchParams())
    );
    expect(after.items).toEqual([]);
    expect(after.catalog.version).toBe(`policy-invalidation:${source}:2`);
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: job.publicId,
        slug: job.slug,
      })
    ).resolves.toEqual({ kind: "missing" });
  });

  it("invalidates list and detail reads when a source label rotates", async () => {
    const source = "public-read-label-rotation";
    await seedSource(source);
    const job = await seedPublishedJob({ index: 451, source });
    await publishCatalog("before-label-rotation", [job.publicId]);

    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO public_source_display_label_versions (
          source_key,version,predecessor_version,display_label,created_at
        ) VALUES (?,2,1,'Rotated source label',?)`
      ).bind(source, timestamp),
      testEnv.DB.prepare(
        `UPDATE public_source_display_label_heads
            SET current_version=2,updated_at=?
          WHERE source_key=?`
      ).bind(timestamp, source),
    ]);

    const list = await readPublicJobList(
      testEnv.DB,
      request(new URLSearchParams())
    );
    expect(list.items).toEqual([]);
    expect(list.catalog.version).toBe(`label-invalidation:${source}:2`);
    await expect(
      readPublicJobDetail(testEnv.DB, {
        publicId: job.publicId,
        slug: job.slug,
      })
    ).resolves.toEqual({ kind: "missing" });
  });

  it("normalizes query bounds and rejects oversized search and cursor input", () => {
    expect(
      normalizePublicJobListRequest(
        new URLSearchParams(
          "q=%EF%BC%A5nglish%20%20teacher&sort=relevance&limit=999"
        )
      ).query
    ).toMatchObject({ limit: 50, q: "English teacher", sort: "relevance" });
    expect(
      normalizePublicJobListRequest(new URLSearchParams("sort=relevance")).query
        .sort
    ).toBe("recent");
    expect(() =>
      normalizePublicJobListRequest(new URLSearchParams({ q: "x".repeat(121) }))
    ).toThrow(PublicJobQueryError);
    expect(() =>
      normalizePublicJobListRequest(
        new URLSearchParams({ cursor: "x".repeat(1025) })
      )
    ).toThrow(PublicJobQueryError);
    expect(new PublicJobCursorError("stale").code).toBe("stale");
  });
});

function request(parameters: URLSearchParams) {
  return {
    ...normalizePublicJobListRequest(parameters),
    cursorSecret,
  };
}

async function seedSource(source: string, allowedFields = allFields) {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO public_source_display_label_versions (
        source_key,version,predecessor_version,display_label,created_at
      ) VALUES (?,1,NULL,?,?)`
    ).bind(source, `Source ${source}`, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_source_display_label_heads (
        source_key,current_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(source, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO source_publication_policy_versions (
        source_key,version,predecessor_version,approval_state,
        publication_scope,publication_enabled,allowed_fields_json,
        attribution_mode,max_verbatim_chars,source_origin_url,terms_url,
        terms_checked_at,robots_url,robots_checked_at,evidence_json,
        decision_note,policy_hash,idempotency_key,created_at
      ) VALUES (?,1,NULL,'approved','fact_summary',1,?,'source_link',5000,
        ?,'',NULL,'',NULL,'{}','integration policy',?,'policy-v1',?)`
    ).bind(
      source,
      JSON.stringify(allowedFields),
      `https://${source}.example.test/`,
      hash(source.length),
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO source_publication_policy_heads (
        source_key,current_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(source, timestamp),
  ]);
}

async function seedPublishedJob(input: {
  aliases?: string[];
  employmentTypesJson?: string;
  fields?: string[];
  index: number;
  source: string;
  sourceUrl?: string;
  title?: string;
}) {
  const publicJobId = makePublicId(input.index);
  const slug = `english-teacher-${input.index}`;
  const listingId = `listing-private-${input.index}`;
  const organizationId = `organization-private-${input.index}`;
  const locationId = `location-private-${input.index}`;
  const positionId = `source-position-private-${input.index}`;
  const routeId = `route-private-${input.index}`;
  const fields = input.fields ?? allFields;
  const title = input.title ?? `English Teacher ${input.index}`;
  const sourceUrl =
    input.sourceUrl ??
    `https://${input.source}.example.test/jobs/${input.index}`;
  const materialJson = JSON.stringify({ sourceUrl });
  const compensation = {
    amount: {
      currency: "USD",
      maximum: 35,
      minimum: 30,
      period: "hour",
      qualifier: "range",
      taxBasis: "gross",
    },
    hourlyUsd: {
      basis: "listed",
      fxAsOf: "2026-07-22",
      maximum: 35,
      minimum: 30,
      taxBasis: "gross",
    },
    kind: "amount",
  };
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_listings (
        id,board,title,company,contact_name,country,location,salary,
        description,source_url,apply_url,employer_id,source_reference,
        first_seen_at,updated_at,inventory_status,material_hash,
        material_hash_version,material_version,material_changed_at,
        source_posted_date,source_posted_date_provenance
      ) VALUES (?,?,?,?,?,'KR','Seoul','private salary',?,?,?,?,?,?,?,
        'active',?,1,1,?,'2026-07-01','board-published')`
    ).bind(
      listingId,
      input.source,
      title,
      `School ${input.index}`,
      `candidate-private-${input.index}`,
      `raw private description private-document-${input.index}.pdf private-gmail-thread-${input.index}`,
      sourceUrl,
      `https://apply-private.example.test/${input.index}`,
      `employer-private-${input.index}`,
      `reference-private-${input.index}`,
      timestamp,
      timestamp,
      hash(input.index),
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO job_listing_versions (
        listing_id,material_version,material_hash,material_hash_version,
        material_json,source_posted_date,source_posted_date_raw,
        source_posted_date_provenance,source_expiry_date,
        source_expiry_date_raw,source_expiry_date_provenance,created_at
      ) VALUES (?,1,?,1,?,'2026-07-01','','board-published',
        '2099-12-31','','board-published',?)`
    ).bind(listingId, hash(input.index), materialJson, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO organizations (
        id,country_code,country_name,name,identity_key,city,region,
        website_url,canonical_domain,market_segment,status,
        outreach_eligibility,evidence_url,last_verified_at,created_at,updated_at
      ) VALUES (?,'KR','South Korea',?,?,'Seoul','',?,'','school','active',
        'eligible','',?,?,?)`
    ).bind(
      organizationId,
      `School ${input.index}`,
      `organization-key-${input.index}`,
      `https://organization-private-${input.index}.example.test`,
      timestamp,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO application_routes (
        id,job_id,kind,destination,source_evidence,last_verified_at,status,
        created_at,updated_at
      ) VALUES (?,?,'email',?,'private evidence',?,'active',?,?)`
    ).bind(
      routeId,
      listingId,
      `recipient-private-${input.index}@example.test`,
      timestamp,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO canonical_locations (
        id,resolution_state,input_label,display_name,country_code,region,
        locality,provider,provider_place_id,latitude,longitude,
        resolution_evidence_json,created_at,updated_at
      ) VALUES (?,'resolved','Seoul','Seoul, South Korea','KR','Seoul',
        'Seoul','mapbox',?,37.5665,126.978,'{}',?,?)`
    ).bind(locationId, `mapbox-private-${input.index}`, timestamp, timestamp),
    testEnv.DB.prepare(
      "INSERT INTO public_jobs(id,created_at) VALUES (?,?)"
    ).bind(publicJobId, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_aliases(public_job_id,slug,created_at)
       VALUES (?,?,?)`
    ).bind(publicJobId, slug, timestamp),
    ...(input.aliases ?? []).map((alias) =>
      testEnv.DB.prepare(
        `INSERT INTO public_job_aliases(public_job_id,slug,created_at)
         VALUES (?,?,?)`
      ).bind(publicJobId, alias, timestamp)
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_job_versions (
        public_job_id,version,predecessor_version,canonical_slug,title,
        organization_id,organization_name,organization_resolution_state,
        workplace_type,date_posted,date_posted_provenance,valid_through,
        valid_through_provenance,employment_types_json,compensation_json,
        description_html,public_content_hash,public_content_hash_version,
        material_changed_at,content_schema_version,producer_kind,producer_id,
        idempotency_key,created_at
      ) VALUES (?,1,NULL,?,?,? ,?,'resolved','onsite','2026-07-01',
        'employer-original','2099-12-31','employer-original',?,?,?, ?,1,?,1,
        'deterministic','integration','content-v1',?)`
    ).bind(
      publicJobId,
      slug,
      title,
      organizationId,
      `School ${input.index}`,
      input.employmentTypesJson ?? '["fullTime"]',
      JSON.stringify(compensation),
      `<section><h2>Overview</h2><p>Teach English in Seoul ${input.index}.</p></section>`,
      hash(input.index + 1),
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_job_version_locations (
        public_job_id,public_job_version,ordinal,location_role,location_id,
        resolution_state,display_name,country_code,region,locality,postal_code,
        location_json,created_at
      ) VALUES (?,1,0,'worksite',?,'resolved','Seoul, South Korea','KR',
        'Seoul','Seoul','',? ,?)`
    ).bind(
      publicJobId,
      locationId,
      JSON.stringify({
        bounds: [126.8, 37.4, 127.1, 37.7],
        coordinateKind: "point",
        coordinates: { latitude: 37.5665, longitude: 126.978 },
        routing: { citySlug: "seoul", countrySlug: "south-korea" },
        scope: "locality",
      }),
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_job_heads(public_job_id,current_version,updated_at)
       VALUES (?,1,?)`
    ).bind(publicJobId, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO job_source_positions (
        id,listing_id,source_key,position_key,position_kind,created_at
      ) VALUES (?,?,?,'direct','direct',?)`
    ).bind(positionId, listingId, input.source, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO job_source_position_mapping_versions (
        source_position_id,version,predecessor_version,listing_id,
        listing_material_version,mapping_state,public_job_id,reason_code,
        mapping_hash,idempotency_key,created_at
      ) VALUES (?,1,NULL,?,1,'mapped',?,'initial',?,'mapping-v1',?)`
    ).bind(
      positionId,
      listingId,
      publicJobId,
      hash(input.index + 2),
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO job_source_position_mapping_heads (
        source_position_id,current_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(positionId, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_eligibility_decisions (
        public_job_id,decision_version,predecessor_version,public_job_version,
        publication_state,route_disposition,browse_eligible,
        organic_index_eligible,job_posting_eligible,source_open_state,
        application_route_id,application_route_state,content_review_state,
        privacy_state,verified_at,redirect_public_job_id,reason_codes_json,
        decision_note,evaluator_kind,evaluator_version,decision_hash,
        idempotency_key,decided_at
      ) VALUES (?,1,NULL,1,'published','serve',1,1,1,'open',?,'valid',
        'approved','passed',?,NULL,'["integration"]','integration','system',
        'v1',?,'decision-v1',?)`
    ).bind(publicJobId, routeId, timestamp, hash(input.index + 3), timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_decision_sources (
        public_job_id,decision_version,source_position_id,
        source_mapping_version,source_key,policy_version,contribution_kind,
        fields_used_json,created_at
      ) VALUES (?,1,?,1,?,1,'public_content',?,?)`
    ).bind(
      publicJobId,
      positionId,
      input.source,
      JSON.stringify(fields),
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_job_eligibility_heads (
        public_job_id,current_decision_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(publicJobId, timestamp),
  ]);
  return { publicId: publicJobId, slug };
}

async function appendTerminalDecision(
  publicJobId: string,
  state: "closed" | "gone" | "merged",
  redirectPublicJobId: string | null,
  decidedAt = timestamp
) {
  let routeDisposition: "gone" | "redirect" | "retain_noindex" =
    "retain_noindex";
  if (state === "merged") {
    routeDisposition = "redirect";
  } else if (state === "gone") {
    routeDisposition = "gone";
  }
  const publicationState = state === "merged" ? "merged" : "closed";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO public_job_eligibility_decisions (
        public_job_id,decision_version,predecessor_version,public_job_version,
        publication_state,route_disposition,browse_eligible,
        organic_index_eligible,job_posting_eligible,source_open_state,
        application_route_id,application_route_state,content_review_state,
        privacy_state,verified_at,redirect_public_job_id,reason_codes_json,
        decision_note,evaluator_kind,evaluator_version,decision_hash,
        idempotency_key,decided_at
      ) VALUES (?,2,1,1,?,?,0,0,0,'closed',NULL,'unresolved','approved',
        'passed',?,?, '["lifecycle"]','lifecycle','system','v1',?,
        'decision-v2',?)`
    ).bind(
      publicJobId,
      publicationState,
      routeDisposition,
      timestamp,
      redirectPublicJobId,
      hash(Number.parseInt(publicJobId.slice(-4), 16) + 4),
      decidedAt
    ),
    ...(state === "closed"
      ? [
          testEnv.DB.prepare(
            `INSERT INTO public_job_decision_sources (
              public_job_id,decision_version,source_position_id,
              source_mapping_version,source_key,policy_version,
              contribution_kind,fields_used_json,created_at
            )
            SELECT public_job_id,2,source_position_id,source_mapping_version,
                   source_key,policy_version,contribution_kind,
                   fields_used_json,created_at
              FROM public_job_decision_sources
             WHERE public_job_id=? AND decision_version=1`
          ).bind(publicJobId),
        ]
      : []),
    testEnv.DB.prepare(
      `UPDATE public_job_eligibility_heads
          SET current_decision_version=2,updated_at=?
        WHERE public_job_id=?`
    ).bind(timestamp, publicJobId),
  ]);
}

async function publishCatalog(
  label: string,
  publicJobIds: string[],
  options: PublishCatalogOptions = {}
) {
  const head = await testEnv.DB.prepare(
    "SELECT version FROM public_job_catalog_head"
  ).first<{ version: string }>();
  if (!head) {
    throw new Error("Catalog head is missing");
  }
  const catalogVersion = `catalog:${label}`;
  const searchVersion = `search:${label}`;
  const candidates: Array<{
    candidate: CatalogCandidateRow;
    detailJson: string;
    facets: PublicJobCatalogLocationFacet[];
    item: PublicJobListItem;
    itemJson: string;
    search: ReturnType<typeof derivePublicJobSearchEntry>;
  }> = [];
  for (const publicJobId of publicJobIds) {
    // biome-ignore lint/performance/noAwaitInLoops: the fixture reads each immutable candidate before sealing one catalog.
    const candidate = await catalogCandidateRow(publicJobId);
    if (!candidate) {
      throw new Error(`Catalog candidate is missing: ${publicJobId}`);
    }
    const item = JSON.parse(candidate.item_json) as PublicJobListItem;
    const detailJson = options.detailValue
      ? JSON.stringify(
          options.detailValue(JSON.parse(candidate.detail_json) as unknown)
        )
      : candidate.detail_json;
    const itemJson = options.itemValue
      ? JSON.stringify(options.itemValue(item))
      : candidate.item_json;
    const facets = item.locations.map((location) => {
      const facet = {
        citySlug:
          location.locality === null ? null : slugify(location.locality),
        countryCode: location.countryCode,
        countrySlug: countrySlug(location.countryCode),
        displayName: location.displayName,
        role: location.role === "applicantArea" ? "applicant_area" : "worksite",
      } as const satisfies PublicJobCatalogLocationFacet;
      return options.facetValue ? options.facetValue(facet) : facet;
    });
    const search = derivePublicJobSearchEntry(item);
    candidates.push({
      candidate,
      detailJson,
      facets,
      item,
      itemJson,
      search: options.searchValue ? options.searchValue(search) : search,
    });
  }
  const membership = await derivePublicJobCatalogMembership(
    candidates.map(({ candidate, detailJson, facets, itemJson }) => ({
      detailJson,
      eligibilityDecisionHash: candidate.eligibility_decision_hash,
      eligibilityDecisionVersion: candidate.eligibility_decision_version,
      itemJson,
      locationFacets: facets,
      publicContentHash: candidate.public_content_hash,
      publicJobId: candidate.public_job_id,
      publicJobVersion: candidate.public_job_version,
    }))
  );
  const search = await derivePublicJobCatalogSearch(
    candidates.map(({ candidate, item, search: derived }) => ({
      ...derived,
      publicJobId: candidate.public_job_id,
      publicJobVersion: item.publicJobVersion,
    }))
  );
  const locationFacetCount = candidates.reduce(
    (count, { item }) => count + item.locations.length,
    0
  );
  await testEnv.DB.prepare(
    `INSERT INTO public_job_catalog_versions (
      version,predecessor_version,membership_hash,member_count,
      search_document_count,search_content_hash,search_term_count,
      location_facet_count,representation_updated_at,
      material_changed_at,search_index_version,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      catalogVersion,
      head.version,
      options.versionMembershipHash ?? membership.membershipHash,
      candidates.length,
      candidates.length,
      options.versionSearchContentHash ?? search.searchContentHash,
      search.termCount,
      locationFacetCount,
      timestamp,
      timestamp,
      searchVersion,
      timestamp
    )
    .run();

  for (const {
    candidate,
    detailJson,
    facets,
    item,
    itemJson,
    search: derived,
  } of candidates) {
    const statements = [
      testEnv.DB.prepare(
        `INSERT INTO public_job_catalog_members (
          catalog_version,public_job_id,public_job_version,
          eligibility_decision_version,item_json,detail_json,public_content_hash,
          eligibility_decision_hash,location_facets_json,
          representation_updated_at,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        catalogVersion,
        candidate.public_job_id,
        item.publicJobVersion,
        candidate.eligibility_decision_version,
        itemJson,
        detailJson,
        candidate.public_content_hash,
        candidate.eligibility_decision_hash,
        JSON.stringify(facets),
        candidate.representation_updated_at,
        timestamp
      ),
      ...(options.omitSearch
        ? []
        : [
            testEnv.DB.prepare(
              `INSERT INTO public_job_search_index (
                public_job_id,public_job_version,search_index_version,
                search_document,search_terms_json,title_sort_key,effective_recency,
                conservative_hourly_usd,created_at
              ) VALUES (?,?,?,?,?,?,?,?,?)`
            ).bind(
              candidate.public_job_id,
              item.publicJobVersion,
              searchVersion,
              derived.searchDocument,
              JSON.stringify(derived.terms),
              derived.titleSortKey,
              derived.effectiveRecency,
              derived.conservativeHourlyUsd,
              timestamp
            ),
            ...derived.terms.map(({ score, term }) =>
              testEnv.DB.prepare(
                `INSERT INTO public_job_search_terms (
                  search_index_version,public_job_id,public_job_version,
                  term,score,created_at
                ) VALUES (?,?,?,?,?,?)`
              ).bind(
                searchVersion,
                candidate.public_job_id,
                item.publicJobVersion,
                term,
                score,
                timestamp
              )
            ),
          ]),
      ...(options.omitFacets
        ? []
        : item.locations.map((_location, ordinal) =>
            testEnv.DB.prepare(
              `INSERT INTO public_browse_job_locations (
                catalog_version,public_job_id,public_job_version,ordinal,
                location_role,country_code,country_slug,city_slug,display_name,
                created_at
              ) VALUES (?,?,?,?,?,?,?,?,?,?)`
            ).bind(
              catalogVersion,
              candidate.public_job_id,
              item.publicJobVersion,
              ordinal,
              facets[ordinal]?.role,
              facets[ordinal]?.countryCode,
              facets[ordinal]?.countrySlug,
              facets[ordinal]?.citySlug,
              facets[ordinal]?.displayName,
              timestamp
            )
          )),
    ];
    // biome-ignore lint/performance/noAwaitInLoops: the fixture materializes each immutable catalog member before one head advance.
    await testEnv.DB.batch(statements);
  }
  if (options.sealMembershipHash) {
    await testEnv.DB.prepare(
      `INSERT INTO public_job_catalog_seals (
        catalog_version,membership_hash,member_count,search_document_count,
        search_content_hash,search_term_count,location_facet_count,sealed_at
      ) VALUES (?,?,?,?,?,?,?,?)`
    )
      .bind(
        catalogVersion,
        options.sealMembershipHash,
        candidates.length,
        candidates.length,
        search.searchContentHash,
        search.termCount,
        locationFacetCount,
        timestamp
      )
      .run();
    await testEnv.DB.prepare(
      `UPDATE public_job_catalog_head_pointer
          SET current_version=?,updated_at=?
        WHERE singleton=1`
    )
      .bind(catalogVersion, timestamp)
      .run();
    return;
  }
  await sealAndActivatePublicJobCatalog(testEnv.DB, {
    catalogVersion,
    sealedAt: timestamp,
  });
}

function catalogCandidateRow(publicJobId: string) {
  return testEnv.DB.prepare(
    `SELECT
      public_job_id,public_job_version,eligibility_decision_version,
      canonical_slug,title,organization_name,workplace_type,date_posted,
      date_posted_provenance,valid_through,valid_through_provenance,
      employment_types_json,compensation_json,material_changed_at,verified_at,
      application_available,locations_json,source_attributions_json,
      'published' AS publication_state,public_content_hash,
      eligibility_decision_hash,representation_updated_at,item_json,detail_json
     FROM public_browse_job_candidates WHERE public_job_id=?`
  )
    .bind(publicJobId)
    .first<CatalogCandidateRow>();
}

function candidateRow(publicJobId: string) {
  return testEnv.DB.prepare(
    `SELECT
      public_job_id,public_job_version,canonical_slug,title,
      organization_name,workplace_type,date_posted,date_posted_provenance,
      valid_through,valid_through_provenance,employment_types_json,
      compensation_json,description_html,material_changed_at,verified_at,
      application_available,locations_json,source_attributions_json,
      publication_state
     FROM public_job_route_content WHERE public_job_id=?`
  )
    .bind(publicJobId)
    .first<PublicJobReadRow>();
}

function makePublicId(index: number) {
  return `pjob_v1_${index.toString(16).padStart(64, "0")}`;
}

function countrySlug(countryCode: string) {
  return countryCode === "KR" ? "south-korea" : countryCode.toLowerCase();
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function hash(index: number) {
  return Math.max(0, index).toString(16).padStart(64, "0").slice(-64);
}
