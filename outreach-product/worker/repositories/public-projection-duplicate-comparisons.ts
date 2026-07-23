import { canonicalJson } from "../services/public-projection/hash";
import {
  type DuplicateBatchRow,
  type DuplicateBatchSnapshot,
  type DuplicateMemberSnapshot,
  type DuplicateWorkRow,
  type ImmutableDuplicateComparison,
  PUBLIC_DUPLICATE_RETRIEVAL_VERSION,
} from "./public-projection-duplicate-comparisons/model";
import {
  assertBoundedBinding,
  assertionStatement,
  assertPageCommit,
  comparisonFromRow,
  comparisonInsertRecord,
  workFromRow,
} from "./public-projection-duplicate-comparisons/records";

export type {
  DuplicateBatchSnapshot,
  DuplicateMemberSnapshot,
  DuplicateSignalEvidence,
  DuplicateWorkPhase,
  DuplicateWorkSnapshot,
  ExistingPublicDuplicateComparison,
  ImmutableDuplicateComparison,
  SameRunDuplicateComparison,
} from "./public-projection-duplicate-comparisons/model";
// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export {
  PUBLIC_DUPLICATE_MAX_BINDING_BYTES,
  PUBLIC_DUPLICATE_RETRIEVAL_VERSION,
} from "./public-projection-duplicate-comparisons/model";

export async function initializeDuplicateWork(
  db: D1Database,
  input: {
    comparisonDigest: string;
    expectedMemberCount: number;
    memberDigest: string;
    runId: string;
    timestamp: string;
  }
) {
  await db
    .prepare(
      `INSERT INTO public_projection_duplicate_work (
        run_id,retrieval_algorithm_version,phase,status,
        expected_member_count,member_digest,comparison_digest,
        created_at,updated_at
      ) VALUES (?,?,'members','queued',?,?,?,?,?)
      ON CONFLICT(run_id) DO NOTHING`
    )
    .bind(
      input.runId,
      PUBLIC_DUPLICATE_RETRIEVAL_VERSION,
      input.expectedMemberCount,
      input.memberDigest,
      input.comparisonDigest,
      input.timestamp,
      input.timestamp
    )
    .run();
  const work = await readDuplicateWork(db, input.runId);
  if (!work || work.expectedMemberCount !== input.expectedMemberCount) {
    throw new Error("Stored duplicate work conflicts with its initial seal");
  }
  return work;
}

export async function claimDuplicateWork(
  db: D1Database,
  input: {
    leaseToken: string;
    runId: string;
    timestamp: string;
  }
) {
  const row = await db
    .prepare(
      `UPDATE public_projection_duplicate_work
          SET status='processing',lease_token=?,
              lease_expires_at=strftime(
                '%Y-%m-%dT%H:%M:%fZ','now','+60 seconds'
              ),updated_at=?
        WHERE run_id=? AND phase<>'sealed'
          AND (
            status='queued'
            OR (
              status='processing'
              AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            )
          )
      RETURNING *`
    )
    .bind(input.leaseToken, input.timestamp, input.runId)
    .first<DuplicateWorkRow>();
  return row ? workFromRow(row) : null;
}

export function readDuplicateWork(db: D1Database, runId: string) {
  return db
    .prepare(
      `SELECT * FROM public_projection_duplicate_work
        WHERE run_id=? LIMIT 1`
    )
    .bind(runId)
    .first<DuplicateWorkRow>()
    .then((row) => (row ? workFromRow(row) : null));
}

