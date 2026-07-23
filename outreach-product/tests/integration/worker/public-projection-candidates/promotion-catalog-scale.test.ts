import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../../src/features/inventory/content";
import { jobSourceHash } from "../../../../worker/ai/job-fact-extraction";
import {
  readPublicJobDetail,
  readPublicJobList,
} from "../../../../worker/repositories/public-jobs";
import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import { PublicProjectionCandidateSchema } from "../../../../worker/services/public-projection/candidates/model";
import { promoteProjectionCandidate } from "../../../../worker/services/public-projection/promotion";
import { createAuthenticatedUser } from "../auth";
import { publishCatalog } from "../public-job-read-model/support/appendterminaldecision";
import {
  request,
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

const MEMBER_COUNT = 220;
const FIRST_INDEX = 1000;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public projection promotion at catalog scale", () => {
  it("activates one candidate on top of a multi-hundred-member catalog", async () => {
    await approveTeflPublication();
    const source = "promotion-scale";
    await seedSource(source);
    const members: Array<{ publicId: string; slug: string }> = [];
    for (let index = 0; index < MEMBER_COUNT; index += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: each member is one ordered fixture batch.
      const member = await seedPublishedJob({
        index: FIRST_INDEX + index,
        source,
      });
      members.push(member);
    }
    await publishCatalog(
      "promotion-scale",
      members.map(({ publicId }) => publicId)
    );
    const samples = [members[0], members[109], members[219]].filter(
      (member): member is { publicId: string; slug: string } =>
        member !== undefined
    );
    const before = await Promise.all(
      samples.map((sample) =>
        readPublicJobDetail(testEnv.DB, {
          publicId: sample.publicId,
          slug: sample.slug,
        })
      )
    );

    const operator = await createAuthenticatedUser(
      "promotion-scale-operator@example.test"
    );
    const runId = "promotion-scale-run";
    const candidate = await preparePromotionCandidate(runId);
    const result = await promoteProjectionCandidate(testEnv.DB, {
      allocationId: candidate.allocationId,
      runId,
      userId: operator.userId,
    });
    expect(result.created).toBe(true);
    expect(result.manifest.predecessorCatalogVersion).toBe(
      "catalog:promotion-scale"
    );

    const head = await testEnv.DB.prepare(
      `SELECT current_version FROM public_job_catalog_head_pointer
          WHERE singleton=1`
    ).first<{ current_version: string }>();
    expect(head?.current_version).toBe(result.manifest.activatedCatalogVersion);
    const activatedCounts = await testEnv.DB.prepare(
      `SELECT
           (SELECT COUNT(*) FROM public_job_catalog_members
             WHERE catalog_version=?1) member_count,
           (SELECT COUNT(*) FROM public_job_search_index search
             JOIN public_job_catalog_versions version
               ON version.search_index_version=search.search_index_version
            WHERE version.version=?1) search_count,
           (SELECT COUNT(*) FROM public_job_catalog_members retained
             JOIN public_job_catalog_members predecessor
               ON predecessor.public_job_id=retained.public_job_id
              AND predecessor.catalog_version='catalog:promotion-scale'
            WHERE retained.catalog_version=?1
              AND retained.item_json=predecessor.item_json
              AND retained.detail_json=predecessor.detail_json
              AND retained.public_content_hash=predecessor.public_content_hash
           ) identical_count`
    )
      .bind(result.manifest.activatedCatalogVersion)
      .first<{
        identical_count: number;
        member_count: number;
        search_count: number;
      }>();
    expect(activatedCounts).toEqual({
      identical_count: MEMBER_COUNT,
      member_count: MEMBER_COUNT + 1,
      search_count: MEMBER_COUNT + 1,
    });

    const after = await Promise.all(
      samples.map((sample) =>
        readPublicJobDetail(testEnv.DB, {
          publicId: sample.publicId,
          slug: sample.slug,
        })
      )
    );
    expect(after).toEqual(before);
    const list = await readPublicJobList(
      testEnv.DB,
      request(new URLSearchParams("limit=50"))
    );
    expect(list.catalog.version).toBe(result.manifest.activatedCatalogVersion);
  }, 240_000);
});

async function preparePromotionCandidate(runId: string) {
  const sourcePositionId = "promotion-scale-source";
  const sourceReference = "promotion-scale-reference";
  const fixture = await seedResolvedRun({
    advanceable: true,
    positions: [
      {
        canonicalSignalHash: "a1".repeat(32),
        sourcePositionId,
        sourceReference,
      },
    ],
    runId,
  });
  const [position] = fixture.positions;
  if (!position) {
    throw new Error("The scale promotion fixture has no position");
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
      "route:promotion-scale",
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
  const row = await testEnv.DB.prepare(
    `SELECT candidate_json FROM public_projection_candidate_results
      WHERE run_id=? AND state='prepared' LIMIT 1`
  )
    .bind(runId)
    .first<{ candidate_json: string }>();
  if (!row) {
    throw new Error("The scale promotion fixture produced no candidate");
  }
  return PublicProjectionCandidateSchema.parse(JSON.parse(row.candidate_json));
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
