export const PUBLIC_DUPLICATE_RETRIEVAL_VERSION =
  "public-duplicate-retrieval-v1" as const;

export const PUBLIC_DUPLICATE_MAX_BINDING_BYTES = 1_000_000;

export interface DuplicateSignalEvidence {
  hash?: string;
  kind: string;
  ownerValue?: string;
  targetValue?: string;
  value?: string;
  version?: number;
}

export interface ComparisonBase {
  conflictingSignals: DuplicateSignalEvidence[];
  createdAt: string;
  id: string;
  matchingSignals: DuplicateSignalEvidence[];
  ownerInputHash: string;
  ownerPositionItemId: string;
  ownerSourcePositionId: string;
  reasonCode:
    | "canonical_identity_only"
    | "conflicting_stable_identifier"
    | "duplicate_evidence_conflict"
    | "same_listing_distinct_position"
    | "same_source_position"
    | "same_source_reference_position";
  relation: "ambiguous" | "different" | "same";
  runId: string;
}

export interface SameRunDuplicateComparison extends ComparisonBase {
  target: {
    inputHash: string;
    kind: "same_run";
    positionItemId: string;
    sourcePositionId: string;
  };
}

export interface ExistingPublicDuplicateComparison extends ComparisonBase {
  target: {
    kind: "existing_public";
    publicJobId: string;
    publicJobVersion: number;
    redirectRootId: string;
  };
}

export type ImmutableDuplicateComparison =
  | ExistingPublicDuplicateComparison
  | SameRunDuplicateComparison;

export interface DuplicateMemberSnapshot {
  inputHash: string;
  listingId: string;
  materialSignalHash: string;
  ordinal: number;
  positionItemId: string;
  positionKey: string;
  runId: string;
  sourceKey: string;
  sourcePositionId: string;
  sourceReference: string;
  sourceReferenceSignalHash: null | string;
}

export type DuplicateWorkPhase =
  | "existing_public"
  | "members"
  | "ready"
  | "same_run"
  | "sealed";

export interface DuplicateWorkSnapshot {
  comparisonCount: number;
  comparisonDigest: string;
  createdAt: string;
  existingPublicCursor: string;
  expectedMemberCount: number;
  leaseToken: null | string;
  memberCount: number;
  memberCursor: string;
  memberDigest: string;
  phase: DuplicateWorkPhase;
  runId: string;
  sameRunOwnerCursor: string;
  sameRunTargetCursor: string;
  status: "processing" | "queued" | "sealed";
}

export interface DuplicateBatchSnapshot {
  comparisonCount: number;
  comparisonDigest: string;
  createdAt: string;
  inputHash: string;
  memberDigest: string;
  positionMemberCount: number;
  runId: string;
}

export interface DuplicateWorkRow {
  comparison_count: number;
  comparison_digest: string;
  created_at: string;
  existing_public_cursor: string;
  expected_member_count: number;
  lease_token: null | string;
  member_count: number;
  member_cursor: string;
  member_digest: string;
  phase: DuplicateWorkPhase;
  run_id: string;
  same_run_owner_cursor: string;
  same_run_target_cursor: string;
  status: "processing" | "queued" | "sealed";
}

export interface DuplicateBatchRow {
  canonical_identity_state: "pending";
  comparison_count: number;
  comparison_digest: string;
  created_at: string;
  input_hash: string;
  member_digest: string;
  position_member_count: number;
  retrieval_algorithm_version: string;
  run_id: string;
}
