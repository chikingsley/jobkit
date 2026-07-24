import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../../src/features/inventory/content";
import { jobSourceHash } from "../../../../worker/ai/job-fact-extraction";
import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import { promoteProjectionCandidate } from "../../../../worker/services/public-projection/promotion";
import {
  catalogActivationStatements,
  prepareCatalogPromotion,
} from "../../../../worker/services/public-projection/promotion/catalog";
import {
  preparePromotionMappings,
  promotionDecisionHash,
} from "../../../../worker/services/public-projection/promotion/derive";
import { promotionGuardStatements } from "../../../../worker/services/public-projection/promotion/guards";
import { livePromotionStatements } from "../../../../worker/services/public-projection/promotion/live";
import {
  readPromotionCandidate,
  readPromotionCatalogHead,
} from "../../../../worker/services/public-projection/promotion/read";
import { createAuthenticatedUser } from "../auth";
import { publishCatalog } from "../public-job-read-model/support/appendterminaldecision";
import {
  seedPublishedJob,
  seedSource,
} from "../public-job-read-model/support/model";
import { jobFixture } from "../public-projection-final-graph/support/fixtures";
import { finishFinalGraph } from "../public-projection-final-graph/support/lifecycle";
import {
  testEnv,
  timestamp,
} from "../public-projection-final-graph/support/model";
import { seedResolvedRun } from "../public-projection-final-graph/support/seed-runs";
import { directAnalysis } from "../public-projection-prerequisites/support/analyses";
import { seedAnalyses } from "../public-projection-prerequisites/support/seeding";

const runId = "promotion-guard-run";
const allocationRow = () =>
  testEnv.DB.prepare(
    `SELECT allocation_id FROM public_projection_candidate_results
      WHERE run_id=? AND state='prepared' LIMIT 1`
  )
    .bind(runId)
    .first<{ allocation_id: string }>();

