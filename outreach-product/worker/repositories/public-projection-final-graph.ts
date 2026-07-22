import { canonicalJson } from "../services/public-projection/hash";

export const PUBLIC_DUPLICATE_FINALIZATION_VERSION =
  "public-duplicate-finalization-v1" as const;
export const PUBLIC_JOB_ALLOCATION_VERSION =
  "public-job-allocation-v1" as const;
export const PUBLIC_FINAL_GRAPH_MAX_BINDING_BYTES = 1_000_000;
export const PUBLIC_FINAL_GRAPH_MAX_BINDING_ROWS = 24;

export interface FinalGraphBoundary {
  blockedResolutionCount: number;
  duplicateBatchInputHash: string;
  duplicateMemberCount: number;
  mode: string;
  resolutionCount: number;
  resolvedPositionCount: number;
  runId: string;
  runStatus: string;
  selectionComplete: number;
}

export interface FinalGraphMemberSnapshot {
  canonicalSignalHash: null | string;
  checkpointJson: string;
  inputHash: string;
  positionItemId: string;
  resolutionReasonCode: string;
  resolutionSealHash: string;
  resolutionState: "ambiguous" | "blocked" | "resolved" | "unresolved";
  sourcePositionId: string;
}

export interface CurrentSourceMapping {
  headPresent: boolean;
  mappingHash: null | string;
  mappingState: "absent" | "mapped" | "unmapped";
  mappingVersion: null | number;
  publicJobId: null | string;
  sourcePositionId: string;
}

export interface CanonicalLiveCandidate {
  publicJobId: string;
  publicJobVersion: number;
  signalHash: string;
  signalKind: "canonical_identity_v1";
}

export interface StoredCanonicalLiveInput extends CanonicalLiveCandidate {
  inputHash: string;
}

export interface PublicRootSnapshot {
  allocationHash: null | string;
  eligibilityDecisionVersion: number;
  firstPublishedAt: null | string;
  foundingSourcePositionId: null | string;
  originatingPublicJobId: string;
  publicJobCreatedAt: string;
  publicJobVersion: number;
  redirectPath: string[];
  redirectRootId: string;
  servedPublicly: boolean;
}

export interface FinalOperatorDecision {
  decision: "deferred" | "different" | "same";
  decisionHash: string;
  id: string;
  leftMemberKey: string;
  reasonCode:
    | "operator_confirmed_different"
    | "operator_confirmed_same"
    | "operator_deferred";
  rightMemberKey: string;
}

export interface PublicAllocationCollision {
  allocationAlgorithmVersion: null | string;
  allocationHash: null | string;
  foundingSourcePositionId: null | string;
  publicJobId: string;
  publicJobPresent: boolean;
}

export type StoredFinalMember =
  | {
      inputHash: string;
      kind: "shadow";
      memberHash: string;
      memberKey: string;
      positionItemId: string;
      sourcePositionId: string;
    }
  | {
      eligibilityDecisionVersion: number;
      kind: "public";
      memberHash: string;
      memberKey: string;
      publicJobId: string;
      publicJobVersion: number;
    };

export interface StoredFinalRelation {
  conflictingSignals: unknown[];
  d2ComparisonId: null | string;
  id: string;
  left: StoredFinalMember;
  matchingSignals: unknown[];
  operatorDecisionId: null | string;
  reasonCode: string;
  relation: "ambiguous" | "different" | "same";
  relationHash: string;
  right: StoredFinalMember;
}

export interface StoredAllocationRoot {
  eligibilityDecisionVersion: number;
  firstPublishedAt: null | string;
  foundingSourcePositionId: null | string;
  memberKey: string;
  publicJobCreatedAt: string;
  publicJobId: string;
  publicJobVersion: number;
  reasonCode: string;
  rootHash: string;
  selected: boolean;
  servedPublicly: boolean;
}

export interface FinalGraphStoreInput {
  seal: FinalDuplicateSeal;
}

