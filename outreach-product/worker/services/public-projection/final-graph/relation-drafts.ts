import type { DuplicateSignalEvidence } from "../../../repositories/public-projection-duplicate-comparisons";
import {
  type FinalOperatorDecision,
  PUBLIC_DUPLICATE_FINALIZATION_VERSION,
  readTerminalOperatorDecisions,
  type StoredFinalMember,
  type StoredFinalRelation,
} from "../../../repositories/public-projection-final-graph";
import { canonicalJson, canonicalSha256, compareUtf8Bytes } from "../hash";
import { finalDuplicateRelationId, orderMembers, pairKey } from "./identity";
import { type DraftRelation, FinalDuplicateSnapshotError } from "./model";

export async function applyFinalOperatorDecisions(
  db: D1Database,
  draftByPair: Map<string, DraftRelation>
) {
  const operatorDecisions = await readTerminalOperatorDecisions(
    db,
    [...draftByPair.values()].map((draft) => ({
      leftMemberKey: draft.left.memberKey,
      rightMemberKey: draft.right.memberKey,
    }))
  );
  const decisionByPair = new Map(
    operatorDecisions.map((decision) => [
      pairKey(decision.leftMemberKey, decision.rightMemberKey),
      decision,
    ])
  );
  for (const [key, draft] of draftByPair) {
    if (draft.relation !== "ambiguous") {
      continue;
    }
    const decision = decisionByPair.get(key);
    if (decision) {
      applyOperatorDecision(draft, decision);
    }
  }
  return operatorDecisions;
}

export function addCanonicalDraft(
  drafts: Map<string, DraftRelation>,
  first: StoredFinalMember,
  second: StoredFinalMember,
  signalHash: string
) {
  const [left, right] = orderMembers(first, second);
  const key = pairKey(left.memberKey, right.memberKey);
  const signal = { hash: signalHash, kind: "canonical_identity_v1" };
  const existing = drafts.get(key);
  if (existing) {
    existing.matchingSignals = sortEvidence([
      ...existing.matchingSignals,
      signal,
    ]);
    return;
  }
  drafts.set(key, {
    conflictingSignals: [],
    d2ComparisonId: null,
    left,
    matchingSignals: [signal],
    operatorDecision: null,
    reasonCode: "canonical_identity_only",
    relation: "ambiguous",
    right,
  });
}

export function addDraftRelation(
  drafts: Map<string, DraftRelation>,
  draft: DraftRelation
) {
  const key = pairKey(draft.left.memberKey, draft.right.memberKey);
  if (drafts.has(key)) {
    throw new FinalDuplicateSnapshotError(
      `The sealed D2 graph contains duplicate final pair ${key}`
    );
  }
  drafts.set(key, draft);
}

function applyOperatorDecision(
  draft: DraftRelation,
  decision: FinalOperatorDecision
) {
  draft.operatorDecision = decision;
  draft.matchingSignals = sortEvidence([
    ...draft.matchingSignals,
    { hash: decision.decisionHash, kind: "operator_decision_v1" },
  ]);
  draft.reasonCode = decision.reasonCode;
  if (decision.decision === "same") {
    draft.relation = "same";
    return;
  }
  draft.relation =
    decision.decision === "different" ? "different" : "ambiguous";
}

export async function sealRelation(
  draft: DraftRelation
): Promise<StoredFinalRelation> {
  const payload = {
    conflictingSignals: draft.conflictingSignals,
    finalizationAlgorithmVersion: PUBLIC_DUPLICATE_FINALIZATION_VERSION,
    leftMemberHash: draft.left.memberHash,
    leftMemberKey: draft.left.memberKey,
    matchingSignals: draft.matchingSignals,
    operatorDecisionHash: draft.operatorDecision?.decisionHash ?? null,
    reasonCode: draft.reasonCode,
    relation: draft.relation,
    rightMemberHash: draft.right.memberHash,
    rightMemberKey: draft.right.memberKey,
  };
  return {
    conflictingSignals: draft.conflictingSignals,
    d2ComparisonId: draft.d2ComparisonId,
    id: await finalDuplicateRelationId(
      draft.left.memberKey,
      draft.right.memberKey
    ),
    left: draft.left,
    matchingSignals: draft.matchingSignals,
    operatorDecisionId: draft.operatorDecision?.id ?? null,
    reasonCode: draft.reasonCode,
    relation: draft.relation,
    relationHash: await canonicalSha256(payload),
    right: draft.right,
  };
}

export function compareDraftRelations(
  left: DraftRelation,
  right: DraftRelation
) {
  const leftKey = pairKey(left.left.memberKey, left.right.memberKey);
  const rightKey = pairKey(right.left.memberKey, right.right.memberKey);
  return compareUtf8Bytes(leftKey, rightKey);
}

export function sortEvidence(
  evidence: DuplicateSignalEvidence[]
): DuplicateSignalEvidence[] {
  const unique = new Map(
    evidence.map((signal) => [canonicalJson(signal), signal])
  );
  return [...unique.entries()]
    .sort(([left], [right]) => compareUtf8Bytes(left, right))
    .map(([, signal]) => signal);
}
