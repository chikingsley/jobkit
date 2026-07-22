import { readDuplicateComparisonPairPage } from "../../../repositories/public-projection-duplicate-comparisons";
import type {
  StoredFinalMember,
  StoredFinalRelation,
} from "../../../repositories/public-projection-final-graph";
import {
  readRelationPageCanonicalSignals,
  readRelationPageMemberInputs,
} from "../../../repositories/public-projection-final-work/component-members";
import { canonicalJson } from "../hash";
import { componentMemberFromInput } from "./component-artifacts";
import {
  type DraftRelation,
  FinalDuplicateSnapshotError,
  type RelationCandidateSource,
  type RelationCursor,
  type RelationPageCandidate,
} from "./model";
import {
  addCanonicalDraft,
  addDraftRelation,
  applyFinalOperatorDecisions,
  compareDraftRelations,
  sealRelation,
  sortEvidence,
} from "./relation-drafts";
import {
  readLiveCanonicalPairPage,
  readSameRunCanonicalPairPage,
} from "./relation-pairs";

export function nextRelationPageCursor(input: {
  complete: boolean;
  hasMoreInSource: boolean;
  lastCandidate: RelationPageCandidate | undefined;
  nextSource: RelationCandidateSource | null;
  priorCursor: string;
}) {
  if (input.complete) {
    return input.priorCursor;
  }
  if (!input.nextSource) {
    throw new FinalDuplicateSnapshotError(
      "The active relation page requires its next source"
    );
  }
  const candidate = input.hasMoreInSource ? input.lastCandidate : undefined;
  const liveCursor =
    candidate && "liveCursor" in candidate ? candidate.liveCursor : null;
  return serializeRelationCursor({
    leftMemberKey: candidate?.leftMemberKey ?? "",
    publicMemberKey: liveCursor?.publicMemberKey ?? "",
    rightMemberKey: candidate?.rightMemberKey ?? "",
    shadowPositionItemId: liveCursor?.shadowPositionItemId ?? "",
    signalHash:
      candidate && "signalHash" in candidate ? candidate.signalHash : "",
    source: input.nextSource,
  });
}

export async function readRelationCandidatePage(
  db: D1Database,
  input: { cursor: RelationCursor | null; limit: number; runId: string }
): Promise<{
  candidates: RelationPageCandidate[];
  source: RelationCandidateSource;
}> {
  const initialSource = input.cursor === null ? "d2" : input.cursor.source;
  const orderedSources = ["d2", "same_run", "live"] as const;
  const sources = orderedSources.slice(orderedSources.indexOf(initialSource));
  for (const source of sources) {
    const pairCursor =
      source === initialSource && input.cursor !== null
        ? {
            leftMemberKey: input.cursor.leftMemberKey,
            publicMemberKey: input.cursor.publicMemberKey,
            rightMemberKey: input.cursor.rightMemberKey,
            shadowPositionItemId: input.cursor.shadowPositionItemId,
            signalHash: input.cursor.signalHash,
          }
        : null;
    // biome-ignore lint/performance/noAwaitInLoops: Empty durable sources are skipped sequentially before one bounded page is returned.
    const candidates = await readCandidatesForRelationSource(db, {
      cursor: pairCursor,
      limit: input.limit,
      runId: input.runId,
      source,
    });
    if (candidates.length > 0 || source === "live") {
      return { candidates, source };
    }
  }
  return { candidates: [], source: "live" };
}

function readCandidatesForRelationSource(
  db: D1Database,
  input: {
    cursor: null | {
      leftMemberKey: string;
      publicMemberKey: string;
      rightMemberKey: string;
      shadowPositionItemId: string;
      signalHash: string;
    };
    limit: number;
    runId: string;
    source: RelationCandidateSource;
  }
): Promise<RelationPageCandidate[]> {
  if (input.source === "d2") {
    return readDuplicateComparisonPairPage(db, input);
  }
  if (input.source === "same_run") {
    return readSameRunCanonicalPairPage(db, input);
  }
  return readLiveCanonicalPairPage(db, input);
}

