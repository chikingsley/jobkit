import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../../src/features/inventory/content";
import { jobSourceHash } from "../../../../worker/ai/job-fact-extraction";
import { readPublicJobList } from "../../../../worker/repositories/public-jobs";
import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import { PublicProjectionCandidateSchema } from "../../../../worker/services/public-projection/candidates/model";
import { promoteProjectionCandidate } from "../../../../worker/services/public-projection/promotion";
import { createAuthenticatedUser } from "../auth";
import { request } from "../public-job-read-model/support/model";
import { sessionRequest } from "../public-projection/support";
import { jobFixture } from "../public-projection-final-graph/support/fixtures";
import { finishFinalGraph } from "../public-projection-final-graph/support/lifecycle";
import {
  testEnv,
  timestamp,
} from "../public-projection-final-graph/support/model";
import { seedResolvedRun } from "../public-projection-final-graph/support/seed-runs";
import { directAnalysis } from "../public-projection-prerequisites/support/analyses";
import { seedAnalyses } from "../public-projection-prerequisites/support/seeding";

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("public projection candidate promotion", () => {
  it("publishes one approved candidate through an activated catalog", async () => {
    await approveTeflPublication();
    const operator = await createAuthenticatedUser(
      "published-candidate-operator@example.test"
    );
    const runId = "published-candidate-run";
    const sourcePositionId = "published-candidate-source";
    const sourceReference = "published-candidate-reference";
    const fixture = await seedResolvedRun({
      advanceable: true,
      positions: [
        {
          canonicalSignalHash: "e".repeat(64),
          sourcePositionId,
          sourceReference,
        },
      ],
      runId,
    });
    const [position] = fixture.positions;
    if (!position) {
      throw new Error("The published promotion fixture has no position");
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
        "route:published-candidate",
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
    const candidate = await readCandidate(runId);
    expect(candidate.decision.publicationState).toBe("published");

    const result = await promoteProjectionCandidate(testEnv.DB, {
      allocationId: candidate.allocationId,
      runId,
      userId: operator.userId,
    });
    expect(result).toMatchObject({
      created: true,
      manifest: { publicJobId: candidate.publicJobId },
    });
    const list = await readPublicJobList(
      testEnv.DB,
      request(new URLSearchParams())
    );
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      publicId: candidate.publicJobId,
      title: "English Teacher",
    });
    expect(list.catalog.version).toBe(result.manifest.activatedCatalogVersion);
    const privateDetail = await sessionRequest(
      `/api/jobs/${position.listingId}`,
      operator.cookie
    );
    expect(privateDetail.status).toBe(200);
    await expect(privateDetail.json()).resolves.toMatchObject({
      job: {
        resolvedLocations: [
          {
            countryCode: "GE",
            displayName: "Tbilisi, Georgia",
            latitude: 41.7151,
            longitude: 44.8271,
            provider: "mapbox",
          },
        ],
      },
    });
    await expect(
      testEnv.DB.prepare(
        `UPDATE public_projection_promotion_manifests
            SET manifest_hash=? WHERE id=?`
      )
        .bind("f".repeat(64), result.manifest.id)
        .run()
    ).rejects.toThrow("immutable");
  });
});

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

async function readCandidate(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT candidate_json FROM public_projection_candidate_results
      WHERE run_id=? AND state='prepared' LIMIT 1`
  )
    .bind(runId)
    .first<{ candidate_json: string }>();
  if (!row) {
    throw new Error("The published promotion fixture produced no candidate");
  }
  return PublicProjectionCandidateSchema.parse(JSON.parse(row.candidate_json));
}
