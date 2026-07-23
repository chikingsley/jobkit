import type { InventoryJob } from "../../../../../src/features/inventory/schema";
import { testEnv, timestamp } from "./model";

export function jobFixture(id: string, sourceReference: string): InventoryJob {
  return {
    applyEmail: "jobs@example.test",
    applyUrl: "https://example.test/apply",
    board: "tefl",
    company: "Example School",
    compensation: {
      amountMaximum: 3000,
      amountMinimum: 2500,
      confidence: "exact",
      currency: "USD",
      display: "$2,500-$3,000 monthly",
      period: "month",
      qualifier: "range",
    },
    contactName: "Hiring Team",
    country: "Georgia",
    description: "Teach English in Tbilisi.",
    employerId: "employer-42",
    id,
    lastSeenAt: timestamp,
    location: "Tbilisi, Georgia",
    marketSegments: ["school"],
    salary: "$2,500-$3,000 monthly",
    sourceDates: {
      expires: { date: null, provenance: "unknown", raw: "" },
      posted: { date: null, provenance: "unknown", raw: "" },
    },
    sourceReference,
    sourceUrl: `https://example.test/jobs/${id}`,
    title: "English Teacher",
  };
}

export async function comparisonRows(runId: string) {
  const result = await testEnv.DB.prepare(
    `SELECT * FROM public_projection_duplicate_comparisons
      WHERE run_id=? ORDER BY id`
  )
    .bind(runId)
    .all<Record<string, unknown>>();
  return result.results;
}

export async function comparisonCount(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT COUNT(*) count FROM public_projection_duplicate_comparisons
      WHERE run_id=?`
  )
    .bind(runId)
    .first<{ count: number }>();
  return row?.count ?? -1;
}

export async function memberCount(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT COUNT(*) count FROM public_projection_duplicate_batch_members
      WHERE run_id=?`
  )
    .bind(runId)
    .first<{ count: number }>();
  return row?.count ?? -1;
}

export function batchRow(runId: string) {
  return testEnv.DB.prepare(
    "SELECT * FROM public_projection_duplicate_batches WHERE run_id=?"
  )
    .bind(runId)
    .first<Record<string, unknown>>();
}

export async function publicExposureCounts() {
  const row = await testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM public_browse_jobs) browse,
      (SELECT COUNT(*) FROM organic_index_jobs) organic,
      (SELECT COUNT(*) FROM job_posting_jobs) job_posting`
  ).first<{ browse: number; job_posting: number; organic: number }>();
  return {
    browse: row?.browse ?? -1,
    jobPosting: row?.job_posting ?? -1,
    organic: row?.organic ?? -1,
  };
}

export async function publicGraphCounts() {
  const row = await testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM public_jobs) jobs,
      (SELECT COUNT(*) FROM public_job_versions) versions,
      (SELECT COUNT(*) FROM public_job_heads) heads,
      (SELECT COUNT(*) FROM job_source_position_mapping_versions) mappings`
  ).first<{
    heads: number;
    jobs: number;
    mappings: number;
    versions: number;
  }>();
  return row ?? { heads: -1, jobs: -1, mappings: -1, versions: -1 };
}
