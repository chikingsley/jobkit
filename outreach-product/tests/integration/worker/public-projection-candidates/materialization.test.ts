import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../../src/features/inventory/content";
import { jobSourceHash } from "../../../../worker/ai/job-fact-extraction";
import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import { PublicProjectionCandidateSchema } from "../../../../worker/services/public-projection/candidates/model";
import { createAuthenticatedUser } from "../auth";
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

describe("public projection candidate materialization", () => {
  it("seals immutable candidates before completing the shadow run", async () => {
    const runId = "candidate-materialization-run";
    const sourcePositionId = "candidate-materialization-source";
    const sourceReference = "candidate-materialization-reference";
    const fixture = await seedResolvedRun({
      advanceable: true,
      positions: [
        {
          canonicalSignalHash: "a".repeat(64),
          sourcePositionId,
          sourceReference,
        },
      ],
      runId,
    });
    const [position] = fixture.positions;
    if (!position) {
      throw new Error("The candidate fixture has no source position");
    }
    await seedCandidateAnalyses(position.listingId, sourceReference);
    await finishFinalGraph(testEnv.DB, runId, timestamp);

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      candidatePrepared: 1,
      candidateSealed: false,
      runId,
    });
    await expect(runStatus(runId)).resolves.toBe("running");

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      candidateSealed: true,
      runId,
    });
    await expect(runStatus(runId)).resolves.toBe("completed");
    const result = await candidateResult(runId);
    expect(result.state).toBe("prepared");
    expect(result.reason_code).toBe("candidate_prepared");
    if (result.candidate_json === null) {
      throw new Error("Prepared candidate result has no candidate JSON");
    }
    expect(
      PublicProjectionCandidateSchema.parse(JSON.parse(result.candidate_json))
    ).toMatchObject({
      decision: { publicationState: "private" },
      runId,
      sourcePositionId,
    });
    await expect(
      testEnv.DB.prepare(
        `UPDATE public_projection_candidate_results SET reason_code='changed'
          WHERE run_id=?`
      )
        .bind(runId)
        .run()
    ).rejects.toThrow("immutable");
  });

  it("records an analysis gap as a terminal blocked candidate", async () => {
    const runId = "candidate-analysis-gap-run";
    await seedResolvedRun({
      advanceable: true,
      positions: [
        {
          canonicalSignalHash: "b".repeat(64),
          sourcePositionId: "candidate-analysis-gap-source",
          sourceReference: "candidate-analysis-gap-reference",
        },
      ],
      runId,
    });
    await finishFinalGraph(testEnv.DB, runId, timestamp);

    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      candidateBlocked: 1,
      candidateSealed: false,
      runId,
    });
    await expect(
      advancePublicProjectionRuns(testEnv.DB)
    ).resolves.toMatchObject({
      candidateSealed: true,
      runId,
    });
    await expect(runStatus(runId)).resolves.toBe("completed_with_blocks");
    await expect(candidateResult(runId)).resolves.toMatchObject({
      candidate_json: null,
      reason_code: "candidate_analysis_incomplete",
      state: "blocked",
    });
  });

  it("promotes an initial candidate and its successor atomically", async () => {
    const operator = await createAuthenticatedUser(
      "candidate-promotion-operator@example.test"
    );
    const runId = "candidate-promotion-run";
    const sourcePositionId = "candidate-promotion-source";
    const sourceReference = "candidate-promotion-reference";
    const fixture = await seedResolvedRun({
      advanceable: true,
      positions: [
        {
          canonicalSignalHash: "c".repeat(64),
          sourcePositionId,
          sourceReference,
        },
      ],
      runId,
    });
    const [position] = fixture.positions;
    if (!position) {
      throw new Error("The promotion fixture has no source position");
    }
    await seedCandidateAnalyses(position.listingId, sourceReference);
    await finishFinalGraph(testEnv.DB, runId, timestamp);
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);
    const result = await candidateResult(runId);
    if (result.candidate_json === null) {
      throw new Error("The promotion fixture has no prepared candidate");
    }
    const candidate = PublicProjectionCandidateSchema.parse(
      JSON.parse(result.candidate_json)
    );
    const catalog = await testEnv.DB.prepare(
      "SELECT version FROM public_job_catalog_head"
    ).first<{ version: string }>();
    if (!catalog) {
      throw new Error("The promotion fixture has no active public catalog");
    }

    const response = await sessionRequest(
      `/api/operator/public-projection/runs/${runId}/promotions`,
      operator.cookie,
      "POST",
      { allocationId: candidate.allocationId }
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      promotion: {
        created: true,
        manifest: {
          activatedCatalogVersion: catalog.version,
          publicJobId: candidate.publicJobId,
          runId,
        },
      },
    });
    await expect(livePromotionSnapshot(candidate.publicJobId)).resolves.toEqual(
      {
        candidate_count: 1,
        decision_state: "private",
        job_count: 1,
        manifest_count: 1,
        mapping_count: 1,
      }
    );

    const replay = await sessionRequest(
      `/api/operator/public-projection/runs/${runId}/promotions`,
      operator.cookie,
      "POST",
      { allocationId: candidate.allocationId }
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      promotion: { created: false },
    });

    const successorRunId = "candidate-promotion-successor-run";
    const successorFixture = await seedResolvedRun({
      advanceable: true,
      positions: [
        {
          canonicalSignalHash: "c".repeat(64),
          sourcePositionId,
          sourceReference,
        },
      ],
      runId: successorRunId,
    });
    const [successorPosition] = successorFixture.positions;
    if (!successorPosition) {
      throw new Error("The successor promotion fixture has no source position");
    }
    await seedCandidateAnalyses(successorPosition.listingId, sourceReference);
    await finishFinalGraph(testEnv.DB, successorRunId, timestamp);
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);
    const successorResult = await candidateResult(successorRunId);
    if (successorResult.candidate_json === null) {
      throw new Error("The successor promotion fixture has no candidate");
    }
    const successor = PublicProjectionCandidateSchema.parse(
      JSON.parse(successorResult.candidate_json)
    );
    expect(successor).toMatchObject({
      decision: { decisionVersion: 2, predecessorVersion: 1 },
      publicJobId: candidate.publicJobId,
      publicJobVersion: 2,
      publicJobVersionPredecessor: 1,
      sourceMappings: [
        {
          predecessorMappingVersion: 1,
          sourcePositionId,
        },
      ],
    });

    const successorResponse = await sessionRequest(
      `/api/operator/public-projection/runs/${successorRunId}/promotions`,
      operator.cookie,
      "POST",
      { allocationId: successor.allocationId }
    );
    expect(successorResponse.status).toBe(201);
    await expect(successorResponse.json()).resolves.toMatchObject({
      promotion: {
        created: true,
        manifest: {
          publicJobId: candidate.publicJobId,
          publicJobVersion: 2,
          runId: successorRunId,
        },
      },
    });
    await expect(
      livePromotionVersions(candidate.publicJobId, sourcePositionId)
    ).resolves.toEqual({
      decision_version: 2,
      job_version: 2,
      mapping_version: 2,
    });
  });
});

