import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";
import { createAuthenticatedUser } from "../auth";
import {
  advanceUntilFinalDuplicateComplete,
  createRun,
  getRun,
  listingStageCounts,
  publicExposureCounts,
  publicMutationCounts,
  rotatePolicyHead,
  seedListings,
  sessionRequest,
  testEnv,
} from "./support";

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare(
    `DELETE FROM public_projection_duplicate_work
      WHERE run_id NOT IN (
        SELECT run_id FROM public_projection_duplicate_batches
      )`
  ).run();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `DELETE FROM public_projection_position_items
        WHERE run_id NOT IN (
          SELECT run_id FROM public_projection_duplicate_work
        )`
    ),
    testEnv.DB.prepare(
      `DELETE FROM public_projection_listing_items
        WHERE run_id NOT IN (
          SELECT run_id FROM public_projection_duplicate_work
        )`
    ),
    testEnv.DB.prepare(
      `DELETE FROM public_projection_runs
        WHERE id NOT IN (
          SELECT run_id FROM public_projection_duplicate_work
        )`
    ),
  ]);
});

describe("private public-projection operations", () => {
  it("limits creation and status to operators and reuses canonical requests", async () => {
    const member = await createAuthenticatedUser(
      "projection-member@example.test",
      "member"
    );
    const operator = await createAuthenticatedUser(
      "projection-operator@example.test"
    );
    const secondOperator = await createAuthenticatedUser(
      "projection-second-operator@example.test"
    );
    const memberCreate = await sessionRequest(
      "/api/operator/public-projection/runs",
      member.cookie,
      "POST",
      { mode: "shadow", scope: { boards: ["tefl"] } }
    );
    expect(memberCreate.status).toBe(403);
    await expect(memberCreate.json()).resolves.toMatchObject({
      message: "Operator access is required for public projection runs",
      ok: false,
    });

    const first = await createRun(operator.cookie, {
      mode: "shadow",
      scope: { boards: ["tefl", "tefl"], listingIds: [] },
    });
    const repeated = await createRun(secondOperator.cookie, {
      mode: "shadow",
      scope: { boards: ["tefl"], listingIds: [] },
    });
    expect(repeated.run.id).toBe(first.run.id);
    await expect(
      testEnv.DB.prepare(
        "SELECT COUNT(*) count FROM public_projection_runs"
      ).first<{ count: number }>()
    ).resolves.toEqual({ count: 1 });
    await expect(
      testEnv.DB.prepare(
        "SELECT requested_by_user_id FROM public_projection_runs WHERE id=?"
      )
        .bind(first.run.id)
        .first()
    ).resolves.toEqual({ requested_by_user_id: operator.userId });

    const memberStatus = await sessionRequest(
      `/api/operator/public-projection/runs/${first.run.id}`,
      member.cookie
    );
    expect(memberStatus.status).toBe(403);
    const operatorStatus = await sessionRequest(
      `/api/operator/public-projection/runs/${first.run.id}`,
      operator.cookie
    );
    expect(operatorStatus.status).toBe(200);
    await expect(operatorStatus.json()).resolves.toMatchObject({
      ok: true,
      run: { id: first.run.id, mode: "shadow", status: "queued" },
    });

    const liveMode = await sessionRequest(
      "/api/operator/public-projection/runs",
      operator.cookie,
      "POST",
      { mode: "live", scope: {} }
    );
    expect(liveMode.status).toBe(400);
  });

  it("selects a deterministic page and advances at most 25 listing items", async () => {
    await seedListings(30, "bounded-projection");
    const operator = await createAuthenticatedUser(
      "projection-bounded@example.test"
    );
    const created = await createRun(operator.cookie, {
      mode: "shadow",
      scope: { boards: ["bounded-projection"], listingIds: [] },
    });

    const firstAdvance = await advancePublicProjectionRuns(testEnv.DB);
    expect(firstAdvance).toMatchObject({
      advanced: 25,
      blocked: 0,
      invariantFailed: false,
      runId: created.run.id,
      selected: 30,
    });
    await expect(listingStageCounts(created.run.id)).resolves.toEqual([
      { count: 25, stage: "prerequisites" },
      { count: 5, stage: "selected" },
    ]);
    await expect(publicExposureCounts()).resolves.toEqual({
      browse: 0,
      jobPosting: 0,
      organic: 0,
    });
    await expect(publicMutationCounts()).resolves.toEqual({
      decisions: 0,
      eligibilityHeads: 0,
      jobHeads: 0,
    });

    const secondAdvance = await advancePublicProjectionRuns(testEnv.DB);
    expect(secondAdvance).toMatchObject({ advanced: 5, selected: 0 });
    const status = await getRun(operator.cookie, created.run.id);
    expect(status.run).toMatchObject({
      counters: { listings: { blocked: 0, total: 30 } },
      items: {
        listings: {
          byStage: { prerequisites: 30 },
          byStatus: { queued: 30 },
        },
      },
      selectionComplete: true,
      status: "running",
    });

    await seedListings(1, "next-projection");
    const nextRun = await createRun(operator.cookie, {
      mode: "shadow",
      scope: { boards: ["next-projection"], listingIds: [] },
    });
    const fairRotation = await advancePublicProjectionRuns(testEnv.DB);
    expect(fairRotation).toMatchObject({
      prerequisiteWaiting: 25,
      runId: created.run.id,
    });
    const nextAdvance = await advancePublicProjectionRuns(testEnv.DB);
    expect(nextAdvance).toMatchObject({
      advanced: 1,
      runId: nextRun.run.id,
      selected: 1,
    });
  });

  it("blocks legacy material snapshots and reports their reason", async () => {
    await seedListings(1, "legacy-projection", { legacy: true });
    const operator = await createAuthenticatedUser(
      "projection-legacy@example.test"
    );
    const created = await createRun(operator.cookie, {
      mode: "shadow",
      scope: { boards: ["legacy-projection"], listingIds: [] },
    });

    const result = await advancePublicProjectionRuns(testEnv.DB);
    expect(result).toMatchObject({ advanced: 0, blocked: 1, selected: 1 });
    await expect(advanceUntilFinalDuplicateComplete()).resolves.toMatchObject({
      duplicateState: "complete",
      finalDuplicateState: "complete",
      runId: created.run.id,
    });
    const status = await getRun(operator.cookie, created.run.id);
    expect(status.run).toMatchObject({
      counters: { listings: { blocked: 1, total: 1 } },
      reasonCounts: { legacy_material_snapshot: 1 },
      selectionComplete: true,
      status: "completed_with_blocks",
    });
    await expect(publicExposureCounts()).resolves.toEqual({
      browse: 0,
      jobPosting: 0,
      organic: 0,
    });
    await expect(publicMutationCounts()).resolves.toEqual({
      decisions: 0,
      eligibilityHeads: 0,
      jobHeads: 0,
    });
  });

  it("fails when any member of the source cohort changes", async () => {
    await seedListings(3, "cohort-drift");
    const operator = await createAuthenticatedUser(
      "projection-cohort-drift@example.test"
    );
    const created = await createRun(operator.cookie, {
      mode: "shadow",
      scope: { boards: ["cohort-drift"], listingIds: [] },
    });
    const successorHash = "f".repeat(64);
    const successorTime = "2026-07-22T13:00:00.000Z";
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO job_listing_versions (
          listing_id,material_version,material_hash,material_hash_version,
          material_json,source_posted_date,source_posted_date_raw,
          source_posted_date_provenance,source_expiry_date,
          source_expiry_date_raw,source_expiry_date_provenance,
          inventory_run_id,created_at
        )
        SELECT listing_id,2,?,1,?,source_posted_date,
               source_posted_date_raw,source_posted_date_provenance,
               source_expiry_date,source_expiry_date_raw,
               source_expiry_date_provenance,inventory_run_id,?
          FROM job_listing_versions
         WHERE listing_id='cohort-drift-01' AND material_version=1`
      ).bind(
        successorHash,
        JSON.stringify({
          id: "cohort-drift-01",
          title: "Changed cohort listing",
        }),
        successorTime
      ),
      testEnv.DB.prepare(
        `UPDATE job_listings
            SET material_hash=?,material_hash_version=1,material_version=2
          WHERE id='cohort-drift-01'`
      ).bind(successorHash),
    ]);

    const result = await advancePublicProjectionRuns(testEnv.DB);
    expect(result).toMatchObject({
      advanced: 0,
      drift: "source_watermark_changed",
      runId: created.run.id,
      selected: 0,
    });
    const status = await getRun(operator.cookie, created.run.id);
    expect(status.run).toMatchObject({
      error: { code: "source_watermark_changed" },
      status: "failed",
    });
  });

  it("fails when a publication policy head rotates", async () => {
    await seedListings(1, "policy-drift");
    const operator = await createAuthenticatedUser(
      "projection-policy-drift@example.test"
    );
    const created = await createRun(operator.cookie, {
      mode: "shadow",
      scope: { boards: ["policy-drift"], listingIds: [] },
    });
    await rotatePolicyHead("eslcafe-modern");

    const result = await advancePublicProjectionRuns(testEnv.DB);
    expect(result).toMatchObject({
      advanced: 0,
      drift: "policy_heads_changed",
      runId: created.run.id,
      selected: 0,
    });
    const status = await getRun(operator.cookie, created.run.id);
    expect(status.run).toMatchObject({
      error: { code: "policy_heads_changed" },
      status: "failed",
    });
  });
});
