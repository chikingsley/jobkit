import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  readPublicJobDetailWithMetadata,
  readPublicJobListWithMetadata,
  resolvePublicJobMarketScope,
} from "../../../../worker/repositories/public-jobs";
import { appendTerminalDecision } from "./support/appendterminaldecision";
import { publishLegacyCatalog } from "./support/legacy-catalog";
import {
  request,
  seedPublishedJob,
  seedSource,
  testEnv,
  timestamp,
} from "./support/model";

const RANGE_MIGRATION_NUMBER = 72;

interface LegacyMemberRow {
  detail_json: string;
  eligibility_decision_hash: string;
  item_json: string;
  public_content_hash: string;
  public_job_id: string;
  representation_updated_at: string;
}

function migrationNumber(name: string) {
  return Number.parseInt(name.slice(0, 4), 10);
}

describe("public catalog range membership migration", () => {
  it("converts pre-range catalogs so head reads stay byte-identical", async () => {
    const prior = testEnv.TEST_MIGRATIONS.filter(
      (migration) => migrationNumber(migration.name) < RANGE_MIGRATION_NUMBER
    );
    expect(prior.length).toBeGreaterThan(0);
    expect(prior.length).toBeLessThan(testEnv.TEST_MIGRATIONS.length);
    await applyD1Migrations(testEnv.DB, prior);

    const source = "range-migration";
    await seedSource(source);
    const retainedA = await seedPublishedJob({ index: 700, source });
    const retainedB = await seedPublishedJob({ index: 701, source });
    const closed = await seedPublishedJob({ index: 702, source });
    const addedA = await seedPublishedJob({ index: 703, source });
    const addedB = await seedPublishedJob({ index: 704, source });
    await publishLegacyCatalog(
      "convert-a",
      [retainedA.publicId, retainedB.publicId, closed.publicId],
      "2026-07-24T12:00:01.000Z"
    );
    await appendTerminalDecision(closed.publicId, "closed", null);
    await publishLegacyCatalog(
      "convert-b",
      [
        retainedA.publicId,
        retainedB.publicId,
        addedA.publicId,
        addedB.publicId,
      ],
      "2026-07-24T12:00:02.000Z"
    );

    // Residue of the superseded chunked staging flow: a never-activated
    // version with a partially copied membership.
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO public_job_catalog_versions (
          version,predecessor_version,membership_hash,member_count,
          search_document_count,search_content_hash,search_term_count,
          location_facet_count,representation_updated_at,
          material_changed_at,search_index_version,created_at
        ) VALUES ('catalog:orphan-staging','catalog:convert-b',?,4,4,?,0,0,
          ?,?,'search:orphan-staging',?)`
      ).bind("a".repeat(64), "b".repeat(64), timestamp, timestamp, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO public_job_catalog_members (
          catalog_version,public_job_id,public_job_version,
          eligibility_decision_version,item_json,detail_json,
          public_content_hash,eligibility_decision_hash,location_facets_json,
          representation_updated_at,created_at
        )
        SELECT 'catalog:orphan-staging',public_job_id,public_job_version,
               eligibility_decision_version,item_json,detail_json,
               public_content_hash,eligibility_decision_hash,
               location_facets_json,representation_updated_at,created_at
          FROM public_job_catalog_members
         WHERE catalog_version='catalog:convert-b' AND public_job_id=?`
      ).bind(retainedA.publicId),
    ]);

    const headBefore = await testEnv.DB.prepare(
      `SELECT version.version,version.membership_hash,
              version.representation_updated_at
         FROM public_job_catalog_head_pointer pointer
         JOIN public_job_catalog_versions version
           ON version.version=pointer.current_version
        WHERE pointer.singleton=1`
    ).first<{
      membership_hash: string;
      representation_updated_at: string;
      version: string;
    }>();
    const membersBefore = await testEnv.DB.prepare(
      `SELECT public_job_id,item_json,detail_json,public_content_hash,
              eligibility_decision_hash,representation_updated_at
         FROM public_job_catalog_members
        WHERE catalog_version='catalog:convert-b'
        ORDER BY public_job_id`
    ).all<LegacyMemberRow>();
    const closedBefore = await testEnv.DB.prepare(
      `SELECT public_job_id,item_json,detail_json,public_content_hash,
              eligibility_decision_hash,representation_updated_at
         FROM public_job_catalog_members
        WHERE catalog_version='catalog:convert-a' AND public_job_id=?`
    )
      .bind(closed.publicId)
      .first<LegacyMemberRow>();
    expect(headBefore?.version).toBe("catalog:convert-b");
    expect(membersBefore.results).toHaveLength(4);
    if (!closedBefore) {
      throw new Error("The closed legacy member row is missing");
    }

    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);

    // Identical consecutive copies collapsed into spans, the closed member
    // span ended at the successor version, and orphan staged copies vanished.
    await expect(
      testEnv.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM public_job_catalog_members) spans,
           (SELECT COUNT(*) FROM public_job_catalog_members
             WHERE valid_to_ordinal IS NULL) open_spans,
           (SELECT COUNT(*) FROM public_job_catalog_members
             WHERE valid_to_ordinal IS NOT NULL) closed_spans,
           (SELECT COUNT(*) FROM public_job_catalog_members member
             JOIN public_job_catalog_versions version
               ON version.ordinal=member.valid_from_ordinal
            WHERE version.version='catalog:convert-a'
              AND member.valid_to_ordinal IS NULL) collapsed_spans,
           (SELECT COUNT(*) FROM public_job_catalog_members member
             JOIN public_job_catalog_versions version
               ON version.ordinal=member.valid_from_ordinal
            WHERE version.version='catalog:orphan-staging') orphan_spans,
           (SELECT COUNT(*) FROM public_job_catalog_versions
             WHERE version='catalog:orphan-staging') orphan_versions`
      ).first()
    ).resolves.toEqual({
      closed_spans: 1,
      collapsed_spans: 2,
      open_spans: 4,
      orphan_spans: 0,
      orphan_versions: 1,
      spans: 5,
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT closure.version closed_at
           FROM public_job_catalog_members member
           JOIN public_job_catalog_versions closure
             ON closure.ordinal=member.valid_to_ordinal
          WHERE member.public_job_id=?`
      )
        .bind(closed.publicId)
        .first()
    ).resolves.toEqual({ closed_at: "catalog:convert-b" });

    const list = await readPublicJobListWithMetadata(
      testEnv.DB,
      request(new URLSearchParams("limit=50&sort=title"))
    );
    expect(list.data.catalog.version).toBe("catalog:convert-b");
    expect(list.metadata.membershipHash).toBe(headBefore?.membership_hash);
    expect(list.metadata.representationUpdatedAt).toBe(
      headBefore?.representation_updated_at
    );
    expect(list.data.items).toEqual(
      membersBefore.results.map((row) => JSON.parse(row.item_json))
    );
    expect(list.data.page).toEqual({ hasMore: false, nextCursor: null });

    for (const row of membersBefore.results) {
      const slug = JSON.parse(row.item_json).canonicalSlug as string;
      // biome-ignore lint/performance/noAwaitInLoops: each detail read proves one converted member byte-identical.
      const detail = await readPublicJobDetailWithMetadata(testEnv.DB, {
        publicId: row.public_job_id,
        slug,
      });
      expect(detail).toMatchObject({
        data: JSON.parse(row.detail_json),
        kind: "serve",
        metadata: {
          eligibilityDecisionHash: row.eligibility_decision_hash,
          publicContentHash: row.public_content_hash,
          representationUpdatedAt: row.representation_updated_at,
        },
        noindex: false,
      });
    }

    const closedDetail = await readPublicJobDetailWithMetadata(testEnv.DB, {
      publicId: closed.publicId,
      slug: closed.slug,
    });
    expect(closedDetail).toMatchObject({
      data: {
        ...JSON.parse(closedBefore.detail_json),
        application: { available: false },
        status: "closed",
      },
      kind: "serve",
      noindex: true,
    });

    await expect(
      resolvePublicJobMarketScope(testEnv.DB, { countrySlug: "south-korea" })
    ).resolves.toEqual({
      countryCode: "KR",
      countrySlug: "south-korea",
      kind: "country",
    });
  }, 120_000);
});
