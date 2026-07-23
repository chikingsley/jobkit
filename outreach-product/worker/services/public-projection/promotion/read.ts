import { projectionSnapshotDrift } from "../advancement/completion";
import { PublicProjectionCandidateSchema } from "../candidates/model";
import { canonicalSha256 } from "../hash";
import type {
  PromotionCandidateRow,
  PromotionCatalogHead,
  PromotionManifestRow,
} from "./model";
import { PublicProjectionPromotionError } from "./model";

export function readPromotionManifest(
  db: D1Database,
  runId: string,
  allocationId: string
) {
  return db
    .prepare(
      `SELECT id,run_id,allocation_id,candidate_id,candidate_hash,
              candidate_seal_digest,predecessor_catalog_version,
              activated_catalog_version,public_job_id,public_job_version,
              eligibility_decision_version,authorized_at,manifest_hash,
              completed_at
         FROM public_projection_promotion_manifests
        WHERE run_id=? AND allocation_id=? LIMIT 1`
    )
    .bind(runId, allocationId)
    .first<PromotionManifestRow>();
}

export async function readPromotionCandidate(
  db: D1Database,
  runId: string,
  allocationId: string
) {
  const row = await db
    .prepare(
      `SELECT result.run_id,result.candidate_id,result.candidate_hash,
              result.candidate_json,seal.result_digest,run.policy_heads_hash,
              run.source_watermark_json,run.scope_json
         FROM public_projection_candidate_results result
         JOIN public_projection_candidate_seals seal
           ON seal.run_id=result.run_id
         JOIN public_projection_runs run ON run.id=result.run_id
        WHERE result.run_id=? AND result.allocation_id=?
          AND result.state='prepared' LIMIT 1`
    )
    .bind(runId, allocationId)
    .first<PromotionCandidateRow>();
  if (!row) {
    throw new PublicProjectionPromotionError(
      "Prepared projection candidate was not found",
      404
    );
  }
  const candidate = PublicProjectionCandidateSchema.parse(
    JSON.parse(row.candidate_json)
  );
  const candidateHash = await canonicalSha256(candidate);
  if (
    candidate.runId !== runId ||
    candidate.allocationId !== allocationId ||
    candidate.candidateId !== row.candidate_id ||
    candidateHash !== row.candidate_hash ||
    candidate.policyHeadsHash !== row.policy_heads_hash ||
    candidate.sourceWatermarkJson !== row.source_watermark_json
  ) {
    throw new PublicProjectionPromotionError(
      "Prepared projection candidate failed its immutable hash check"
    );
  }
  const drift = await projectionSnapshotDrift(db, {
    policy_heads_hash: row.policy_heads_hash,
    scope_json: row.scope_json,
    source_watermark_json: row.source_watermark_json,
  });
  if (drift) {
    throw new PublicProjectionPromotionError(
      `Projection candidate is stale: ${drift}`
    );
  }
  return {
    candidate,
    candidateHash,
    candidateSealDigest: row.result_digest,
  };
}

export async function readPromotionCatalogHead(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT pointer.current_version,version.material_changed_at,
              version.membership_hash,version.search_content_hash,
              version.search_index_version
         FROM public_job_catalog_head_pointer pointer
         JOIN public_job_catalog_versions version
           ON version.version=pointer.current_version
        WHERE pointer.singleton=1 LIMIT 1`
    )
    .first<PromotionCatalogHead>();
  if (!row) {
    throw new PublicProjectionPromotionError(
      "Public catalog head is unavailable"
    );
  }
  return row;
}