export interface FinalDuplicateSeal {
  allocationCount: number;
  allocationDigest: string;
  blockedAllocationCount: number;
  blockedResolutionCount: number;
  canonicalLiveInputCount: number;
  canonicalLiveInputDigest: string;
  createdAt: string;
  duplicateBatchInputHash: string;
  promotableCount: number;
  relationCount: number;
  relationDigest: string;
  resolutionCount: number;
  resolutionDigest: string;
  resolvedPositionCount: number;
  runId: string;
  sealHash: string;
  sourceMappingInputCount: number;
  sourceMappingInputDigest: string;
}

interface BoundaryRow {
  blocked_resolution_count: number;
  duplicate_batch_input_hash: string;
  duplicate_member_count: number;
  mode: string;
  resolution_count: number;
  resolved_position_count: number;
  run_id: string;
  run_status: string;
  selection_complete: number;
}

interface MemberRow {
  canonical_signal_hash: null | string;
  checkpoint_json: string;
  input_hash: string;
  position_item_id: string;
  resolution_reason_code: string;
  resolution_seal_hash: string;
  resolution_state: FinalGraphMemberSnapshot["resolutionState"];
  source_position_id: string;
}

interface RootRow {
  allocation_hash: null | string;
  eligibility_decision_version: number;
  first_published_at: null | string;
  founding_source_position_id: null | string;
  originating_public_job_id: string;
  public_job_created_at: string;
  public_job_version: number;
  redirect_path_json: string;
  redirect_root_id: string;
  served_publicly: number;
}

interface SealRow {
  allocation_count: number;
  allocation_digest: string;
  blocked_allocation_count: number;
  blocked_resolution_count: number;
  canonical_live_input_count: number;
  canonical_live_input_digest: string;
  created_at: string;
  duplicate_batch_input_hash: string;
  promotable_count: number;
  relation_count: number;
  relation_digest: string;
  resolution_count: number;
  resolution_digest: string;
  resolved_position_count: number;
  run_id: string;
  seal_hash: string;
  source_mapping_input_count: number;
  source_mapping_input_digest: string;
}

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

export async function readFinalDuplicateSeal(
  db: D1Database,
  runId: string
): Promise<FinalDuplicateSeal | null> {
  const row = await db
    .prepare(
      `SELECT * FROM public_projection_final_duplicate_seals
        WHERE run_id=? LIMIT 1`
    )
    .bind(runId)
    .first<SealRow>();
  return row ? sealFromRow(row) : null;
}

