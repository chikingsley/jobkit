import {
  type DuplicateMemberSnapshot,
  type DuplicateSignalEvidence,
  type DuplicateWorkSnapshot,
  PUBLIC_DUPLICATE_MAX_BINDING_BYTES as MAX_BINDING_BYTES,
  type SameRunDuplicateComparison,
} from "../../../repositories/public-projection-duplicate-comparisons";
import {
  duplicateComparisonId,
  shadowDuplicateMemberKey,
} from "../duplicate-comparisons";
import { canonicalJson, canonicalSha256, compareUtf8Bytes } from "../hash";
import {
  DuplicateComparisonSnapshotError,
  MAX_MEMBER_FIELD_BYTES,
  PUBLIC_DUPLICATE_PAGE_SIZE,
  type StablePosition,
} from "./model";

export async function sameRunComparison(
  work: DuplicateWorkSnapshot,
  candidate: { left: StablePosition; right: StablePosition }
) {
  const { left, right } = candidate;
  const classified = classifyStablePair(left, right);
  if (!classified) {
    return null;
  }
  return {
    conflictingSignals: sortSignals(classified.conflictingSignals),
    createdAt: work.createdAt,
    id: await duplicateComparisonId(
      shadowDuplicateMemberKey({
        inputHash: left.inputHash,
        positionItemId: left.positionItemId,
        runId: work.runId,
      }),
      shadowDuplicateMemberKey({
        inputHash: right.inputHash,
        positionItemId: right.positionItemId,
        runId: work.runId,
      })
    ),
    matchingSignals: matchingSignals(left, right),
    ownerInputHash: left.inputHash,
    ownerPositionItemId: left.positionItemId,
    ownerSourcePositionId: left.sourcePositionId,
    reasonCode: classified.reasonCode,
    relation: classified.relation,
    runId: work.runId,
    target: {
      inputHash: right.inputHash,
      kind: "same_run",
      positionItemId: right.positionItemId,
      sourcePositionId: right.sourcePositionId,
    },
  } satisfies SameRunDuplicateComparison;
}

function matchingSignals(
  left: StablePosition,
  right: StablePosition
): DuplicateSignalEvidence[] {
  const signals: DuplicateSignalEvidence[] = [];
  if (left.listingId === right.listingId) {
    signals.push({ kind: "listing_id_v1", value: left.listingId });
  }
  if (
    left.sourceKey === right.sourceKey &&
    left.positionKey === right.positionKey &&
    left.sourceReference &&
    left.sourceReference === right.sourceReference &&
    left.sourceReferenceSignalHash
  ) {
    signals.push(
      { kind: "position_key_v1", value: left.positionKey },
      { kind: "source_key_v1", value: left.sourceKey },
      { hash: left.sourceReferenceSignalHash, kind: "source_reference_v1" }
    );
  }
  if (
    left.positionKey === right.positionKey &&
    left.materialSignalHash === right.materialSignalHash
  ) {
    signals.push(
      { hash: left.materialSignalHash, kind: "material_clone_v1" },
      { kind: "position_key_v1", value: left.positionKey }
    );
  }
  return sortSignals(signals);
}

function classifyStablePair(
  left: StablePosition,
  right: StablePosition
): {
  conflictingSignals: DuplicateSignalEvidence[];
  reasonCode:
    | "conflicting_stable_identifier"
    | "same_listing_distinct_position"
    | "same_source_reference_position";
  relation: "different" | "same";
} | null {
  if (
    left.listingId === right.listingId &&
    left.positionKey !== right.positionKey
  ) {
    return {
      conflictingSignals: [
        {
          kind: "position_key_v1",
          ownerValue: left.positionKey,
          targetValue: right.positionKey,
        },
      ],
      reasonCode: "same_listing_distinct_position",
      relation: "different",
    };
  }
  if (
    left.sourceKey === right.sourceKey &&
    left.positionKey === right.positionKey &&
    left.sourceReference &&
    right.sourceReference &&
    left.sourceReference !== right.sourceReference
  ) {
    return {
      conflictingSignals: [
        {
          kind: "source_reference_v1",
          ownerValue: left.sourceReference,
          targetValue: right.sourceReference,
        },
      ],
      reasonCode: "conflicting_stable_identifier",
      relation: "different",
    };
  }
  if (
    left.sourceKey === right.sourceKey &&
    left.positionKey === right.positionKey &&
    left.sourceReference &&
    left.sourceReference === right.sourceReference
  ) {
    return {
      conflictingSignals: [],
      reasonCode: "same_source_reference_position",
      relation: "same",
    };
  }
  return null;
}

export function streamDigest(
  previousDigest: string,
  phase: string,
  records: unknown[]
) {
  if (records.length === 0) {
    return previousDigest;
  }
  return canonicalSha256({ phase, previousDigest, records });
}

export function memberDigestRecord(member: DuplicateMemberSnapshot) {
  return {
    inputHash: member.inputHash,
    listingId: member.listingId,
    materialSignalHash: member.materialSignalHash,
    ordinal: member.ordinal,
    positionItemId: member.positionItemId,
    positionKey: member.positionKey,
    sourceKey: member.sourceKey,
    sourcePositionId: member.sourcePositionId,
    sourceReference: member.sourceReference,
    sourceReferenceSignalHash: member.sourceReferenceSignalHash,
  };
}

export function assertBoundedChunk(value: unknown[], label: string) {
  if (value.length > PUBLIC_DUPLICATE_PAGE_SIZE) {
    throw new Error(`${label} page exceeded its fixed row limit`);
  }
  const { byteLength } = new TextEncoder().encode(canonicalJson(value));
  if (byteLength > MAX_BINDING_BYTES) {
    throw new DuplicateComparisonSnapshotError(
      `The ${label} page exceeds the fixed D1 binding limit`
    );
  }
}

export function assertBoundedFields(value: object) {
  for (const field of Object.values(value)) {
    if (
      typeof field === "string" &&
      new TextEncoder().encode(field).byteLength > MAX_MEMBER_FIELD_BYTES
    ) {
      throw new DuplicateComparisonSnapshotError(
        "A duplicate snapshot field exceeds the accepted row limit"
      );
    }
  }
}

export function completeResult(
  comparisonCount: number,
  comparisonsCreated: number,
  replayed: boolean
) {
  return {
    comparisonCount,
    comparisonsCreated,
    replayed,
    state: "complete" as const,
  };
}

export function pendingResult(
  comparisonCount: number,
  comparisonsCreated: number
) {
  return {
    comparisonCount,
    comparisonsCreated,
    replayed: false,
    state: "pending" as const,
  };
}

export function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function sortSignals(signals: DuplicateSignalEvidence[]) {
  const unique = new Map(
    signals.map((signal) => [JSON.stringify(signal), signal] as const)
  );
  return [...unique.values()].sort((left, right) =>
    compareUtf8Bytes(JSON.stringify(left), JSON.stringify(right))
  );
}

export function normalizeIdentifier(value: string) {
  return value.normalize("NFKC").trim();
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
