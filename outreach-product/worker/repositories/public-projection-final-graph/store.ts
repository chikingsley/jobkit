import { canonicalJson } from "../../services/public-projection/hash";
import {
  assertionStatement,
  operatorDecisionPinAssertion,
  proposedIdCollisionPinAssertion,
  publicRootPinAssertion,
} from "./assertions";
import {
  type FinalGraphStoreInput,
  PUBLIC_DUPLICATE_FINALIZATION_VERSION,
  PUBLIC_JOB_ALLOCATION_VERSION,
} from "./model";
import { readFinalDuplicateSeal } from "./seal";

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
