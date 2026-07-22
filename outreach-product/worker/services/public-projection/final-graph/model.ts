import type {
  DuplicateBatchSnapshot,
  DuplicateSignalEvidence,
  ImmutableDuplicateComparison,
} from "../../../repositories/public-projection-duplicate-comparisons";
import type {
  FinalGraphBoundary,
  FinalOperatorDecision,
  StoredFinalMember,
} from "../../../repositories/public-projection-final-graph";

export interface DraftRelation {
  conflictingSignals: DuplicateSignalEvidence[];
  d2ComparisonId: null | string;
  left: StoredFinalMember;
  matchingSignals: DuplicateSignalEvidence[];
  operatorDecision: FinalOperatorDecision | null;
  reasonCode: string;
  relation: "ambiguous" | "different" | "same";
  right: StoredFinalMember;
}

export interface FinalBoundaryContext {
  boundary: FinalGraphBoundary;
  duplicateBatch: DuplicateBatchSnapshot;
}

export type RelationCandidateSource = "d2" | "live" | "same_run";

export interface RelationCursor {
  leftMemberKey: string;
  publicMemberKey: string;
  rightMemberKey: string;
  shadowPositionItemId: string;
  signalHash: string;
  source: RelationCandidateSource;
}

export interface CanonicalRelationCandidate {
  leftMemberKey: string;
  liveCursor?: {
    publicMemberKey: string;
    shadowMemberKey: string;
    shadowPositionItemId: string;
    signalHash: string;
  };
  rightMemberKey: string;
  signalHash: string;
}

export type RelationPageCandidate =
  | CanonicalRelationCandidate
  | {
      comparison: ImmutableDuplicateComparison;
      leftMemberKey: string;
      rightMemberKey: string;
    };

export class FinalDuplicateSnapshotError extends Error {
  readonly code = "final_duplicate_input_snapshot_changed";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FinalDuplicateSnapshotError";
  }
}