export async function storeDuplicateMemberPage(
  db: D1Database,
  input: {
    digest: string;
    leaseToken: string;
    members: DuplicateMemberSnapshot[];
    nextCursor: string;
    nextPhase: "existing_public" | "members";
    runId: string;
    timestamp: string;
  }
) {
  const payload = canonicalJson(
    input.members.map((member) => ({
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
    }))
  );
  assertBoundedBinding(payload, "duplicate member");
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO public_projection_duplicate_batch_members (
          run_id,ordinal,position_item_id,source_position_id,input_hash,
          listing_id,source_key,position_key,source_reference,
          source_reference_signal_hash,material_signal_hash,created_at
        )
        SELECT ?,CAST(json_extract(value,'$.ordinal') AS INTEGER),
               CAST(json_extract(value,'$.positionItemId') AS TEXT),
               CAST(json_extract(value,'$.sourcePositionId') AS TEXT),
               CAST(json_extract(value,'$.inputHash') AS TEXT),
               CAST(json_extract(value,'$.listingId') AS TEXT),
               CAST(json_extract(value,'$.sourceKey') AS TEXT),
               CAST(json_extract(value,'$.positionKey') AS TEXT),
               CAST(json_extract(value,'$.sourceReference') AS TEXT),
               CAST(json_extract(value,'$.sourceReferenceSignalHash') AS TEXT),
               CAST(json_extract(value,'$.materialSignalHash') AS TEXT),?
          FROM json_each(?)
         WHERE EXISTS (
           SELECT 1 FROM public_projection_duplicate_work work
            WHERE work.run_id=? AND work.phase='members'
              AND work.status='processing' AND work.lease_token=?
         )`
      )
      .bind(
        input.runId,
        input.timestamp,
        payload,
        input.runId,
        input.leaseToken
      ),
    assertionStatement(db, input.members.length),
    db
      .prepare(
        `UPDATE public_projection_duplicate_work
            SET member_count=member_count+?,member_cursor=?,member_digest=?,
                phase=?,status='queued',lease_token=NULL,
                lease_expires_at=NULL,updated_at=?
          WHERE run_id=? AND phase='members' AND status='processing'
            AND lease_token=?`
      )
      .bind(
        input.members.length,
        input.nextCursor,
        input.digest,
        input.nextPhase,
        input.timestamp,
        input.runId,
        input.leaseToken
      ),
    assertionStatement(db, 1),
  ]);
  assertPageCommit(results, input.members.length, "duplicate member");
}

export async function storeDuplicateComparisonPage(
  db: D1Database,
  input: {
    comparisons: ImmutableDuplicateComparison[];
    digest: string;
    leaseToken: string;
    nextCursor: { owner: string; target: string };
    nextPhase: "existing_public" | "ready" | "same_run";
    phase: "existing_public" | "same_run";
    runId: string;
    timestamp: string;
  }
) {
  const payload = canonicalJson(input.comparisons.map(comparisonInsertRecord));
  assertBoundedBinding(payload, "duplicate comparison");
  const cursorAssignments =
    input.phase === "existing_public"
      ? "existing_public_cursor=?,same_run_owner_cursor=same_run_owner_cursor,same_run_target_cursor=same_run_target_cursor"
      : "existing_public_cursor=existing_public_cursor,same_run_owner_cursor=?,same_run_target_cursor=?";
  const cursorValues =
    input.phase === "existing_public"
      ? [input.nextCursor.owner]
      : [input.nextCursor.owner, input.nextCursor.target];
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO public_projection_duplicate_comparisons (
          id,run_id,owner_position_item_id,owner_source_position_id,
          owner_input_hash,target_kind,target_public_job_id,
          target_public_job_version,target_redirect_root_id,
          target_position_item_id,target_source_position_id,target_input_hash,
          retrieval_algorithm_version,matching_signals_json,
          conflicting_signals_json,relation,reason_code,created_at,updated_at
        )
        SELECT CAST(json_extract(value,'$.id') AS TEXT),?,
               CAST(json_extract(value,'$.ownerPositionItemId') AS TEXT),
               CAST(json_extract(value,'$.ownerSourcePositionId') AS TEXT),
               CAST(json_extract(value,'$.ownerInputHash') AS TEXT),
               CAST(json_extract(value,'$.targetKind') AS TEXT),
               CAST(json_extract(value,'$.targetPublicJobId') AS TEXT),
               CAST(json_extract(value,'$.targetPublicJobVersion') AS INTEGER),
               CAST(json_extract(value,'$.targetRedirectRootId') AS TEXT),
               CAST(json_extract(value,'$.targetPositionItemId') AS TEXT),
               CAST(json_extract(value,'$.targetSourcePositionId') AS TEXT),
               CAST(json_extract(value,'$.targetInputHash') AS TEXT),?,
               json_extract(value,'$.matchingSignalsJson'),
               json_extract(value,'$.conflictingSignalsJson'),
               CAST(json_extract(value,'$.relation') AS TEXT),
               CAST(json_extract(value,'$.reasonCode') AS TEXT),
               CAST(json_extract(value,'$.createdAt') AS TEXT),
               CAST(json_extract(value,'$.createdAt') AS TEXT)
          FROM json_each(?)
         WHERE EXISTS (
           SELECT 1 FROM public_projection_duplicate_work work
            WHERE work.run_id=? AND work.phase=? AND work.status='processing'
              AND work.lease_token=?
         )`
      )
      .bind(
        input.runId,
        PUBLIC_DUPLICATE_RETRIEVAL_VERSION,
        payload,
        input.runId,
        input.phase,
        input.leaseToken
      ),
    assertionStatement(db, input.comparisons.length),
    db
      .prepare(
        `UPDATE public_projection_duplicate_work
            SET comparison_count=comparison_count+?,comparison_digest=?,
                ${cursorAssignments},phase=?,status='queued',
                lease_token=NULL,lease_expires_at=NULL,updated_at=?
          WHERE run_id=? AND phase=? AND status='processing'
            AND lease_token=?`
      )
      .bind(
        input.comparisons.length,
        input.digest,
        ...cursorValues,
        input.nextPhase,
        input.timestamp,
        input.runId,
        input.phase,
        input.leaseToken
      ),
    assertionStatement(db, 1),
  ]);
  assertPageCommit(results, input.comparisons.length, "duplicate comparison");
}

