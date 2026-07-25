import type {
  FinalGraphMemberSnapshot,
  PublicRootSnapshot,
  StoredCanonicalLiveInput,
  StoredFinalRelation,
} from "../public-projection-final-graph";

export const PUBLIC_FINAL_WORK_PAGE_SIZE = 24;
export const PUBLIC_FINAL_WORK_MAX_PAGE_BYTES = 1_000_000;

export type FinalWorkPhase =
  | "allocation_digest"
  | "canonical_matches"
  | "canonical_requests"
  | "components"
  | "mapping_inputs"
  | "public_roots"
  | "ready"
  | "relations"
  | "resolution_inputs"
  | "sealed";

export interface FinalWorkClaim {
  activeComponentSeed: null | string;
  componentBytes: number;
  componentDigest: null | string;
  counterBytes: number;
  counterCount: number;
  counterDigest: null | string;
  counterLastCursor: string;
  frozenAt: string;
  leaseEpoch: number;
  leaseToken: string;
  phase: FinalWorkPhase;
  phaseCursor: string;
  phaseOrdinal: number;
  runId: string;
  sourceMappingCount: number;
  sourceMappingDigest: null | string;
  sourceMappingLastCursor: string;
}

export interface FinalWorkController {
  activeComponentSeed: null | string;
  allocationBytes: number;
  allocationDigest: null | string;
  canonicalMatchBytes: number;
  canonicalMatchCount: number;
  canonicalMatchDigest: null | string;
  canonicalMatchLastCursor: string;
  canonicalRequestBytes: number;
  canonicalRequestCount: number;
  canonicalRequestDigest: null | string;
  canonicalRequestLastCursor: string;
  componentBytes: number;
  componentCount: number;
  componentDigest: null | string;
  componentLastCursor: string;
  frozenAt: string;
  inputDigest: string;
  lastErrorCode: null | string;
  mappingBytes: number;
  mappingCount: number;
  mappingDigest: null | string;
  mappingLastCursor: string;
  phase: FinalWorkPhase;
  phaseCursor: string;
  phaseOrdinal: number;
  publicRootBytes: number;
  publicRootCount: number;
  publicRootDigest: null | string;
  publicRootLastCursor: string;
  relationBytes: number;
  relationCount: number;
  relationDigest: null | string;
  relationLastCursor: string;
  resolutionBytes: number;
  resolutionCount: number;
  resolutionDigest: null | string;
  resolutionLastCursor: string;
  runId: string;
  sourceMappingCount: number;
  sourceMappingDigest: null | string;
  sourceMappingLastCursor: string;
  status: "failed" | "processing" | "queued" | "sealed" | "superseded";
}

export interface FinalWorkResolutionInput extends FinalGraphMemberSnapshot {
  encodedBytes: number;
  memberHash: null | string;
  memberKey: null | string;
  ordinal: number;
  rowHash: string;
}

export interface FinalWorkMappingInput {
  encodedBytes: number;
  headPresent: boolean;
  inputHash: string;
  mappingHash: null | string;
  mappingState: "absent" | "mapped" | "unmapped";
  mappingVersion: null | number;
  ordinal: number;
  publicJobId: null | string;
  rowHash: string;
  sourcePositionId: string;
}

export interface FinalWorkCanonicalRequest {
  encodedBytes: number;
  matchComplete: boolean;
  matchCount: number;
  matchCursor: string;
  matchDigest: null | string;
  ordinal: number;
  requestHash: string;
  signalHash: string;
}

export interface FinalWorkCanonicalMatch extends StoredCanonicalLiveInput {
  encodedBytes: number;
  ordinal: number;
  publicMemberKey: string;
  rowHash: string;
}

export interface FinalWorkPublicRoot extends PublicRootSnapshot {
  allocationInputHash: string;
  contentHeadHash: string;
  encodedBytes: number;
  historyHash: string;
  ordinal: number;
  publicMemberKey: string;
  redirectPathHash: string;
  rowHash: string;
}

export interface FinalWorkRelation {
  encodedBytes: number;
  operatorDecisionHash: null | string;
  operatorDecisionId: null | string;
  operatorTerminal: true;
  ordinal: number;
  relation: StoredFinalRelation;
}

export interface FinalComponentWork {
  allocationHash: null | string;
  allocationId: null | string;
  allocationState: null | "blocked" | "promotable";
  ambiguous: boolean;
  artifactHash: null | string;
  childCursor: string;
  encodedBytes: number;
  foundingSourcePositionId: null | string;
  losingRootCount: null | number;
  memberCount: number;
  memberDigest: null | string;
  memberLastCursor: string;
  oversized: boolean;
  proposedPublicJobId: null | string;
  reasonCode: null | string;
  relationCount: number;
  relationDigest: null | string;
  relationLastCursor: string;
  rootCandidateCount: number;
  rootCount: number;
  rootDigest: null | string;
  rootExpectedCount: null | number;
  rootLastCursor: string;
  rootSummaryReady: boolean;
  seedMemberKey: string;
  sourceMappedWinner: boolean;
  state: "expanding" | "members" | "relations" | "roots" | "sealed" | "updates";
  updateLastCursor: string;
  winningPublicJobId: null | string;
}
