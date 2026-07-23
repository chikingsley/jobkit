import { canonicalJson } from "../../services/public-projection/hash";
import {
  type ComparisonBase,
  type DuplicateSignalEvidence,
  type DuplicateWorkRow,
  type DuplicateWorkSnapshot,
  type ExistingPublicDuplicateComparison,
  type ImmutableDuplicateComparison,
  PUBLIC_DUPLICATE_MAX_BINDING_BYTES,
  type SameRunDuplicateComparison,
} from "./model";

export function comparisonInsertRecord(
  comparison: ImmutableDuplicateComparison
) {
  const publicTarget =
    comparison.target.kind === "existing_public" ? comparison.target : null;
  const shadowTarget =
    comparison.target.kind === "same_run" ? comparison.target : null;
  return {
    conflictingSignalsJson: canonicalJson(comparison.conflictingSignals),
    createdAt: comparison.createdAt,
    id: comparison.id,
    matchingSignalsJson: canonicalJson(comparison.matchingSignals),
    ownerInputHash: comparison.ownerInputHash,
    ownerPositionItemId: comparison.ownerPositionItemId,
    ownerSourcePositionId: comparison.ownerSourcePositionId,
    reasonCode: comparison.reasonCode,
    relation: comparison.relation,
    targetInputHash: shadowTarget === null ? null : shadowTarget.inputHash,
    targetKind: comparison.target.kind,
    targetPositionItemId:
      shadowTarget === null ? null : shadowTarget.positionItemId,
    targetPublicJobId: publicTarget === null ? null : publicTarget.publicJobId,
    targetPublicJobVersion:
      publicTarget === null ? null : publicTarget.publicJobVersion,
    targetRedirectRootId:
      publicTarget === null ? null : publicTarget.redirectRootId,
    targetSourcePositionId:
      shadowTarget === null ? null : shadowTarget.sourcePositionId,
  };
}

export function comparisonFromRow(row: Record<string, unknown>) {
  const common = {
    conflictingSignals: parseJsonArray<DuplicateSignalEvidence>(
      String(row.conflicting_signals_json)
    ),
    createdAt: String(row.created_at),
    id: String(row.id),
    matchingSignals: parseJsonArray<DuplicateSignalEvidence>(
      String(row.matching_signals_json)
    ),
    ownerInputHash: String(row.owner_input_hash),
    ownerPositionItemId: String(row.owner_position_item_id),
    ownerSourcePositionId: String(row.owner_source_position_id),
    reasonCode: String(row.reason_code) as ComparisonBase["reasonCode"],
    relation: String(row.relation) as ComparisonBase["relation"],
    runId: String(row.run_id),
  };
  if (row.target_kind === "existing_public") {
    return {
      ...common,
      target: {
        kind: "existing_public" as const,
        publicJobId: String(row.target_public_job_id),
        publicJobVersion: Number(row.target_public_job_version),
        redirectRootId: String(row.target_redirect_root_id),
      },
    } satisfies ExistingPublicDuplicateComparison;
  }
  return {
    ...common,
    target: {
      inputHash: String(row.target_input_hash),
      kind: "same_run" as const,
      positionItemId: String(row.target_position_item_id),
      sourcePositionId: String(row.target_source_position_id),
    },
  } satisfies SameRunDuplicateComparison;
}

export function workFromRow(row: DuplicateWorkRow): DuplicateWorkSnapshot {
  return {
    comparisonCount: row.comparison_count,
    comparisonDigest: row.comparison_digest,
    createdAt: row.created_at,
    existingPublicCursor: row.existing_public_cursor,
    expectedMemberCount: row.expected_member_count,
    leaseToken: row.lease_token,
    memberCount: row.member_count,
    memberCursor: row.member_cursor,
    memberDigest: row.member_digest,
    phase: row.phase,
    runId: row.run_id,
    sameRunOwnerCursor: row.same_run_owner_cursor,
    sameRunTargetCursor: row.same_run_target_cursor,
    status: row.status,
  };
}

export function assertPageCommit(
  results: D1Result<unknown>[],
  expectedRows: number,
  label: string
) {
  if (
    (results[0]?.meta.changes ?? 0) !== expectedRows ||
    (results[2]?.meta.changes ?? 0) !== 1
  ) {
    throw new Error(`The ${label} page lost its work lease`);
  }
}

export function assertionStatement(db: D1Database, expectedChanges: number) {
  return db
    .prepare(
      `INSERT INTO public_projection_duplicate_assertions (
        expected_changes,actual_changes
      ) VALUES (?,changes())`
    )
    .bind(expectedChanges);
}

export function assertBoundedBinding(payload: string, label: string) {
  const { byteLength } = new TextEncoder().encode(payload);
  if (byteLength > PUBLIC_DUPLICATE_MAX_BINDING_BYTES) {
    throw new Error(`The ${label} payload exceeds the fixed D1 binding limit`);
  }
}

function parseJsonArray<T>(value: string): T[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Stored duplicate evidence is not an array");
  }
  return parsed as T[];
}