export async function sealDuplicateBatch(
  db: D1Database,
  input: {
    batch: DuplicateBatchSnapshot;
    leaseToken: string;
    timestamp: string;
  }
) {
  const { batch } = input;
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO public_projection_duplicate_batches (
          run_id,retrieval_algorithm_version,input_hash,
          position_member_count,comparison_count,member_digest,
          comparison_digest,canonical_identity_state,created_at
        ) VALUES (?,?,?,?,?,?,?,'pending',?)`
      )
      .bind(
        batch.runId,
        PUBLIC_DUPLICATE_RETRIEVAL_VERSION,
        batch.inputHash,
        batch.positionMemberCount,
        batch.comparisonCount,
        batch.memberDigest,
        batch.comparisonDigest,
        batch.createdAt
      ),
    assertionStatement(db, 1),
    db
      .prepare(
        `UPDATE public_projection_duplicate_work
            SET phase='sealed',status='sealed',lease_token=NULL,
                lease_expires_at=NULL,updated_at=?
          WHERE run_id=? AND phase='ready' AND status='processing'
            AND lease_token=?`
      )
      .bind(input.timestamp, batch.runId, input.leaseToken),
    assertionStatement(db, 1),
  ]);
  if (
    (results[0]?.meta.changes ?? 0) !== 1 ||
    (results[2]?.meta.changes ?? 0) !== 1
  ) {
    throw new Error("Duplicate batch seal lost its work lease");
  }
  const stored = await readDuplicateBatch(db, batch.runId);
  if (!stored || canonicalJson(stored) !== canonicalJson(batch)) {
    throw new Error("Stored duplicate batch conflicts with its sealed input");
  }
}

export async function readDuplicateBatch(
  db: D1Database,
  runId: string
): Promise<DuplicateBatchSnapshot | null> {
  const row = await db
    .prepare(
      `SELECT * FROM public_projection_duplicate_batches
        WHERE run_id=? LIMIT 1`
    )
    .bind(runId)
    .first<DuplicateBatchRow>();
  if (!row) {
    return null;
  }
  if (
    row.retrieval_algorithm_version !== PUBLIC_DUPLICATE_RETRIEVAL_VERSION ||
    row.canonical_identity_state !== "pending"
  ) {
    throw new Error("Stored duplicate batch contract is unsupported");
  }
  return {
    comparisonCount: row.comparison_count,
    comparisonDigest: row.comparison_digest,
    createdAt: row.created_at,
    inputHash: row.input_hash,
    memberDigest: row.member_digest,
    positionMemberCount: row.position_member_count,
    runId: row.run_id,
  };
}

export async function readDuplicateComparisons(
  db: D1Database,
  runId: string
): Promise<ImmutableDuplicateComparison[]> {
  const result = await db
    .prepare(
      `SELECT * FROM public_projection_duplicate_comparisons
        WHERE run_id=? ORDER BY id`
    )
    .bind(runId)
    .all<Record<string, unknown>>();
  return result.results.map(comparisonFromRow);
}

export async function readDuplicateComparisonPairPage(
  db: D1Database,
  input: {
    cursor: null | { leftMemberKey: string; rightMemberKey: string };
    limit: number;
    runId: string;
  }
) {
  const cursorLeft = input.cursor === null ? null : input.cursor.leftMemberKey;
  const cursorLeftValue =
    input.cursor === null ? "" : input.cursor.leftMemberKey;
  const cursorRightValue =
    input.cursor === null ? "" : input.cursor.rightMemberKey;
  const result = await db
    .prepare(
      `WITH pairs AS (
        SELECT comparison.*,
               CASE WHEN owner.member_key<COALESCE(
                 target.member_key,
                 'public:' || root.redirect_root_id || ':' ||
                   root.public_job_version || ':' ||
                   root.eligibility_decision_version
               ) THEN owner.member_key ELSE COALESCE(
                 target.member_key,
                 'public:' || root.redirect_root_id || ':' ||
                   root.public_job_version || ':' ||
                   root.eligibility_decision_version
               ) END left_member_key,
               CASE WHEN owner.member_key<COALESCE(
                 target.member_key,
                 'public:' || root.redirect_root_id || ':' ||
                   root.public_job_version || ':' ||
                   root.eligibility_decision_version
               ) THEN COALESCE(
                 target.member_key,
                 'public:' || root.redirect_root_id || ':' ||
                   root.public_job_version || ':' ||
                   root.eligibility_decision_version
               ) ELSE owner.member_key END right_member_key
          FROM public_projection_duplicate_comparisons comparison
          JOIN public_projection_final_work_resolution_inputs owner
            ON owner.run_id=comparison.run_id
           AND owner.position_item_id=comparison.owner_position_item_id
          LEFT JOIN public_projection_final_work_resolution_inputs target
            ON target.run_id=comparison.run_id
           AND target.position_item_id=comparison.target_position_item_id
          LEFT JOIN public_projection_final_work_public_roots root
            ON root.run_id=comparison.run_id
           AND root.originating_public_job_id=comparison.target_public_job_id
         WHERE comparison.run_id=?
      )
      SELECT * FROM pairs
       WHERE left_member_key IS NOT NULL AND right_member_key IS NOT NULL
         AND (? IS NULL OR left_member_key>?
           OR (left_member_key=? AND right_member_key>?))
       ORDER BY left_member_key,right_member_key LIMIT ?`
    )
    .bind(
      input.runId,
      cursorLeft,
      cursorLeftValue,
      cursorLeftValue,
      cursorRightValue,
      input.limit
    )
    .all<Record<string, unknown>>();
  return result.results.map((row) => ({
    comparison: comparisonFromRow(row),
    leftMemberKey: String(row.left_member_key),
    rightMemberKey: String(row.right_member_key),
  }));
}
