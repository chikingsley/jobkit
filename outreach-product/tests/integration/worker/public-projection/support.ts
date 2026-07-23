import type { D1Migration } from "cloudflare:test";

import { env, exports } from "cloudflare:workers";

import {
  inventoryJobMaterialHash,
  serializeInventoryJobMaterial,
} from "../../../../src/features/inventory/content";

import type { InventoryJob } from "../../../../src/features/inventory/schema";

import { advancePublicProjectionRuns } from "../../../../worker/services/public-projection/advancement";

export interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

export interface ProjectionRunResponse {
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

export const testEnv = env as TestEnv;

export const timestamp = "2026-07-22T12:00:00.000Z";

export async function createRun(cookie: string, body: unknown) {
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

export async function getRun(cookie: string, runId: string) {
  const response = await sessionRequest(
    `/api/operator/public-projection/runs/${runId}`,
    cookie
  );
  if (response.status !== 200) {
    throw new Error(`Projection run status returned ${response.status}`);
  }
  return (await response.json()) as ProjectionRunResponse;
}

export function sessionRequest(
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

export async function seedListings(
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

export async function listingStageCounts(runId: string) {
  const result = await testEnv.DB.prepare(
    `SELECT stage,COUNT(*) count FROM public_projection_listing_items
      WHERE run_id=? GROUP BY stage ORDER BY stage`
  )
    .bind(runId)
    .all<{ count: number; stage: string }>();
  return result.results;
}

export async function publicExposureCounts() {
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

export async function publicMutationCounts() {
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

export async function advanceUntilFinalDuplicateComplete() {
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

export async function rotatePolicyHead(sourceKey: string) {
  const head = await testEnv.DB.prepare(
    `SELECT current_version FROM source_publication_policy_heads
      WHERE source_key=?`
  )
    .bind(sourceKey)
    .first<{ current_version: number }>();
  if (!head) {
    throw new Error(`Publication policy head is missing for ${sourceKey}`);
  }
  const nextVersion = head.current_version + 1;
  await testEnv.DB.prepare(
    `INSERT INTO source_publication_policy_versions (
      source_key,version,predecessor_version,approval_state,
      publication_scope,publication_enabled,allowed_fields_json,
      attribution_mode,max_verbatim_chars,source_origin_url,terms_url,
      terms_checked_at,robots_url,robots_checked_at,evidence_json,
      decision_note,policy_hash,idempotency_key,created_at
    )
    SELECT source_key,?,?,approval_state,publication_scope,
           publication_enabled,allowed_fields_json,attribution_mode,
           max_verbatim_chars,source_origin_url,terms_url,terms_checked_at,
           robots_url,robots_checked_at,evidence_json,'Policy rotation test',
           ?,?,?
      FROM source_publication_policy_versions
     WHERE source_key=? AND version=?`
  )
    .bind(
      nextVersion,
      head.current_version,
      "e".repeat(64),
      `projection-policy-v${nextVersion}`,
      timestamp,
      sourceKey,
      head.current_version
    )
    .run();
  await testEnv.DB.prepare(
    `UPDATE source_publication_policy_heads
        SET current_version=?,updated_at=? WHERE source_key=?`
  )
    .bind(nextVersion, timestamp, sourceKey)
    .run();
}