export async function storeFinalDuplicateGraph(
  db: D1Database,
  input: FinalGraphStoreInput
) {
  const { seal } = input;
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO public_projection_final_assertions (
          expected_changes,actual_changes
        ) VALUES (2,(
          SELECT
            CASE WHEN NOT EXISTS (
              SELECT 1
                FROM public_projection_final_work_canonical_matches work
               WHERE work.run_id=? AND NOT EXISTS (
                 SELECT 1 FROM public_job_identity_signals signal
                 JOIN public_job_heads head
                   ON head.public_job_id=signal.public_job_id
                  AND head.current_version=signal.public_job_version
                WHERE signal.public_job_id=work.public_job_id
                  AND signal.public_job_version=work.public_job_version
                  AND signal.signal_kind=work.signal_kind
                  AND signal.signal_hash=work.signal_hash
               )
            ) THEN 1 ELSE 0 END
            + CASE WHEN (
              SELECT COUNT(*)
                FROM public_projection_final_work_canonical_requests request
                JOIN public_job_identity_signals signal
                  ON signal.signal_kind='canonical_identity_v1'
                 AND signal.signal_hash=request.signal_hash
                JOIN public_job_heads head
                  ON head.public_job_id=signal.public_job_id
                 AND head.current_version=signal.public_job_version
               WHERE request.run_id=?
            )=(
              SELECT COUNT(*)
                FROM public_projection_final_work_canonical_matches work
               WHERE work.run_id=?
            ) THEN 1 ELSE 0 END
        ))`
      )
      .bind(seal.runId, seal.runId, seal.runId),
    db
      .prepare(
        `INSERT INTO public_projection_final_assertions (
          expected_changes,actual_changes
        ) SELECT COUNT(*),COALESCE(SUM(CASE WHEN
          (work.head_present=0 AND work.mapping_state='absent'
            AND NOT EXISTS (
              SELECT 1 FROM job_source_position_mapping_heads head
               WHERE head.source_position_id=work.source_position_id
            ))
          OR (work.head_present=1
            AND work.mapping_state IN ('mapped','unmapped')
            AND EXISTS (
              SELECT 1 FROM job_source_position_mapping_heads head
              JOIN job_source_position_mapping_versions mapping
                ON mapping.source_position_id=head.source_position_id
               AND mapping.version=head.current_version
             WHERE head.source_position_id=work.source_position_id
               AND head.current_version=work.mapping_version
               AND mapping.mapping_state=work.mapping_state
               AND mapping.public_job_id IS work.public_job_id
               AND mapping.mapping_hash=work.mapping_hash
            )) THEN 1 ELSE 0 END),0)
          FROM public_projection_final_work_mapping_inputs work
         WHERE work.run_id=?`
      )
      .bind(seal.runId),
    publicRootPinAssertion(db, seal.runId),
    operatorDecisionPinAssertion(db, seal.runId),
    proposedIdCollisionPinAssertion(db, seal.runId),
    db
      .prepare(
        `INSERT INTO public_projection_final_canonical_live_inputs (
          run_id,public_job_id,public_job_version,signal_kind,signal_hash,
          input_hash,created_at
        )
        SELECT run_id,public_job_id,public_job_version,signal_kind,signal_hash,
               input_hash,?
          FROM public_projection_final_work_canonical_matches
         WHERE run_id=? ORDER BY signal_hash,public_job_id,public_job_version`
      )
      .bind(seal.createdAt, seal.runId),
    db
      .prepare(
        `INSERT INTO public_projection_final_source_mapping_inputs (
          run_id,source_position_id,mapping_version,public_job_id,
          mapping_hash,input_hash,created_at
        )
        SELECT run_id,source_position_id,mapping_version,public_job_id,
               mapping_hash,input_hash,?
          FROM public_projection_final_work_mapping_inputs
         WHERE run_id=? AND mapping_state='mapped'
         ORDER BY source_position_id`
      )
      .bind(seal.createdAt, seal.runId),
    db
      .prepare(
        `INSERT INTO public_projection_final_duplicate_relations (
          run_id,id,left_member_key,left_member_kind,
          left_source_position_id,left_input_hash,left_public_job_id,
          left_public_job_version,left_eligibility_decision_version,
          right_member_key,right_member_kind,right_source_position_id,
          right_input_hash,right_public_job_id,right_public_job_version,
          right_eligibility_decision_version,d2_comparison_id,
          matching_signals_json,conflicting_signals_json,
          operator_decision_id,relation,reason_code,
          finalization_algorithm_version,relation_hash,created_at
        )
        SELECT run_id,id,
               CAST(json_extract(payload_json,'$.left.memberKey') AS TEXT),
               CAST(json_extract(payload_json,'$.left.kind') AS TEXT),
               CAST(json_extract(payload_json,'$.left.sourcePositionId') AS TEXT),
               CAST(json_extract(payload_json,'$.left.inputHash') AS TEXT),
               CAST(json_extract(payload_json,'$.left.publicJobId') AS TEXT),
               CAST(json_extract(payload_json,'$.left.publicJobVersion') AS INTEGER),
               CAST(json_extract(
                 payload_json,'$.left.eligibilityDecisionVersion') AS INTEGER),
               CAST(json_extract(payload_json,'$.right.memberKey') AS TEXT),
               CAST(json_extract(payload_json,'$.right.kind') AS TEXT),
               CAST(json_extract(payload_json,'$.right.sourcePositionId') AS TEXT),
               CAST(json_extract(payload_json,'$.right.inputHash') AS TEXT),
               CAST(json_extract(payload_json,'$.right.publicJobId') AS TEXT),
               CAST(json_extract(payload_json,'$.right.publicJobVersion') AS INTEGER),
               CAST(json_extract(
                 payload_json,'$.right.eligibilityDecisionVersion') AS INTEGER),
               CAST(json_extract(payload_json,'$.d2ComparisonId') AS TEXT),
               CAST(json_extract(payload_json,'$.matchingSignals') AS TEXT),
               CAST(json_extract(payload_json,'$.conflictingSignals') AS TEXT),
               CAST(json_extract(payload_json,'$.operatorDecisionId') AS TEXT),
               relation,
               CAST(json_extract(payload_json,'$.reasonCode') AS TEXT),?,
               relation_hash,?
          FROM public_projection_final_work_relations
         WHERE run_id=? ORDER BY ordinal`
      )
      .bind(PUBLIC_DUPLICATE_FINALIZATION_VERSION, seal.createdAt, seal.runId),
    db
      .prepare(
        `INSERT INTO public_projection_allocation_components (
          run_id,id,finalization_algorithm_version,
          allocation_algorithm_version,member_count,relation_count,
          candidate_root_count,founding_source_position_id,
          proposed_public_job_id,winning_public_job_id,losing_root_count,
          state,reason_code,allocation_hash,artifact_hash,created_at
        )
        SELECT run_id,allocation_id,?,?,member_count,relation_count,root_count,
               founding_source_position_id,proposed_public_job_id,
               winning_public_job_id,losing_root_count,allocation_state,
               reason_code,allocation_hash,artifact_hash,?
          FROM public_projection_final_component_work
         WHERE run_id=? AND state='sealed' ORDER BY seed_member_key`
      )
      .bind(
        PUBLIC_DUPLICATE_FINALIZATION_VERSION,
        PUBLIC_JOB_ALLOCATION_VERSION,
        seal.createdAt,
        seal.runId
      ),
    db
      .prepare(
        `INSERT INTO public_projection_allocation_members (
          run_id,allocation_id,ordinal,member_key,member_kind,
          position_item_id,source_position_id,input_hash,public_job_id,
          public_job_version,eligibility_decision_version,member_hash,
          created_at
        )
        SELECT member.run_id,component.allocation_id,member.ordinal,
               CAST(json_extract(member.payload_json,'$.memberKey') AS TEXT),
               CAST(json_extract(member.payload_json,'$.kind') AS TEXT),
               CAST(json_extract(member.payload_json,'$.positionItemId') AS TEXT),
               CAST(json_extract(member.payload_json,'$.sourcePositionId') AS TEXT),
               CAST(json_extract(member.payload_json,'$.inputHash') AS TEXT),
               CAST(json_extract(member.payload_json,'$.publicJobId') AS TEXT),
               CAST(json_extract(member.payload_json,'$.publicJobVersion') AS INTEGER),
               CAST(json_extract(
                 member.payload_json,'$.eligibilityDecisionVersion') AS INTEGER),
               member.member_hash,?
          FROM public_projection_final_work_component_members member
          JOIN public_projection_final_component_work component
            ON component.run_id=member.run_id
           AND component.seed_member_key=member.seed_member_key
         WHERE member.run_id=? AND component.state='sealed'
         ORDER BY component.seed_member_key,member.ordinal`
      )
      .bind(seal.createdAt, seal.runId),
    db
      .prepare(
        `INSERT INTO public_projection_allocation_roots (
          run_id,allocation_id,ordinal,member_key,public_job_id,
          public_job_version,eligibility_decision_version,served_publicly,
          first_published_at,public_job_created_at,
          founding_source_position_id,selected,reason_code,root_hash,
          created_at
        )
        SELECT root.run_id,component.allocation_id,root.ordinal,
               CAST(json_extract(root.payload_json,'$.memberKey') AS TEXT),
               CAST(json_extract(root.payload_json,'$.publicJobId') AS TEXT),
               CAST(json_extract(root.payload_json,'$.publicJobVersion') AS INTEGER),
               CAST(json_extract(
                 root.payload_json,'$.eligibilityDecisionVersion') AS INTEGER),
               CAST(json_extract(root.payload_json,'$.servedPublicly') AS INTEGER),
               CAST(json_extract(root.payload_json,'$.firstPublishedAt') AS TEXT),
               CAST(json_extract(root.payload_json,'$.publicJobCreatedAt') AS TEXT),
               CAST(json_extract(
                 root.payload_json,'$.foundingSourcePositionId') AS TEXT),
               CAST(json_extract(root.payload_json,'$.selected') AS INTEGER),
               CAST(json_extract(root.payload_json,'$.reasonCode') AS TEXT),
               root.root_hash,?
          FROM public_projection_final_work_component_roots root
          JOIN public_projection_final_component_work component
            ON component.run_id=root.run_id
           AND component.seed_member_key=root.seed_member_key
         WHERE root.run_id=? AND component.state='sealed'
         ORDER BY component.seed_member_key,root.ordinal`
      )
      .bind(seal.createdAt, seal.runId),
    db
      .prepare(
        `INSERT INTO public_projection_allocation_relations (
          run_id,allocation_id,ordinal,relation_id,relation_hash,created_at
        )
        SELECT relation.run_id,component.allocation_id,relation.ordinal,
               relation.relation_id,relation.relation_hash,?
          FROM public_projection_final_work_component_relations relation
          JOIN public_projection_final_component_work component
            ON component.run_id=relation.run_id
           AND component.seed_member_key=relation.seed_member_key
         WHERE relation.run_id=? AND component.state='sealed'
         ORDER BY component.seed_member_key,relation.ordinal`
      )
      .bind(seal.createdAt, seal.runId),
    db
      .prepare(
        `UPDATE public_projection_position_items
           SET stage='content',status='queued',
               checkpoint_json=(
                 SELECT updates.checkpoint_json
                   FROM public_projection_final_work_position_updates updates
                  WHERE updates.run_id=? AND updates.position_item_id=
                    public_projection_position_items.id
               ),
               updated_at=?
         WHERE run_id=? AND stage='canonical_resolution' AND status='queued'
           AND EXISTS (
             SELECT 1 FROM public_projection_final_work_position_updates updates
              WHERE updates.position_item_id=
                      public_projection_position_items.id
                AND updates.run_id=public_projection_position_items.run_id
                AND updates.source_position_id=
                      public_projection_position_items.source_position_id
                AND updates.input_hash=public_projection_position_items.input_hash
           )`
      )
      .bind(seal.runId, seal.createdAt, seal.runId),
    assertionStatement(db, seal.resolvedPositionCount),
    db
      .prepare(
        `INSERT INTO public_projection_final_duplicate_seals (
          run_id,duplicate_batch_input_hash,resolution_digest,
          canonical_live_input_digest,source_mapping_input_digest,
          relation_digest,allocation_digest,resolution_count,
          resolved_position_count,blocked_resolution_count,
          canonical_live_input_count,source_mapping_input_count,relation_count,
          allocation_count,promotable_count,blocked_allocation_count,
          finalization_algorithm_version,allocation_algorithm_version,
          seal_hash,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        seal.runId,
        seal.duplicateBatchInputHash,
        seal.resolutionDigest,
        seal.canonicalLiveInputDigest,
        seal.sourceMappingInputDigest,
        seal.relationDigest,
        seal.allocationDigest,
        seal.resolutionCount,
        seal.resolvedPositionCount,
        seal.blockedResolutionCount,
        seal.canonicalLiveInputCount,
        seal.sourceMappingInputCount,
        seal.relationCount,
        seal.allocationCount,
        seal.promotableCount,
        seal.blockedAllocationCount,
        PUBLIC_DUPLICATE_FINALIZATION_VERSION,
        PUBLIC_JOB_ALLOCATION_VERSION,
        seal.sealHash,
        seal.createdAt
      ),
    assertionStatement(db, 1),
    db
      .prepare(
        `UPDATE public_projection_final_work
            SET phase='sealed',status='sealed',lease_token=NULL,
                lease_expires_at=NULL,updated_at=?
          WHERE run_id=? AND phase='ready' AND status='queued'
            AND resolution_digest=? AND relation_digest=?
            AND component_digest=? AND allocation_digest=?`
      )
      .bind(
        seal.createdAt,
        seal.runId,
        seal.resolutionDigest,
        seal.relationDigest,
        seal.allocationDigest,
        seal.allocationDigest
      ),
    assertionStatement(db, 1),
  ]);
  const expectedChanges = [
    seal.canonicalLiveInputCount,
    seal.sourceMappingInputCount,
    seal.relationCount,
    seal.allocationCount,
    seal.resolvedPositionCount,
    1,
    1,
  ];
  const observed = [5, 6, 7, 8, 12, 14, 16].map(
    (index) => results[index]?.meta.changes ?? -1
  );
  if (canonicalJson(observed) !== canonicalJson(expectedChanges)) {
    throw new Error("The final duplicate graph lost its atomic write fence");
  }
  const stored = await readFinalDuplicateSeal(db, seal.runId);
  if (!stored || canonicalJson(stored) !== canonicalJson(seal)) {
    throw new Error("Stored final duplicate seal conflicts with its input");
  }
}