async function seedCandidateAnalyses(
  listingId: string,
  sourceReference: string
) {
  const job = jobFixture(listingId, sourceReference);
  await seedAnalyses(
    {
      job,
      materialHash: await inventoryJobMaterialHash(job),
      materialJson: serializeInventoryJobMaterial(job),
      sourceHash: await jobSourceHash(job),
    },
    directAnalysis()
  );
}

function runStatus(runId: string) {
  return testEnv.DB.prepare(
    "SELECT status FROM public_projection_runs WHERE id=?"
  )
    .bind(runId)
    .first<{ status: string }>()
    .then((row) => row?.status);
}

async function candidateResult(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT state,reason_code,candidate_json
       FROM public_projection_candidate_results WHERE run_id=?`
  )
    .bind(runId)
    .first<{
      candidate_json: string | null;
      reason_code: string;
      state: string;
    }>();
  if (!row) {
    throw new Error("The candidate fixture produced no result");
  }
  return row;
}

function livePromotionSnapshot(publicJobId: string) {
  return testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM public_jobs WHERE id=?) job_count,
      (SELECT COUNT(*) FROM job_source_position_mapping_heads head
        JOIN job_source_position_mapping_versions mapping
          ON mapping.source_position_id=head.source_position_id
         AND mapping.version=head.current_version
       WHERE mapping.public_job_id=?) mapping_count,
      (SELECT publication_state FROM public_job_eligibility_heads head
        JOIN public_job_eligibility_decisions decision
          ON decision.public_job_id=head.public_job_id
         AND decision.decision_version=head.current_decision_version
       WHERE head.public_job_id=?) decision_state,
      (SELECT COUNT(*) FROM public_projection_promotion_manifests
       WHERE public_job_id=?) manifest_count,
      (SELECT COUNT(*) FROM public_projection_candidate_results
       WHERE public_job_id=?) candidate_count`
  )
    .bind(publicJobId, publicJobId, publicJobId, publicJobId, publicJobId)
    .first();
}

function livePromotionVersions(publicJobId: string, sourcePositionId: string) {
  return testEnv.DB.prepare(
    `SELECT
      (SELECT current_version FROM public_job_heads
        WHERE public_job_id=?) job_version,
      (SELECT current_decision_version FROM public_job_eligibility_heads
        WHERE public_job_id=?) decision_version,
      (SELECT current_version FROM job_source_position_mapping_heads
        WHERE source_position_id=?) mapping_version`
  )
    .bind(publicJobId, publicJobId, sourcePositionId)
    .first();
}
