import type { InventoryJob } from "../../../../../src/features/inventory/schema";
import { canonicalSha256 } from "../../../../../worker/services/public-projection/hash";
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

export function fixtureHash(value: string) {
  return canonicalSha256({ value });
}

export async function finalArtifacts(runId: string) {
  const [components, relations] = await Promise.all([
    testEnv.DB.prepare(
      `SELECT * FROM public_projection_allocation_components
        WHERE run_id=? ORDER BY id`
    )
      .bind(runId)
      .all<Record<string, unknown>>(),
    testEnv.DB.prepare(
      `SELECT * FROM public_projection_final_duplicate_relations
        WHERE run_id=? ORDER BY id`
    )
      .bind(runId)
      .all<Record<string, unknown>>(),
  ]);
  return { components: components.results, relations: relations.results };
}

export function allocationRoots(runId: string) {
  return testEnv.DB.prepare(
    `SELECT * FROM public_projection_allocation_roots
      WHERE run_id=? ORDER BY public_job_id`
  )
    .bind(runId)
    .all<Record<string, unknown>>()
    .then((result) => result.results);
}

export function positionStages(runId: string) {
  return testEnv.DB.prepare(
    `SELECT stage,status FROM public_projection_position_items
      WHERE run_id=? ORDER BY source_position_id`
  )
    .bind(runId)
    .all<{ stage: string; status: string }>()
    .then((result) => result.results);
}

export function appendSealedAllocationMember(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_allocation_members (
      run_id,allocation_id,ordinal,member_key,member_kind,position_item_id,
      source_position_id,input_hash,public_job_id,public_job_version,
      eligibility_decision_version,member_hash,created_at
    )
    SELECT run_id,allocation_id,99,member_key,member_kind,position_item_id,
           source_position_id,input_hash,public_job_id,public_job_version,
           eligibility_decision_version,member_hash,created_at
      FROM public_projection_allocation_members
     WHERE run_id=? ORDER BY allocation_id,ordinal LIMIT 1`
  )
    .bind(runId)
    .run();
}

export function appendSealedAllocationRelation(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_allocation_relations (
      run_id,allocation_id,ordinal,relation_id,relation_hash,created_at
    )
    SELECT run_id,allocation_id,99,relation_id,relation_hash,created_at
      FROM public_projection_allocation_relations
     WHERE run_id=? ORDER BY allocation_id,ordinal LIMIT 1`
  )
    .bind(runId)
    .run();
}

export function appendSealedAllocationRoot(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_allocation_roots (
      run_id,allocation_id,ordinal,member_key,public_job_id,
      public_job_version,eligibility_decision_version,served_publicly,
      first_published_at,public_job_created_at,founding_source_position_id,
      selected,reason_code,root_hash,created_at
    )
    SELECT run_id,allocation_id,99,member_key,public_job_id,
           public_job_version,eligibility_decision_version,served_publicly,
           first_published_at,public_job_created_at,founding_source_position_id,
           selected,reason_code,root_hash,created_at
      FROM public_projection_allocation_roots
     WHERE run_id=? ORDER BY allocation_id,ordinal LIMIT 1`
  )
    .bind(runId)
    .run();
}

export function appendSealedFinalRelation(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_final_duplicate_relations
     SELECT * FROM public_projection_final_duplicate_relations
      WHERE run_id=? ORDER BY id LIMIT 1`
  )
    .bind(runId)
    .run();
}

export function appendSealedComponent(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_allocation_components
     SELECT * FROM public_projection_allocation_components
      WHERE run_id=? ORDER BY id LIMIT 1`
  )
    .bind(runId)
    .run();
}

export function appendSealedCanonicalInput(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_final_canonical_live_inputs
     SELECT * FROM public_projection_final_canonical_live_inputs
      WHERE run_id=? ORDER BY public_job_id LIMIT 1`
  )
    .bind(runId)
    .run();
}

export function appendSealedMappingInput(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_final_source_mapping_inputs
     SELECT * FROM public_projection_final_source_mapping_inputs
      WHERE run_id=? ORDER BY source_position_id LIMIT 1`
  )
    .bind(runId)
    .run();
}

export function appendSealedFinalSeal(runId: string) {
  return testEnv.DB.prepare(
    `INSERT INTO public_projection_final_duplicate_seals
     SELECT * FROM public_projection_final_duplicate_seals WHERE run_id=?`
  )
    .bind(runId)
    .run();
}

export async function runLifecycle(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT run.status run_status,
            (SELECT COUNT(*)
               FROM public_projection_final_duplicate_seals final_seal
              WHERE final_seal.run_id=run.id) final_seal_count
       FROM public_projection_runs run
      WHERE run.id=?`
  )
    .bind(runId)
    .first<{ final_seal_count: number; run_status: string }>();
  if (!row) {
    throw new Error(`Missing run lifecycle fixture ${runId}`);
  }
  return {
    finalSealCount: row.final_seal_count,
    runStatus: row.run_status,
  };
}

export async function runState(runId: string) {
  const row = await testEnv.DB.prepare(
    "SELECT status,error_code FROM public_projection_runs WHERE id=?"
  )
    .bind(runId)
    .first<{ error_code: string; status: string }>();
  if (!row) {
    throw new Error(`Missing run state fixture ${runId}`);
  }
  return { errorCode: row.error_code, status: row.status };
}

export function stableComponents(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({
    allocationHash: row.allocation_hash,
    foundingSourcePositionId: row.founding_source_position_id,
    id: row.id,
    proposedPublicJobId: row.proposed_public_job_id,
    reasonCode: row.reason_code,
    state: row.state,
    winningPublicJobId: row.winning_public_job_id,
  }));
}

export function stableRelations(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({
    id: row.id,
    leftMemberKey: row.left_member_key,
    reasonCode: row.reason_code,
    relation: row.relation,
    relationHash: row.relation_hash,
    rightMemberKey: row.right_member_key,
  }));
}

export async function liveGraphCounts() {
  const row = await testEnv.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM public_jobs) jobs,
      (SELECT COUNT(*) FROM public_job_versions) versions,
      (SELECT COUNT(*) FROM public_job_heads) heads,
      (SELECT COUNT(*) FROM public_job_allocations) allocations,
      (SELECT COUNT(*) FROM job_source_position_mapping_versions) mappings,
      (SELECT COUNT(*) FROM public_job_eligibility_decisions) decisions,
      (SELECT COUNT(*) FROM public_job_identity_signals) signals`
  ).first<Record<string, number>>();
  return row;
}

export async function liveGraphCountsExcludingMappings() {
  const row = await liveGraphCounts();
  if (!row) {
    throw new Error("Missing live graph count snapshot");
  }
  const { mappings: _intentionalMappingMutation, ...publicationCounts } = row;
  return publicationCounts;
}