export async function buildRelationCandidatePage(
  db: D1Database,
  input: {
    candidates: RelationPageCandidate[];
    runId: string;
    source: RelationCandidateSource;
  }
) {
  const pairs = input.candidates.map((candidate) => ({
    leftMemberKey: candidate.leftMemberKey,
    rightMemberKey: candidate.rightMemberKey,
  }));
  const [memberInputs, canonicalSignals] = await Promise.all([
    readRelationPageMemberInputs(db, { pairs, runId: input.runId }),
    readRelationPageCanonicalSignals(db, { pairs, runId: input.runId }),
  ]);
  const members = await Promise.all(memberInputs.map(componentMemberFromInput));
  const memberByKey = new Map(
    members.map((member) => [member.memberKey, member])
  );
  const drafts =
    input.source === "d2"
      ? buildD2DraftPage({
          candidates: input.candidates,
          memberByKey,
        })
      : buildCanonicalDraftPage({
          candidates: input.candidates,
          memberByKey,
        });
  enrichDraftPageWithCanonicalSignals({ canonicalSignals, drafts });
  const decisions = await applyFinalOperatorDecisions(db, drafts);
  const decisionById = new Map(
    decisions.map((decision) => [decision.id, decision])
  );
  const relations: StoredFinalRelation[] = [];
  for (const draft of [...drafts.values()].sort(compareDraftRelations)) {
    // biome-ignore lint/performance/noAwaitInLoops: Page-local relation hashes preserve deterministic evidence order.
    relations.push(await sealRelation(draft));
  }
  return { decisionById, relations };
}

function buildD2DraftPage(input: {
  candidates: RelationPageCandidate[];
  memberByKey: Map<string, StoredFinalMember>;
}) {
  const drafts = new Map<string, DraftRelation>();
  for (const candidate of input.candidates) {
    if (!("comparison" in candidate)) {
      continue;
    }
    const left = input.memberByKey.get(candidate.leftMemberKey);
    const right = input.memberByKey.get(candidate.rightMemberKey);
    if (!(left && right)) {
      throw new FinalDuplicateSnapshotError(
        "A D2 relation candidate lost its page-local pinned member"
      );
    }
    addDraftRelation(drafts, {
      conflictingSignals: sortEvidence(candidate.comparison.conflictingSignals),
      d2ComparisonId: candidate.comparison.id,
      left,
      matchingSignals: sortEvidence(candidate.comparison.matchingSignals),
      operatorDecision: null,
      reasonCode: candidate.comparison.reasonCode,
      relation: candidate.comparison.relation,
      right,
    });
  }
  return drafts;
}

function buildCanonicalDraftPage(input: {
  candidates: RelationPageCandidate[];
  memberByKey: Map<string, StoredFinalMember>;
}) {
  const drafts = new Map<string, DraftRelation>();
  for (const candidate of input.candidates) {
    if ("comparison" in candidate) {
      continue;
    }
    const left = input.memberByKey.get(candidate.leftMemberKey);
    const right = input.memberByKey.get(candidate.rightMemberKey);
    if (!(left && right)) {
      throw new FinalDuplicateSnapshotError(
        "A canonical relation candidate lost its pinned member"
      );
    }
    addCanonicalDraft(drafts, left, right, candidate.signalHash);
  }
  return drafts;
}

function enrichDraftPageWithCanonicalSignals(input: {
  canonicalSignals: { memberKey: string; signalHash: string }[];
  drafts: Map<string, DraftRelation>;
}) {
  const canonicalByMemberKey = new Map<string, Set<string>>();
  for (const candidate of input.canonicalSignals) {
    const signals =
      canonicalByMemberKey.get(candidate.memberKey) ?? new Set<string>();
    signals.add(candidate.signalHash);
    canonicalByMemberKey.set(candidate.memberKey, signals);
  }
  for (const draft of input.drafts.values()) {
    const leftSignals = canonicalByMemberKey.get(draft.left.memberKey);
    const rightSignals = canonicalByMemberKey.get(draft.right.memberKey);
    if (!(leftSignals && rightSignals)) {
      continue;
    }
    for (const signalHash of leftSignals) {
      if (rightSignals.has(signalHash)) {
        addCanonicalDraft(input.drafts, draft.left, draft.right, signalHash);
      }
    }
  }
}

export function relationSourceAfter(
  source: RelationCandidateSource
): RelationCandidateSource | null {
  if (source === "d2") {
    return "same_run";
  }
  return source === "same_run" ? "live" : null;
}

export function parseRelationCursor(value: string): RelationCursor | null {
  if (!value) {
    return null;
  }
  try {
    const cursor = JSON.parse(value) as Partial<RelationCursor>;
    if (
      (cursor.source === "d2" ||
        cursor.source === "same_run" ||
        cursor.source === "live") &&
      typeof cursor.leftMemberKey === "string" &&
      typeof cursor.publicMemberKey === "string" &&
      typeof cursor.rightMemberKey === "string" &&
      typeof cursor.shadowPositionItemId === "string" &&
      typeof cursor.signalHash === "string"
    ) {
      return cursor as RelationCursor;
    }
  } catch {
    // The durable cursor error below is the stable failure contract.
  }
  throw new FinalDuplicateSnapshotError(
    "The durable relation discovery cursor is invalid"
  );
}

function serializeRelationCursor(cursor: RelationCursor) {
  return canonicalJson(cursor);
}
