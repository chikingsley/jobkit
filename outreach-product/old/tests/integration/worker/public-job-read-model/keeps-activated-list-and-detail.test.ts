import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  normalizePublicJobListRequest,
  PublicJobCursorError,
  PublicJobQueryError,
} from "../../../../worker/public-jobs/query";
import {
  readPublicJobDetail,
  readPublicJobList,
  readPublicJobListWithMetadata,
} from "../../../../worker/repositories/public-jobs";
import { hash, publishCatalog } from "./support/appendterminaldecision";
import {
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