function publicRootPinAssertion(db: D1Database, runId: string) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_assertions (
        expected_changes,actual_changes
      )
      WITH RECURSIVE
      requested(originating_public_job_id) AS (
        SELECT originating_public_job_id
          FROM public_projection_final_work_public_roots
         WHERE run_id=?
      ),
      redirect_chain(
        originating_public_job_id,public_job_id,depth,path,path_json
      ) AS (
        SELECT requested.originating_public_job_id,
               requested.originating_public_job_id,0,
               '|' || requested.originating_public_job_id || '|',
               json_array(requested.originating_public_job_id)
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
      ),
      matching AS (
        SELECT work.originating_public_job_id
          FROM terminal
          JOIN public_projection_final_work_public_roots work
            ON work.run_id=?
           AND work.originating_public_job_id=
               terminal.originating_public_job_id
           AND work.redirect_root_id=terminal.public_job_id
           AND work.redirect_path_json=terminal.path_json
          JOIN public_jobs public_job ON public_job.id=terminal.public_job_id
          JOIN public_job_heads job_head
            ON job_head.public_job_id=terminal.public_job_id
           AND job_head.current_version=work.public_job_version
          JOIN public_job_eligibility_heads eligibility_head
            ON eligibility_head.public_job_id=terminal.public_job_id
           AND eligibility_head.current_decision_version=
               work.eligibility_decision_version
          LEFT JOIN public_job_allocations allocation
            ON allocation.public_job_id=terminal.public_job_id
         WHERE terminal.terminal_rank=1
           AND work.public_job_created_at=public_job.created_at
           AND work.served_publicly=(
             CASE WHEN EXISTS (
               SELECT 1 FROM public_job_eligibility_decisions history
                WHERE history.public_job_id=terminal.public_job_id
                  AND history.publication_state='published'
                  AND history.route_disposition='serve'
             ) THEN 1 ELSE 0 END
           )
           AND work.first_published_at IS (
             SELECT MIN(history.decided_at)
               FROM public_job_eligibility_decisions history
              WHERE history.public_job_id=terminal.public_job_id
                AND history.publication_state='published'
                AND history.route_disposition='serve'
           )
           AND work.founding_source_position_id IS
               allocation.founding_source_position_id
           AND work.allocation_hash IS allocation.allocation_hash
      )
      SELECT (
        SELECT COUNT(*)
          FROM public_projection_final_work_public_roots
         WHERE run_id=?
      ),(
        SELECT COUNT(*) FROM matching
      )`
    )
    .bind(runId, runId, runId);
}

function operatorDecisionPinAssertion(db: D1Database, runId: string) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_assertions (
        expected_changes,actual_changes
      ) VALUES ((
        SELECT COUNT(*) FROM public_projection_final_work_relations
         WHERE run_id=?
      ),(
        SELECT COUNT(*) FROM public_projection_final_work_relations work
         WHERE work.run_id=? AND work.operator_terminal=1 AND (
           (
             work.operator_decision_id IS NULL
             AND (
               work.relation<>'ambiguous' OR NOT EXISTS (
                 SELECT 1
                   FROM public_projection_duplicate_operator_decisions decision
                  WHERE decision.left_member_key=work.left_member_key
                    AND decision.right_member_key=work.right_member_key
                    AND NOT EXISTS (
                      SELECT 1
                        FROM public_projection_duplicate_operator_decisions next
                       WHERE next.supersedes_decision_id=decision.id
                    )
               )
             )
           )
           OR EXISTS (
             SELECT 1
               FROM public_projection_duplicate_operator_decisions decision
              WHERE decision.id=work.operator_decision_id
                AND decision.left_member_key=work.left_member_key
                AND decision.right_member_key=work.right_member_key
                AND decision.decision_hash=work.operator_decision_hash
                AND NOT EXISTS (
                  SELECT 1
                    FROM public_projection_duplicate_operator_decisions next
                   WHERE next.supersedes_decision_id=decision.id
                )
           )
         )
      ))`
    )
    .bind(runId, runId);
}

