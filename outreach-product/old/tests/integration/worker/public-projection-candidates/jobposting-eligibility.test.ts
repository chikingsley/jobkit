import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { readPublicJobDetailWithMetadata } from "../../../../worker/repositories/public-jobs";
import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import { promoteProjectionCandidate } from "../../../../worker/services/public-projection/promotion";
import { createAuthenticatedUser } from "../auth";
import { finishFinalGraph } from "../public-projection-final-graph/support/lifecycle";
import {
  testEnv,
  timestamp,
} from "../public-projection-final-graph/support/model";
import {
  approveTeflPublication,
  POSTED_JOB,
  readCandidate,
  seedProviderPointRun,
} from "./support/jobposting";

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("locality provider points and JobPosting eligibility", () => {
  it("publishes a locality provider-point listing with a board-published date", async () => {
    await approveTeflPublication();
    const operator = await createAuthenticatedUser(
      "jobposting-operator@example.test"
    );
    const runId = "jobposting-provider-point-run";
    await seedProviderPointRun(runId, POSTED_JOB);
    await finishFinalGraph(testEnv.DB, runId, timestamp);
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);

    const candidate = await readCandidate(runId);
    expect(candidate.decision).toMatchObject({
      browseEligible: true,
      jobPostingEligible: true,
      publicationState: "published",
    });
    expect(candidate.decision.reasonCodes).toContain("job_posting_eligible");
    expect(candidate.locations[0]?.publicValue).toMatchObject({
      coordinateKind: "point",
      countryCode: "GE",
      scope: "locality",
    });
    expect(candidate.version).toMatchObject({
      datePosted: "2026-07-20",
      datePostedProvenance: "board-published",
      validThrough: "2026-09-30",
    });

    const promotion = await promoteProjectionCandidate(testEnv.DB, {
      allocationId: candidate.allocationId,
      runId,
      userId: operator.userId,
    });
    expect(promotion).toMatchObject({ created: true });

    const detail = await readPublicJobDetailWithMetadata(testEnv.DB, {
      publicId: candidate.publicJobId,
      slug: candidate.version.canonicalSlug,
    });
    if (detail.kind !== "serve") {
      throw new Error(`The promoted detail is ${detail.kind}, not served`);
    }
    expect(detail.metadata.jobPostingEligible).toBe(true);
    expect(detail.data.datePosted).toEqual({
      provenance: "board-published",
      value: "2026-07-20",
    });
    expect(detail.data.locations[0]).toMatchObject({
      coordinateKind: "point",
      locality: "Tbilisi",
      scope: "locality",
    });

    const outbox = await testEnv.DB.prepare(
      `SELECT event_type,canonical_path FROM google_indexing_events
        WHERE public_job_id=?`
    )
      .bind(candidate.publicJobId)
      .all<{ canonical_path: string; event_type: string }>();
    expect(outbox.results).toEqual([
      {
        canonical_path: detail.data.canonicalPath,
        event_type: "URL_UPDATED",
      },
    ]);
  });

  it("withholds JobPosting with a recorded reason when the board date is missing", async () => {
    await approveTeflPublication();
    const operator = await createAuthenticatedUser(
      "jobposting-withheld-operator@example.test"
    );
    const runId = "jobposting-withheld-run";
    const fixture = await seedProviderPointRun(runId, {});
    await finishFinalGraph(testEnv.DB, runId, timestamp);
    await advancePublicProjectionRuns(testEnv.DB);
    await advancePublicProjectionRuns(testEnv.DB);

    const candidate = await readCandidate(runId);
    expect(candidate.decision).toMatchObject({
      browseEligible: true,
      jobPostingEligible: false,
      publicationState: "published",
    });
    expect(candidate.decision.reasonCodes).toContain(
      "job_posting_original_date_missing"
    );
    expect(candidate.version.datePostedProvenance).toBe("unknown");

    await promoteProjectionCandidate(testEnv.DB, {
      allocationId: candidate.allocationId,
      runId,
      userId: operator.userId,
    });
    const detail = await readPublicJobDetailWithMetadata(testEnv.DB, {
      publicId: candidate.publicJobId,
      slug: candidate.version.canonicalSlug,
    });
    if (detail.kind !== "serve") {
      throw new Error(`The promoted detail is ${detail.kind}, not served`);
    }
    expect(detail.metadata.jobPostingEligible).toBe(false);
    expect(detail.data.datePosted).toBeNull();

    const decision = await testEnv.DB.prepare(
      `SELECT reason_codes_json FROM public_job_eligibility_decisions
        WHERE public_job_id=? ORDER BY decision_version DESC LIMIT 1`
    )
      .bind(candidate.publicJobId)
      .first<{ reason_codes_json: string }>();
    expect(
      JSON.parse(decision?.reason_codes_json ?? "[]") as string[]
    ).toContain("job_posting_original_date_missing");

    const outbox = await testEnv.DB.prepare(
      "SELECT COUNT(*) events FROM google_indexing_events WHERE public_job_id=?"
    )
      .bind(candidate.publicJobId)
      .first<{ events: number }>();
    expect(outbox?.events).toBe(0);
    expect(fixture.positions).toHaveLength(1);
  });

  it("counts pre-fix provider-point blocks with the production query", async () => {
    const runId = "jobposting-count-query-run";
    await seedProviderPointRun(runId, POSTED_JOB);
    await finishFinalGraph(testEnv.DB, runId, timestamp);
    const allocation = await testEnv.DB.prepare(
      `SELECT id,run_id FROM public_projection_allocation_components
        WHERE run_id=? LIMIT 1`
    )
      .bind(runId)
      .first<{ id: string; run_id: string }>();
    if (!allocation) {
      throw new Error("The count fixture produced no allocation component");
    }
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO public_projection_candidate_results (
          run_id,allocation_id,state,reason_code,created_at
        ) VALUES (?,?,'blocked','candidate_location_invalid',?)`
      ).bind(runId, allocation.id, timestamp),
      testEnv.DB.prepare(
        `INSERT INTO public_projection_candidate_seals (
          run_id,final_duplicate_seal_hash,result_count,prepared_count,
          blocked_count,result_digest,created_at
        )
        SELECT run_id,seal_hash,1,0,1,?,'2099-01-01T00:00:00.000Z'
          FROM public_projection_final_duplicate_seals WHERE run_id=?`
      ).bind("b".repeat(64), runId),
    ]);

    const blocked = await testEnv.DB.prepare(
      `SELECT COUNT(DISTINCT result.allocation_id) blocked_components
         FROM public_projection_candidate_results result
         JOIN public_projection_allocation_members member
           ON member.run_id=result.run_id
          AND member.allocation_id=result.allocation_id
          AND member.member_kind='shadow'
         JOIN public_projection_location_resolutions resolution
           ON resolution.run_id=result.run_id
          AND resolution.position_item_id=member.position_item_id
        WHERE result.run_id=(
            SELECT run_id FROM public_projection_candidate_seals
            ORDER BY created_at DESC LIMIT 1
          )
          AND result.state='blocked'
          AND result.reason_code='candidate_location_invalid'
          AND resolution.state='resolved'
          AND resolution.coordinate_kind='provider_point'`
    ).first<{ blocked_components: number }>();
    expect(blocked?.blocked_components).toBe(1);
  });
});
