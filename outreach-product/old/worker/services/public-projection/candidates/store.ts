import { z } from "zod";
import { canonicalJson, canonicalSha256 } from "../hash";
import { projectionRunCounterStatement } from "../listing-items";
import { ProjectionListingSnapshotError } from "../listing-snapshot";
import { buildProjectionCandidate } from "./build";
import type { CandidateAllocationRow } from "./model";
import {
  CandidateInputError,
  readCandidateSources,
  readNextCandidateAllocation,
} from "./read-input";

interface CandidateResultRow {
  allocation_id: string;
  candidate_hash: string | null;
  reason_code: string;
  state: "blocked" | "prepared";
}

interface FinalSealRow {
  allocation_count: number;
  seal_hash: string;
}

export async function processNextProjectionCandidate(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  const allocation = await readNextCandidateAllocation(db, runId);
  if (!allocation) {
    return {
      processed: 0,
      sealed: await sealProjectionCandidates(db, runId, timestamp),
    };
  }
  if (allocation.state === "blocked") {
    await storeBlockedCandidate(
      db,
      allocation,
      allocation.reason_code,
      timestamp
    );
    return { blocked: 1, prepared: 0, processed: 1, sealed: false };
  }
  const sources = await readCandidateSources(db, allocation);
  if (sources.length === 0) {
    await storeBlockedCandidate(
      db,
      allocation,
      "candidate_sources_missing",
      timestamp
    );
    return { blocked: 1, prepared: 0, processed: 1, sealed: false };
  }
  try {
    const candidate = await buildProjectionCandidate(
      db,
      allocation,
      sources,
      timestamp
    );
    const candidateJson = canonicalJson(candidate);
    const candidateHash = await canonicalSha256(candidate);
    await commitCandidateResult(db, allocation, timestamp, {
      browseEligible: candidate.decision.browseEligible,
      candidateHash,
      candidateId: candidate.candidateId,
      candidateJson,
      jobPostingEligible: candidate.decision.jobPostingEligible,
      organicIndexEligible: candidate.decision.organicIndexEligible,
      publicJobId: candidate.publicJobId,
      reasonCode: "candidate_prepared",
      sourcePositionId: candidate.sourcePositionId,
      state: "prepared",
    });
    return { blocked: 0, prepared: 1, processed: 1, sealed: false };
  } catch (error) {
    const reasonCode = candidateBlockReason(error);
    if (!reasonCode) {
      throw error;
    }
    await storeBlockedCandidate(db, allocation, reasonCode, timestamp);
    return { blocked: 1, prepared: 0, processed: 1, sealed: false };
  }
}

async function storeBlockedCandidate(
  db: D1Database,
  allocation: CandidateAllocationRow,
  reasonCode: string,
  timestamp: string
) {
  await commitCandidateResult(db, allocation, timestamp, {
    browseEligible: false,
    candidateHash: null,
    candidateId: null,
    candidateJson: null,
    jobPostingEligible: false,
    organicIndexEligible: false,
    publicJobId: null,
    reasonCode,
    sourcePositionId: null,
    state: "blocked",
  });
}

async function commitCandidateResult(
  db: D1Database,
  allocation: CandidateAllocationRow,
  timestamp: string,
  result: {
    browseEligible: boolean;
    candidateHash: string | null;
    candidateId: string | null;
    candidateJson: string | null;
    jobPostingEligible: boolean;
    organicIndexEligible: boolean;
    publicJobId: string | null;
    reasonCode: string;
    sourcePositionId: string | null;
    state: "blocked" | "prepared";
  }
) {
  const leaseToken = crypto.randomUUID();
  const terminalStatus = result.state === "prepared" ? "completed" : "blocked";
  const errorDetail =
    result.state === "prepared"
      ? ""
      : "The sealed allocation could not produce a public candidate";
  await db.batch([
    db
      .prepare(
        `UPDATE public_projection_position_items
            SET stage='eligibility',status='processing',
                attempt_count=attempt_count+1,
                lease_owner='public-candidate-materializer-v1',lease_token=?,
                lease_expires_at='2099-01-01T00:00:00.000Z',
                started_at=COALESCE(started_at,?),updated_at=?
          WHERE run_id=? AND stage='content' AND status='queued'
            AND attempt_count<max_attempts AND EXISTS (
              SELECT 1 FROM public_projection_allocation_members member
               WHERE member.run_id=public_projection_position_items.run_id
                 AND member.position_item_id=public_projection_position_items.id
                 AND member.allocation_id=? AND member.member_kind='shadow'
            )`
      )
      .bind(
        leaseToken,
        timestamp,
        timestamp,
        allocation.run_id,
        allocation.allocation_id
      ),
    candidatePositionChangeAssertion(db, allocation),
    db
      .prepare(
        `UPDATE public_projection_position_items
            SET stage='completed',status=?,public_job_id=NULL,
                simulated_browse_eligible=?,simulated_organic_eligible=?,
                simulated_job_posting_eligible=?,
                readiness_json=json_object('candidateState',?),
                reason_codes_json=json_array(?),
                checkpoint_json=json_set(
                  checkpoint_json,'$.candidateResult',
                  json_object('state',?,'reasonCode',?)
                ),
                lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
                error_code=?,error_detail=?,completed_at=?,updated_at=?
          WHERE run_id=? AND stage='eligibility' AND status='processing'
            AND lease_owner='public-candidate-materializer-v1'
            AND lease_token=? AND EXISTS (
              SELECT 1 FROM public_projection_allocation_members member
               WHERE member.run_id=public_projection_position_items.run_id
                 AND member.position_item_id=public_projection_position_items.id
                 AND member.allocation_id=? AND member.member_kind='shadow'
            )`
      )
      .bind(
        terminalStatus,
        result.browseEligible ? 1 : 0,
        result.organicIndexEligible ? 1 : 0,
        result.jobPostingEligible ? 1 : 0,
        result.state,
        result.reasonCode,
        result.state,
        result.reasonCode,
        result.state === "prepared" ? "" : result.reasonCode,
        errorDetail,
        timestamp,
        timestamp,
        allocation.run_id,
        leaseToken,
        allocation.allocation_id
      ),
    candidatePositionChangeAssertion(db, allocation),
    candidateResultInsert(db, allocation, timestamp, result),
    projectionRunCounterStatement(db, allocation.run_id, timestamp),
  ]);
}

