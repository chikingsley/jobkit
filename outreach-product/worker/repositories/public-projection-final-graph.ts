import { canonicalJson } from "../services/public-projection/hash";
import {
  type BoundaryRow,
  type CanonicalLiveCandidate,
  type CurrentSourceMapping,
  type FinalGraphBoundary,
  type FinalGraphMemberSnapshot,
  type FinalOperatorDecision,
  type MemberRow,
  PUBLIC_FINAL_GRAPH_MAX_BINDING_BYTES,
  PUBLIC_FINAL_GRAPH_MAX_BINDING_ROWS,
  type PublicAllocationCollision,
  type PublicRootSnapshot,
  type RootRow,
} from "./public-projection-final-graph/model";

export type {
  CanonicalLiveCandidate,
  CurrentSourceMapping,
  FinalDuplicateSeal,
  FinalGraphBoundary,
  FinalGraphMemberSnapshot,
  FinalGraphStoreInput,
  FinalOperatorDecision,
  PublicAllocationCollision,
  PublicRootSnapshot,
  StoredAllocationRoot,
  StoredCanonicalLiveInput,
  StoredFinalMember,
  StoredFinalRelation,
} from "./public-projection-final-graph/model";
// biome-ignore lint/performance/noBarrelFile: This behavior-owning repository preserves the stable D3 storage API after internal decomposition.
export {
  PUBLIC_DUPLICATE_FINALIZATION_VERSION,
  PUBLIC_FINAL_GRAPH_MAX_BINDING_BYTES,
  PUBLIC_FINAL_GRAPH_MAX_BINDING_ROWS,
  PUBLIC_JOB_ALLOCATION_VERSION,
} from "./public-projection-final-graph/model";
export { readFinalDuplicateSeal } from "./public-projection-final-graph/seal";
export { storeFinalDuplicateGraph } from "./public-projection-final-graph/store";

export async function readFinalGraphBoundary(
  db: D1Database,
  runId: string
): Promise<FinalGraphBoundary | null> {
  const row = await db
    .prepare(
      `SELECT run.id run_id,run.mode,run.status run_status,
              run.selection_complete,batch.input_hash duplicate_batch_input_hash,
              batch.position_member_count duplicate_member_count,
              (SELECT COUNT(*) FROM public_projection_resolution_seals seal
                WHERE seal.run_id=run.id) resolution_count,
              (SELECT COUNT(*) FROM public_projection_resolution_seals seal
                WHERE seal.run_id=run.id AND seal.state='resolved')
                resolved_position_count,
              (SELECT COUNT(*) FROM public_projection_resolution_seals seal
                WHERE seal.run_id=run.id AND seal.state<>'resolved')
                blocked_resolution_count
         FROM public_projection_runs run
         JOIN public_projection_duplicate_batches batch ON batch.run_id=run.id
        WHERE run.id=? AND batch.canonical_identity_state='pending'
        LIMIT 1`
    )
    .bind(runId)
    .first<BoundaryRow>();
  return row
    ? {
        blockedResolutionCount: row.blocked_resolution_count,
        duplicateBatchInputHash: row.duplicate_batch_input_hash,
        duplicateMemberCount: row.duplicate_member_count,
        mode: row.mode,
        resolutionCount: row.resolution_count,
        resolvedPositionCount: row.resolved_position_count,
        runId: row.run_id,
        runStatus: row.run_status,
        selectionComplete: row.selection_complete,
      }
    : null;
}

