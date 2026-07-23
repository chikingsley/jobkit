import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  readPublicJobDetail,
  readPublicJobDetailWithMetadata,
  readPublicJobList,
  readPublicJobListWithMetadata,
} from "../../../../worker/repositories/public-jobs";
import {
  appendTerminalDecision,
  hash,
  makePublicId,
  publishCatalog,
} from "./support/appendterminaldecision";
import {
  hashPattern,
  malformedCatalogDetailPattern,
  malformedCatalogItemPattern,
  privateSearchContentPattern,
  request,
  searchImmutablePattern,
  searchRowsMismatchPattern,
  seedPublishedJob,
  seedSource,
  testEnv,
  timestamp,
} from "./support/model";

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public job read model", () => {
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
});
