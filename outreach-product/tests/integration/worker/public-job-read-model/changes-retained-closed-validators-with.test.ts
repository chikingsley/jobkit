import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizePublicJobListRequest } from "../../../../worker/public-jobs/query";
import type { PublicJobListItem } from "../../../../worker/public-jobs/schemas";
import { publicJobDetailEtag } from "../../../../worker/public-jobs/validators";
import {
  readPublicJobDetail,
  readPublicJobDetailWithMetadata,
  readPublicJobList,
  resolvePublicJobMarketScope,
} from "../../../../worker/repositories/public-jobs";
import {
  appendTerminalDecision,
  catalogCandidateRow,
  hash,
  publishCatalog,
} from "./support/appendterminaldecision";
import {
  activationSealPattern,
  cursorSecret,
  request,
  seedPublishedJob,
  seedSource,
  testEnv,
  timestamp,
} from "./support/model";

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public job read model", () => {
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
          public_job_id,valid_from_ordinal,public_job_version,
          eligibility_decision_version,item_json,detail_json,public_content_hash,
          eligibility_decision_hash,location_facets_json,
          representation_updated_at,created_at
        )
        SELECT ?,version.ordinal,1,1,?,?,?,?,?,?,?
          FROM public_job_catalog_versions version
         WHERE version.version='catalog:cursor-page'`
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
          public_job_id,valid_from_ordinal,public_job_version,
          search_document,search_terms_json,title_sort_key,effective_recency,
          conservative_hourly_usd,created_at
        )
        SELECT ?,version.ordinal,1,'outsider',
               '[{"term":"outsider","score":1}]','outsider',?,?,?
          FROM public_job_catalog_versions version
         WHERE version.version='catalog:cursor-page'`
      )
        .bind(outsider.publicId, timestamp, null, timestamp)
        .run()
    ).rejects.toThrow(activationSealPattern);
    await expect(
      testEnv.DB.prepare(
        `INSERT INTO public_browse_job_locations (
          public_job_id,valid_from_ordinal,public_job_version,ordinal,
          location_role,country_code,country_slug,city_slug,display_name,
          created_at
        )
        SELECT ?,version.ordinal,1,99,'worksite','KR',
               'south-korea','seoul','Seoul',?
          FROM public_job_catalog_versions version
         WHERE version.version='catalog:cursor-page'`
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
});
