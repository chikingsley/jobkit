import type { PublicProjectionCandidate } from "../candidates/model";

export interface PromotionCandidateRow {
  candidate_hash: string;
  candidate_id: string;
  candidate_json: string;
  policy_heads_hash: string;
  result_digest: string;
  run_id: string;
  scope_json: string;
  source_watermark_json: string;
}

export interface PromotionCatalogHead {
  current_version: string;
  material_changed_at: string;
  membership_hash: string;
  search_content_hash: string;
  search_index_version: string;
}

export interface PromotionContext {
  candidate: PublicProjectionCandidate;
  candidateHash: string;
  candidateSealDigest: string;
  catalogHead: PromotionCatalogHead;
  manifestHash: string;
  manifestId: string;
  timestamp: string;
  userId: string;
}

export interface PromotionManifestRow {
  activated_catalog_version: string;
  allocation_id: string;
  authorized_at: string;
  candidate_hash: string;
  candidate_id: string;
  candidate_seal_digest: string;
  completed_at: string;
  eligibility_decision_version: number;
  id: string;
  manifest_hash: string;
  predecessor_catalog_version: string;
  public_job_id: string;
  public_job_version: number;
  run_id: string;
}

export interface PreparedMapping {
  fieldsUsed: string[];
  inputHash: string;
  listingId: string;
  mappingHash: string;
  mappingVersion: number;
  materialVersion: number;
  policyVersion: number;
  predecessorMappingVersion: number | null;
  sourceKey: string;
  sourcePositionId: string;
}

export class PublicProjectionPromotionError extends Error {
  readonly status: 404 | 409;

  constructor(
    message: string,
    status: 404 | 409 = 409,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "PublicProjectionPromotionError";
    this.status = status;
  }
}