function proposedIdCollisionPinAssertion(db: D1Database, runId: string) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_assertions (
        expected_changes,actual_changes
      ) SELECT COUNT(*),COALESCE(SUM(CASE WHEN
          component.proposed_public_job_id IS NULL
          OR (
            component.reason_code='new_public_entity'
            AND (
              NOT EXISTS (
                SELECT 1 FROM public_jobs public_job
                 WHERE public_job.id=component.proposed_public_job_id
              )
              OR EXISTS (
                SELECT 1 FROM public_job_allocations allocation
                 WHERE allocation.public_job_id=
                         component.proposed_public_job_id
                   AND allocation.allocation_algorithm_version=?
                   AND allocation.founding_source_position_id=
                         component.founding_source_position_id
                   AND allocation.allocation_hash=component.allocation_hash
              )
            )
          )
          OR (
            component.reason_code='public_job_id_collision'
            AND EXISTS (
              SELECT 1 FROM public_jobs public_job
               WHERE public_job.id=component.proposed_public_job_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM public_job_allocations allocation
               WHERE allocation.public_job_id=component.proposed_public_job_id
                 AND allocation.allocation_algorithm_version=?
                 AND allocation.founding_source_position_id=
                       component.founding_source_position_id
                 AND allocation.allocation_hash=component.allocation_hash
            )
          )
        THEN 1 ELSE 0 END),0)
        FROM public_projection_final_component_work component
       WHERE component.run_id=? AND component.state='sealed'`
    )
    .bind(PUBLIC_JOB_ALLOCATION_VERSION, PUBLIC_JOB_ALLOCATION_VERSION, runId);
}

function assertionStatement(db: D1Database, expectedChanges: number) {
  return db
    .prepare(
      `INSERT INTO public_projection_final_assertions (
        expected_changes,actual_changes
      ) VALUES (?,changes())`
    )
    .bind(expectedChanges);
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

function sealFromRow(row: SealRow): FinalDuplicateSeal {
  return {
    allocationCount: row.allocation_count,
    allocationDigest: row.allocation_digest,
    blockedAllocationCount: row.blocked_allocation_count,
    blockedResolutionCount: row.blocked_resolution_count,
    canonicalLiveInputCount: row.canonical_live_input_count,
    canonicalLiveInputDigest: row.canonical_live_input_digest,
    createdAt: row.created_at,
    duplicateBatchInputHash: row.duplicate_batch_input_hash,
    promotableCount: row.promotable_count,
    relationCount: row.relation_count,
    relationDigest: row.relation_digest,
    resolutionCount: row.resolution_count,
    resolutionDigest: row.resolution_digest,
    resolvedPositionCount: row.resolved_position_count,
    runId: row.run_id,
    sealHash: row.seal_hash,
    sourceMappingInputCount: row.source_mapping_input_count,
    sourceMappingInputDigest: row.source_mapping_input_digest,
  };
}