export async function readFinalGraphMemberPage(
  db: D1Database,
  input: {
    cursor: {
      inputHash: string;
      positionItemId: string;
      sourcePositionId: string;
    } | null;
    limit: number;
    runId: string;
  }
): Promise<FinalGraphMemberSnapshot[]> {
  const cursor = input.cursor ?? {
    inputHash: "",
    positionItemId: "",
    sourcePositionId: "",
  };
  const rows = await db
    .prepare(
      `SELECT member.position_item_id,member.source_position_id,
              member.input_hash,item.checkpoint_json,
              seal.state resolution_state,
              seal.reason_code resolution_reason_code,
              seal.seal_hash resolution_seal_hash,
              signal.signal_hash canonical_signal_hash
         FROM public_projection_duplicate_batch_members member
              INDEXED BY idx_projection_final_member_snapshot_page
         JOIN public_projection_position_items item
           ON item.run_id=member.run_id AND item.id=member.position_item_id
         JOIN public_projection_resolution_seals seal
           ON seal.run_id=member.run_id
          AND seal.position_item_id=member.position_item_id
         JOIN public_projection_canonical_identity_signals signal
           ON signal.run_id=member.run_id
          AND signal.position_item_id=member.position_item_id
        WHERE member.run_id=?
          AND (member.source_position_id,member.input_hash,
               member.position_item_id)>(?,?,?)
        ORDER BY member.source_position_id,member.input_hash,
                 member.position_item_id
        LIMIT ?`
    )
    .bind(
      input.runId,
      cursor.sourcePositionId,
      cursor.inputHash,
      cursor.positionItemId,
      input.limit
    )
    .all<MemberRow>();
  return rows.results.map(memberSnapshotFromRow);
}

function memberSnapshotFromRow(row: MemberRow): FinalGraphMemberSnapshot {
  return {
    canonicalSignalHash: row.canonical_signal_hash,
    checkpointJson: row.checkpoint_json,
    inputHash: row.input_hash,
    positionItemId: row.position_item_id,
    resolutionReasonCode: row.resolution_reason_code,
    resolutionSealHash: row.resolution_seal_hash,
    resolutionState: row.resolution_state,
    sourcePositionId: row.source_position_id,
  };
}

export async function readCurrentSourceMappings(
  db: D1Database,
  sourcePositionIds: string[]
): Promise<CurrentSourceMapping[]> {
  if (sourcePositionIds.length === 0) {
    return [];
  }
  const payload = boundedJson(sourcePositionIds, "source mapping keys");
  const rows = await db
    .prepare(
      `SELECT CAST(requested.value AS TEXT) source_position_id,
              CASE WHEN head.source_position_id IS NULL THEN 0 ELSE 1 END
                head_present,
              COALESCE(mapping.mapping_state,'absent') mapping_state,
              mapping.version mapping_version,mapping.public_job_id,
              mapping.mapping_hash
         FROM json_each(?) requested
         LEFT JOIN job_source_position_mapping_heads head
           ON head.source_position_id=CAST(requested.value AS TEXT)
         LEFT JOIN job_source_position_mapping_versions mapping
           ON mapping.source_position_id=head.source_position_id
          AND mapping.version=head.current_version
        ORDER BY source_position_id`
    )
    .bind(payload)
    .all<{
      head_present: number;
      mapping_hash: null | string;
      mapping_state: "absent" | "mapped" | "unmapped";
      mapping_version: null | number;
      public_job_id: null | string;
      source_position_id: string;
    }>();
  return rows.results.map((row) => ({
    headPresent: row.head_present === 1,
    mappingHash: row.mapping_hash,
    mappingState: row.mapping_state,
    mappingVersion: row.mapping_version,
    publicJobId: row.public_job_id,
    sourcePositionId: row.source_position_id,
  }));
}

export async function readCanonicalLiveCandidatePage(
  db: D1Database,
  input: {
    cursor: { publicJobId: string; publicJobVersion: number } | null;
    limit: number;
    signalHash: string;
  }
): Promise<CanonicalLiveCandidate[]> {
  const cursor = input.cursor ?? { publicJobId: "", publicJobVersion: 0 };
  const rows = await db
    .prepare(CANONICAL_LIVE_CANDIDATE_PAGE_SQL)
    .bind(
      input.signalHash,
      cursor.publicJobId,
      cursor.publicJobVersion,
      input.limit
    )
    .all<{
      public_job_id: string;
      public_job_version: number;
      signal_hash: string;
    }>();
  return rows.results.map((row) => ({
    publicJobId: row.public_job_id,
    publicJobVersion: row.public_job_version,
    signalHash: row.signal_hash,
    signalKind: "canonical_identity_v1",
  }));
}