const catalogFootprint = () =>
  testEnv.DB.prepare(
    `SELECT
       (SELECT current_version FROM public_job_catalog_head_pointer
         WHERE singleton=1) head_version,
       (SELECT COUNT(*) FROM public_job_catalog_versions) versions,
       (SELECT COUNT(*) FROM public_job_catalog_seals) seals,
       (SELECT COUNT(*) FROM public_job_catalog_members) members,
       (SELECT COUNT(*) FROM public_job_catalog_members
         WHERE valid_to_ordinal IS NULL) open_members,
       (SELECT COUNT(*) FROM public_job_search_index) search_rows,
       (SELECT COUNT(*) FROM public_job_search_terms) search_terms,
       (SELECT COUNT(*) FROM public_browse_job_locations) facets,
       (SELECT COUNT(*) FROM public_projection_promotion_manifests) manifests`
  ).first<Record<string, unknown>>();

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public projection promotion catalog guards", () => {
  it("aborts a promotion against a stale head with no partial state", async () => {
    await approveTeflPublication();
    const source = "promotion-guards";
    await seedSource(source);
    const first = await seedPublishedJob({ index: 600, source });
    const second = await seedPublishedJob({ index: 601, source });
    await seedPromotionRun();
    await publishCatalog("guard-base", [first.publicId]);

    const context = await readPromotionCandidate(
      testEnv.DB,
      runId,
      (await allocationRow())?.allocation_id ?? ""
    );
    const [mappings, decisionHash] = await Promise.all([
      preparePromotionMappings(context.candidate),
      promotionDecisionHash(context.candidate),
    ]);
    const staleHead = await readPromotionCatalogHead(testEnv.DB);
    const stalePrepared = await prepareCatalogPromotion(testEnv.DB, {
      candidate: context.candidate,
      catalogHead: staleHead,
      decisionHash,
      timestamp,
    });
    if (!stalePrepared) {
      throw new Error("The guard fixture prepared no catalog promotion");
    }
    const staleBatch = [
      ...promotionGuardStatements(testEnv.DB, {
        candidate: context.candidate,
        candidateHash: context.candidateHash,
        candidateSealDigest: context.candidateSealDigest,
        catalogHeadVersion: staleHead.current_version,
        mappings,
      }),
      ...livePromotionStatements(testEnv.DB, {
        candidate: context.candidate,
        decisionHash,
        mappings,
        timestamp,
      }),
      ...catalogActivationStatements(testEnv.DB, {
        candidate: context.candidate,
        catalogHead: staleHead,
        prepared: stalePrepared,
        timestamp,
      }),
    ];

    await publishCatalog("guard-moved", [second.publicId]);
    const before = await catalogFootprint();
    await expect(testEnv.DB.batch(staleBatch)).rejects.toThrow();
    await expect(catalogFootprint()).resolves.toEqual(before);
    expect(before?.head_version).toBe("catalog:guard-moved");
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM public_job_catalog_versions
          WHERE version=?`
      )
        .bind(stalePrepared.catalogVersion)
        .first()
    ).resolves.toEqual({ count: 0 });
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM public_job_catalog_members
          WHERE public_job_id=?`
      )
        .bind(context.candidate.publicJobId)
        .first()
    ).resolves.toEqual({ count: 0 });

    const operator = await createAuthenticatedUser(
      "promotion-guard-operator@example.test"
    );
    const result = await promoteProjectionCandidate(testEnv.DB, {
      allocationId: context.candidate.allocationId,
      runId,
      userId: operator.userId,
    });
    expect(result.created).toBe(true);
    expect(result.manifest.predecessorCatalogVersion).toBe(
      "catalog:guard-moved"
    );
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) members
           FROM public_job_catalog_versions target
           JOIN public_job_catalog_members member
             ON member.valid_from_ordinal<=target.ordinal
            AND (member.valid_to_ordinal IS NULL
              OR member.valid_to_ordinal>target.ordinal)
          WHERE target.version=?`
      )
        .bind(result.manifest.activatedCatalogVersion)
        .first()
    ).resolves.toEqual({ members: 2 });
  }, 120_000);
});

async function seedPromotionRun() {
  const sourcePositionId = "promotion-guard-source";
  const sourceReference = "promotion-guard-reference";
  const fixture = await seedResolvedRun({
    advanceable: true,
    positions: [
      {
        canonicalSignalHash: "b2".repeat(32),
        sourcePositionId,
        sourceReference,
      },
    ],
    runId,
  });
  const [position] = fixture.positions;
  if (!position) {
    throw new Error("The guard promotion fixture has no position");
  }
  const job = jobFixture(position.listingId, sourceReference);
  await seedAnalyses(
    {
      job,
      materialHash: await inventoryJobMaterialHash(job),
      materialJson: serializeInventoryJobMaterial(job),
      sourceHash: await jobSourceHash(job),
    },
    directAnalysis()
  );
  await testEnv.DB.prepare(
    `INSERT INTO application_routes (
      id,job_id,kind,destination,source_evidence,last_verified_at,status,
      created_at,updated_at
    ) VALUES (?,?,'external_url',?,?,?,'active',?,?)`
  )
    .bind(
      "route:promotion-guard",
      position.listingId,
      job.applyUrl,
      job.sourceUrl,
      timestamp,
      timestamp,
      timestamp
    )
    .run();
  await finishFinalGraph(testEnv.DB, runId, timestamp);
  await advancePublicProjectionRuns(testEnv.DB);
  await advancePublicProjectionRuns(testEnv.DB);
}

async function approveTeflPublication() {
  const allowedFields = [
    "compensation",
    "date_posted",
    "description",
    "employment_types",
    "locations",
    "organization_name",
    "source_name",
    "source_url",
    "title",
    "valid_through",
  ];
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO source_publication_policy_versions (
        source_key,version,predecessor_version,approval_state,
        publication_scope,publication_enabled,allowed_fields_json,
        attribution_mode,max_verbatim_chars,source_origin_url,terms_url,
        terms_checked_at,robots_url,robots_checked_at,evidence_json,
        decision_note,policy_hash,idempotency_key,created_at
      ) VALUES ('tefl',2,1,'approved','licensed_full_text',1,?,
        'source_link',10000,'https://example.test/','',NULL,'',NULL,?,
        'Integration publication approval',?,'integration-policy-v2',?)`
    ).bind(
      JSON.stringify(allowedFields),
      JSON.stringify({ basis: "integration fixture" }),
      "d".repeat(64),
      timestamp
    ),
    testEnv.DB.prepare(
      `UPDATE source_publication_policy_heads
          SET current_version=2,updated_at=? WHERE source_key='tefl'`
    ).bind(timestamp),
  ]);
}
