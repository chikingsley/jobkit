export const PUBLIC_DUPLICATE_FINALIZATION_VERSION =
  "public-duplicate-finalization-v1" as const;

export const PUBLIC_JOB_ALLOCATION_VERSION =
  "public-job-allocation-v1" as const;

export const PUBLIC_FINAL_GRAPH_MAX_BINDING_BYTES = 1_000_000;

export const PUBLIC_FINAL_GRAPH_MAX_BINDING_ROWS = 24;

export interface FinalGraphBoundary {
  blockedResolutionCount: number;
  duplicateBatchInputHash: string;
  duplicateMemberCount: number;
  mode: string;
  resolutionCount: number;
  resolvedPositionCount: number;
  runId: string;
  runStatus: string;
  selectionComplete: number;
}

export interface FinalGraphMemberSnapshot {
  canonicalSignalHash: null | string;
  checkpointJson: string;
  inputHash: string;
  positionItemId: string;
  resolutionReasonCode: string;
  resolutionSealHash: string;
  resolutionState: "ambiguous" | "blocked" | "resolved" | "unresolved";
  sourcePositionId: string;
}

export interface CurrentSourceMapping {
  headPresent: boolean;
  mappingHash: null | string;
  mappingState: "absent" | "mapped" | "unmapped";
  mappingVersion: null | number;
  publicJobId: null | string;
  sourcePositionId: string;
}

export interface CanonicalLiveCandidate {
  publicJobId: string;
  publicJobVersion: number;
  signalHash: string;
  signalKind: "canonical_identity_v1";
}

export interface StoredCanonicalLiveInput extends CanonicalLiveCandidate {
  inputHash: string;
}

export interface PublicRootSnapshot {
  allocationHash: null | string;
  eligibilityDecisionVersion: number;
  firstPublishedAt: null | string;
  foundingSourcePositionId: null | string;
  originatingPublicJobId: string;
  publicJobCreatedAt: string;
  publicJobVersion: number;
  redirectPath: string[];
  redirectRootId: string;
  servedPublicly: boolean;
}

export interface FinalOperatorDecision {
  decision: "deferred" | "different" | "same";
  decisionHash: string;
  id: string;
  leftMemberKey: string;
  reasonCode:
    | "operator_confirmed_different"
    | "operator_confirmed_same"
    | "operator_deferred";
  rightMemberKey: string;
}

export interface PublicAllocationCollision {
  allocationAlgorithmVersion: null | string;
  allocationHash: null | string;
  foundingSourcePositionId: null | string;
  publicJobId: string;
  publicJobPresent: boolean;
}

export type StoredFinalMember =
  | {
      inputHash: string;
      kind: "shadow";
      memberHash: string;
      memberKey: string;
      positionItemId: string;
      sourcePositionId: string;
    }
  | {
      eligibilityDecisionVersion: number;
      kind: "public";
      memberHash: string;
      memberKey: string;
      publicJobId: string;
      publicJobVersion: number;
    };

export interface StoredFinalRelation {
  conflictingSignals: unknown[];
  d2ComparisonId: null | string;
  id: string;
  left: StoredFinalMember;
  matchingSignals: unknown[];
  operatorDecisionId: null | string;
  reasonCode: string;
  relation: "ambiguous" | "different" | "same";
  relationHash: string;
  right: StoredFinalMember;
}

export interface StoredAllocationRoot {
  eligibilityDecisionVersion: number;
  firstPublishedAt: null | string;
  foundingSourcePositionId: null | string;
  memberKey: string;
  publicJobCreatedAt: string;
  publicJobId: string;
  publicJobVersion: number;
  reasonCode: string;
  rootHash: string;
  selected: boolean;
  servedPublicly: boolean;
}

export interface FinalGraphStoreInput {
  seal: FinalDuplicateSeal;
}

export interface FinalDuplicateSeal {
  allocationCount: number;
  allocationDigest: string;
  blockedAllocationCount: number;
  blockedResolutionCount: number;
  canonicalLiveInputCount: number;
  canonicalLiveInputDigest: string;
  createdAt: string;
  duplicateBatchInputHash: string;
  promotableCount: number;
  relationCount: number;
  relationDigest: string;
  resolutionCount: number;
  resolutionDigest: string;
  resolvedPositionCount: number;
  runId: string;
  sealHash: string;
  sourceMappingInputCount: number;
  sourceMappingInputDigest: string;
}

export interface BoundaryRow {
  blocked_resolution_count: number;
  duplicate_batch_input_hash: string;
  duplicate_member_count: number;
  mode: string;
  resolution_count: number;
  resolved_position_count: number;
  run_id: string;
  run_status: string;
  selection_complete: number;
}

export interface MemberRow {
  canonical_signal_hash: null | string;
  checkpoint_json: string;
  input_hash: string;
  position_item_id: string;
  resolution_reason_code: string;
  resolution_seal_hash: string;
  resolution_state: FinalGraphMemberSnapshot["resolutionState"];
  source_position_id: string;
}

export interface RootRow {
  allocation_hash: null | string;
  eligibility_decision_version: number;
  first_published_at: null | string;
  founding_source_position_id: null | string;
  originating_public_job_id: string;
  public_job_created_at: string;
  public_job_version: number;
  redirect_path_json: string;
  redirect_root_id: string;
  served_publicly: number;
}

export interface SealRow {
  allocation_count: number;
  allocation_digest: string;
  blocked_allocation_count: number;
  blocked_resolution_count: number;
  canonical_live_input_count: number;
  canonical_live_input_digest: string;
  created_at: string;
  duplicate_batch_input_hash: string;
  promotable_count: number;
  relation_count: number;
  relation_digest: string;
  resolution_count: number;
  resolution_digest: string;
  resolved_position_count: number;
  run_id: string;
  seal_hash: string;
  source_mapping_input_count: number;
  source_mapping_input_digest: string;
}