export const CANONICAL_LIVE_CANDIDATE_PAGE_SQL = `SELECT signal.signal_hash,
       signal.public_job_id,signal.public_job_version
  FROM public_job_identity_signals signal
       INDEXED BY idx_public_job_canonical_signal_page
  JOIN public_job_heads head
    ON head.public_job_id=signal.public_job_id
   AND head.current_version=signal.public_job_version
 WHERE signal.signal_kind='canonical_identity_v1' AND signal.signal_hash=?
   AND (signal.public_job_id,signal.public_job_version)>(?,?)
 ORDER BY signal.public_job_id,signal.public_job_version LIMIT ?`;

export async function readPublicRootSnapshots(
  db: D1Database,
  publicJobIds: string[]
): Promise<PublicRootSnapshot[]> {
  if (publicJobIds.length === 0) {
    return [];
  }
  const payload = boundedJson(
    [...new Set(publicJobIds)].sort(),
    "public root inputs"
  );
  const rows = await db
    .prepare(
      `WITH RECURSIVE
       requested(public_job_id) AS (
         SELECT CAST(value AS TEXT) FROM json_each(?)
       ),
       redirect_chain(
         originating_public_job_id,public_job_id,depth,path,path_json
       ) AS (
         SELECT requested.public_job_id,requested.public_job_id,0,
                '|' || requested.public_job_id || '|',
                json_array(requested.public_job_id)
           FROM requested
         UNION ALL
         SELECT chain.originating_public_job_id,
                decision.redirect_public_job_id,chain.depth+1,
                chain.path || decision.redirect_public_job_id || '|',
                json_insert(
                  chain.path_json,'$[#]',decision.redirect_public_job_id
                )
           FROM redirect_chain chain
           JOIN public_job_eligibility_heads head
             ON head.public_job_id=chain.public_job_id
           JOIN public_job_eligibility_decisions decision
             ON decision.public_job_id=head.public_job_id
            AND decision.decision_version=head.current_decision_version
          WHERE decision.publication_state='merged'
            AND decision.redirect_public_job_id IS NOT NULL
            AND chain.depth<100
            AND instr(
              chain.path,'|' || decision.redirect_public_job_id || '|'
            )=0
       ),
       terminal AS (
         SELECT chain.*,
                ROW_NUMBER() OVER (
                  PARTITION BY chain.originating_public_job_id
                  ORDER BY chain.depth DESC
                ) terminal_rank
           FROM redirect_chain chain
          WHERE NOT EXISTS (
            SELECT 1 FROM public_job_eligibility_heads head
            JOIN public_job_eligibility_decisions decision
              ON decision.public_job_id=head.public_job_id
             AND decision.decision_version=head.current_decision_version
             WHERE head.public_job_id=chain.public_job_id
               AND decision.publication_state='merged'
               AND decision.redirect_public_job_id IS NOT NULL
          )
       )
       SELECT terminal.originating_public_job_id,
              terminal.public_job_id redirect_root_id,
              terminal.path_json redirect_path_json,
              job_head.current_version public_job_version,
              eligibility_head.current_decision_version
                eligibility_decision_version,
              public_job.created_at public_job_created_at,
              CASE WHEN EXISTS (
                SELECT 1 FROM public_job_eligibility_decisions history
                 WHERE history.public_job_id=terminal.public_job_id
                   AND history.publication_state='published'
                   AND history.route_disposition='serve'
              ) THEN 1 ELSE 0 END served_publicly,
              (
                SELECT MIN(history.decided_at)
                  FROM public_job_eligibility_decisions history
                 WHERE history.public_job_id=terminal.public_job_id
                   AND history.publication_state='published'
                   AND history.route_disposition='serve'
              ) first_published_at,
              allocation.founding_source_position_id,
              allocation.allocation_hash
         FROM terminal
         JOIN public_jobs public_job ON public_job.id=terminal.public_job_id
         JOIN public_job_heads job_head
           ON job_head.public_job_id=terminal.public_job_id
         JOIN public_job_eligibility_heads eligibility_head
           ON eligibility_head.public_job_id=terminal.public_job_id
         LEFT JOIN public_job_allocations allocation
           ON allocation.public_job_id=terminal.public_job_id
        WHERE terminal.terminal_rank=1
        ORDER BY terminal.originating_public_job_id`
    )
    .bind(payload)
    .all<RootRow>();
  return rows.results.map((row) => ({
    allocationHash: row.allocation_hash,
    eligibilityDecisionVersion: row.eligibility_decision_version,
    firstPublishedAt: row.first_published_at,
    foundingSourcePositionId: row.founding_source_position_id,
    originatingPublicJobId: row.originating_public_job_id,
    publicJobCreatedAt: row.public_job_created_at,
    publicJobVersion: row.public_job_version,
    redirectPath: JSON.parse(row.redirect_path_json) as string[],
    redirectRootId: row.redirect_root_id,
    servedPublicly: row.served_publicly === 1,
  }));
}