function candidatePositionChangeAssertion(
  db: D1Database,
  allocation: CandidateAllocationRow
) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_assertions (
        expected_changes,actual_changes
      ) SELECT COUNT(*),changes()
          FROM public_projection_allocation_members
         WHERE run_id=? AND allocation_id=? AND member_kind='shadow'`
    )
    .bind(allocation.run_id, allocation.allocation_id);
}

function candidateResultInsert(
  db: D1Database,
  allocation: CandidateAllocationRow,
  timestamp: string,
  result: {
    browseEligible: boolean;
    candidateHash: string | null;
    candidateId: string | null;
    candidateJson: string | null;
    jobPostingEligible: boolean;
    organicIndexEligible: boolean;
    publicJobId: string | null;
    reasonCode: string;
    sourcePositionId: string | null;
    state: "blocked" | "prepared";
  }
) {
  return db
    .prepare(
      `INSERT INTO public_projection_candidate_results (
        run_id,allocation_id,state,reason_code,public_job_id,
        source_position_id,candidate_id,candidate_hash,candidate_json,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      allocation.run_id,
      allocation.allocation_id,
      result.state,
      result.reasonCode,
      result.publicJobId,
      result.sourcePositionId,
      result.candidateId,
      result.candidateHash,
      result.candidateJson,
      timestamp
    );
}

async function sealProjectionCandidates(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  const existing = await db
    .prepare(
      `SELECT 1 present FROM public_projection_candidate_seals
        WHERE run_id=? LIMIT 1`
    )
    .bind(runId)
    .first<{ present: number }>();
  if (existing) {
    return true;
  }
  const finalSeal = await db
    .prepare(
      `SELECT allocation_count,seal_hash
         FROM public_projection_final_duplicate_seals
        WHERE run_id=? LIMIT 1`
    )
    .bind(runId)
    .first<FinalSealRow>();
  if (!finalSeal) {
    return false;
  }
  const results = await db
    .prepare(
      `SELECT allocation_id,state,reason_code,candidate_hash
         FROM public_projection_candidate_results
        WHERE run_id=? ORDER BY allocation_id`
    )
    .bind(runId)
    .all<CandidateResultRow>();
  if (results.results.length !== finalSeal.allocation_count) {
    return false;
  }
  const preparedCount = results.results.filter(
    ({ state }) => state === "prepared"
  ).length;
  const resultDigest = await canonicalSha256(
    results.results.map((row) => ({
      allocationId: row.allocation_id,
      candidateHash: row.candidate_hash,
      reasonCode: row.reason_code,
      state: row.state,
    }))
  );
  await db
    .prepare(
      `INSERT INTO public_projection_candidate_seals (
        run_id,final_duplicate_seal_hash,result_count,prepared_count,
        blocked_count,result_digest,created_at
      ) VALUES (?,?,?,?,?,?,?)`
    )
    .bind(
      runId,
      finalSeal.seal_hash,
      results.results.length,
      preparedCount,
      results.results.length - preparedCount,
      resultDigest,
      timestamp
    )
    .run();
  return true;
}

function candidateBlockReason(error: unknown) {
  if (error instanceof CandidateInputError) {
    return error.code;
  }
  if (error instanceof ProjectionListingSnapshotError) {
    return `candidate_${error.code}`;
  }
  if (error instanceof z.ZodError) {
    return "candidate_schema_invalid";
  }
  return null;
}
