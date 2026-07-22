import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../src/features/inventory/content";
import type { InventoryJob } from "../../../src/features/inventory/schema";
import { advancePublicProjectionRuns } from "../../../worker/services/public-projection/advancement";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

interface ProjectionRunResponse {
  run: {
    counters: {
      listings: { blocked: number; total: number };
    };
    error: { code: string; detail: string } | null;
    id: string;
    items: {
      listings: {
        byStage: Record<string, number>;
        byStatus: Record<string, number>;
      };
    };
    reasonCounts: Record<string, number>;
    selectionComplete: boolean;
    status: string;
  };
}

const testEnv = env as TestEnv;
const timestamp = "2026-07-22T12:00:00.000Z";

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

async function createRun(cookie: string, body: unknown) {
  const response = await sessionRequest(
    "/api/operator/public-projection/runs",
    cookie,
    "POST",
    body
  );
  if (response.status !== 202) {
    throw new Error(`Projection run creation returned ${response.status}`);
  }
  return (await response.json()) as ProjectionRunResponse;
}

async function getRun(cookie: string, runId: string) {
  const response = await sessionRequest(
    `/api/operator/public-projection/runs/${runId}`,
    cookie
  );
  if (response.status !== 200) {
    throw new Error(`Projection run status returned ${response.status}`);
  }
  return (await response.json()) as ProjectionRunResponse;
}

function sessionRequest(
  path: string,
  cookie: string,
  method = "GET",
  body?: unknown
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      cookie,
    },
    method,
  });
}

async function seedListings(
  count: number,
  board: string,
  options: { legacy?: boolean } = {}
) {
  const materialHashVersion = options.legacy ? 0 : 1;
  const statements: D1PreparedStatement[] = [];
  const listings = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const id = `${board}-${index.toString().padStart(2, "0")}`;
      const job: InventoryJob = {
        applyEmail: "",
        applyUrl: `https://example.test/${id}`,
        board,
        company: "Projection School",
        compensation: {
          amountMaximum: null,
          amountMinimum: null,
          confidence: "unknown",
          currency: null,
          display: "",
          period: null,
          qualifier: null,
        },
        contactName: "",
        country: "",
        description: `Projection listing ${index} description`,
        employerId: "",
        id,
        lastSeenAt: timestamp,
        location: "",
        marketSegments: [],
        salary: "",
        sourceDates: {
          expires: { date: null, provenance: "unknown", raw: "" },
          posted: { date: null, provenance: "unknown", raw: "" },
        },
        sourceReference: id,
        sourceUrl: `https://example.test/${id}`,
        title: `Projection listing ${index}`,
      };
      const materialHash = await inventoryJobMaterialHash(job);
      const materialJson = serializeInventoryJobMaterial(job);
      return { id, job, materialHash, materialJson };
    })
  );
  for (const { id, job, materialHash, materialJson } of listings) {
    statements.push(
      testEnv.DB.prepare(
        `INSERT INTO job_listings (
          id,board,title,description,apply_url,first_seen_at,updated_at,
          inventory_status,material_hash,material_hash_version,
          material_version,material_changed_at
        ) VALUES (?,?,?,?,?,?,?,'active',?,?,1,?)`
      ).bind(
        id,
        board,
        job.title,
        job.description,
        job.applyUrl,
        timestamp,
        timestamp,
        materialHash,
        materialHashVersion,
        timestamp
      ),
      testEnv.DB.prepare(
        `INSERT INTO job_listing_versions (
          listing_id,material_version,material_hash,material_hash_version,
          material_json,created_at
        ) VALUES (?,1,?,?,?,?)`
      ).bind(
        id,
        materialHash,
        materialHashVersion,
        options.legacy ? null : materialJson,
        timestamp
      )
    );
  }
  await testEnv.DB.batch(statements);
}

async function listingStageCounts(runId: string) {
  const result = await testEnv.DB.prepare(
    `SELECT stage,COUNT(*) count FROM public_projection_listing_items
      WHERE run_id=? GROUP BY stage ORDER BY stage`
  )
    .bind(runId)
    .all<{ count: number; stage: string }>();
  return result.results;
}

async function publicExposureCounts() {
  const counts = await testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM public_browse_jobs) browse,
      (SELECT COUNT(*) FROM organic_index_jobs) organic,
      (SELECT COUNT(*) FROM job_posting_jobs) job_posting`
  ).first<{ browse: number; job_posting: number; organic: number }>();
  return {
    browse: counts?.browse ?? -1,
    jobPosting: counts?.job_posting ?? -1,
    organic: counts?.organic ?? -1,
  };
}

async function publicMutationCounts() {
  const counts = await testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM public_job_heads) job_heads,
      (SELECT COUNT(*) FROM public_job_eligibility_heads) eligibility_heads,
      (SELECT COUNT(*) FROM public_job_eligibility_decisions) decisions`
  ).first<{
    decisions: number;
    eligibility_heads: number;
    job_heads: number;
  }>();
  return {
    decisions: counts?.decisions ?? -1,
    eligibilityHeads: counts?.eligibility_heads ?? -1,
    jobHeads: counts?.job_heads ?? -1,
  };
}

async function advanceUntilFinalDuplicateComplete() {
  for (let attempt = 0; attempt < 512; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: D3 intentionally advances one durable page per invocation.
    const result = await advancePublicProjectionRuns(testEnv.DB);
    if (
      result &&
      "finalDuplicateState" in result &&
      result.finalDuplicateState === "complete"
    ) {
      return result;
    }
  }
  throw new Error("The durable final duplicate drain exceeded its page budget");
}

async function rotatePolicyHead(sourceKey: string) {
  await testEnv.DB.prepare(
    `INSERT INTO source_publication_policy_versions (
      source_key,version,predecessor_version,approval_state,
      publication_scope,publication_enabled,allowed_fields_json,
      attribution_mode,max_verbatim_chars,source_origin_url,terms_url,
      terms_checked_at,robots_url,robots_checked_at,evidence_json,
      decision_note,policy_hash,idempotency_key,created_at
    )
    SELECT source_key,2,1,approval_state,publication_scope,
           publication_enabled,allowed_fields_json,attribution_mode,
           max_verbatim_chars,source_origin_url,terms_url,terms_checked_at,
           robots_url,robots_checked_at,evidence_json,'Policy rotation test',
           ?,?,?
      FROM source_publication_policy_versions
     WHERE source_key=? AND version=1`
  )
    .bind("e".repeat(64), "projection-policy-v2", timestamp, sourceKey)
    .run();
  await testEnv.DB.prepare(
    `UPDATE source_publication_policy_heads
        SET current_version=2,updated_at=? WHERE source_key=?`
  )
    .bind(timestamp, sourceKey)
    .run();
}