export async function readTerminalOperatorDecisions(
  db: D1Database,
  pairs: { leftMemberKey: string; rightMemberKey: string }[]
): Promise<FinalOperatorDecision[]> {
  if (pairs.length === 0) {
    return [];
  }
  const payload = boundedJson(pairs, "operator decision pairs");
  const rows = await db
    .prepare(
      `WITH requested AS (
         SELECT CAST(json_extract(value,'$.leftMemberKey') AS TEXT)
                  left_member_key,
                CAST(json_extract(value,'$.rightMemberKey') AS TEXT)
                  right_member_key
           FROM json_each(?)
       )
       SELECT decision.id,decision.left_member_key,
              decision.right_member_key,decision.decision,
              decision.reason_code,decision.decision_hash
         FROM requested
         JOIN public_projection_duplicate_operator_decisions decision
           ON decision.left_member_key=requested.left_member_key
          AND decision.right_member_key=requested.right_member_key
        WHERE NOT EXISTS (
          SELECT 1 FROM public_projection_duplicate_operator_decisions next
           WHERE next.supersedes_decision_id=decision.id
        )
        ORDER BY decision.left_member_key,decision.right_member_key`
    )
    .bind(payload)
    .all<{
      decision: FinalOperatorDecision["decision"];
      decision_hash: string;
      id: string;
      left_member_key: string;
      reason_code: FinalOperatorDecision["reasonCode"];
      right_member_key: string;
    }>();
  return rows.results.map((row) => ({
    decision: row.decision,
    decisionHash: row.decision_hash,
    id: row.id,
    leftMemberKey: row.left_member_key,
    reasonCode: row.reason_code,
    rightMemberKey: row.right_member_key,
  }));
}

export async function readPublicAllocationCollisions(
  db: D1Database,
  publicJobIds: string[]
): Promise<PublicAllocationCollision[]> {
  if (publicJobIds.length === 0) {
    return [];
  }
  const payload = boundedJson(publicJobIds, "allocation collision ids");
  const rows = await db
    .prepare(
      `SELECT CAST(requested.value AS TEXT) public_job_id,
              CASE WHEN public_job.id IS NULL THEN 0 ELSE 1 END
                public_job_present,
              allocation.allocation_algorithm_version,
              allocation.founding_source_position_id,
              allocation.allocation_hash
         FROM json_each(?) requested
         LEFT JOIN public_jobs public_job
           ON public_job.id=CAST(requested.value AS TEXT)
         LEFT JOIN public_job_allocations allocation
           ON allocation.public_job_id=public_job.id
        ORDER BY CAST(requested.value AS TEXT)`
    )
    .bind(payload)
    .all<{
      allocation_algorithm_version: null | string;
      allocation_hash: null | string;
      founding_source_position_id: null | string;
      public_job_id: string;
      public_job_present: number;
    }>();
  return rows.results.map((row) => ({
    allocationAlgorithmVersion: row.allocation_algorithm_version,
    allocationHash: row.allocation_hash,
    foundingSourcePositionId: row.founding_source_position_id,
    publicJobId: row.public_job_id,
    publicJobPresent: row.public_job_present === 1,
  }));
}

function boundedJson(value: unknown, label: string) {
  if (
    Array.isArray(value) &&
    value.length > PUBLIC_FINAL_GRAPH_MAX_BINDING_ROWS
  ) {
    throw new Error(`The ${label} payload exceeds the fixed D1 row limit`);
  }
  const payload = canonicalJson(value);
  if (
    new TextEncoder().encode(payload).byteLength >
    PUBLIC_FINAL_GRAPH_MAX_BINDING_BYTES
  ) {
    throw new Error(`The ${label} payload exceeds the fixed D1 binding limit`);
  }
  return payload;
}
