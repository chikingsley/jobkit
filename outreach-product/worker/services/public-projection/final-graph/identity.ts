import type {
  FinalGraphMemberSnapshot,
  StoredFinalMember,
} from "../../../repositories/public-projection-final-graph";
import { canonicalSha256, compareUtf8Bytes, sha256Hex } from "../hash";

export function finalShadowMemberKey(input: {
  inputHash: string;
  sourcePositionId: string;
}) {
  return `shadow:${input.sourcePositionId}:${input.inputHash}`;
}

export function finalPublicMemberKey(input: {
  eligibilityDecisionVersion: number;
  publicJobVersion: number;
  redirectRootId: string;
}) {
  return `public:${input.redirectRootId}:${input.publicJobVersion}:${input.eligibilityDecisionVersion}`;
}

export async function finalDuplicateRelationId(
  leftMemberKey: string,
  rightMemberKey: string
) {
  const [left, right] = orderedPair(leftMemberKey, rightMemberKey);
  return `pfrel_v1_${await sha256Hex(
    `jobkit-public-final-duplicate-pair/v1\0${left}\0${right}`
  )}`;
}

export async function deterministicPublicJobId(
  foundingSourcePositionId: string
) {
  return `pjob_v1_${await sha256Hex(
    `jobkit-public-job/v1\0${foundingSourcePositionId}`
  )}`;
}

export async function shadowMember(
  snapshot: FinalGraphMemberSnapshot
): Promise<StoredFinalMember> {
  const memberKey = finalShadowMemberKey({
    inputHash: snapshot.inputHash,
    sourcePositionId: snapshot.sourcePositionId,
  });
  return {
    inputHash: snapshot.inputHash,
    kind: "shadow",
    memberHash: await canonicalSha256({
      inputHash: snapshot.inputHash,
      kind: "shadow",
      memberKey,
      sourcePositionId: snapshot.sourcePositionId,
    }),
    memberKey,
    positionItemId: snapshot.positionItemId,
    sourcePositionId: snapshot.sourcePositionId,
  };
}

export function orderMembers(
  left: StoredFinalMember,
  right: StoredFinalMember
): [StoredFinalMember, StoredFinalMember] {
  return compareUtf8Bytes(left.memberKey, right.memberKey) <= 0
    ? [left, right]
    : [right, left];
}

function orderedPair(left: string, right: string): [string, string] {
  return compareUtf8Bytes(left, right) <= 0 ? [left, right] : [right, left];
}

export function pairKey(left: string, right: string) {
  const ordered = orderedPair(left, right);
  return `${ordered[0]}\0${ordered[1]}`;
}

export function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort(compareUtf8Bytes);
}
