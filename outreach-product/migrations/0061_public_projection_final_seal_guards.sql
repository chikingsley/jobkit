-- PUBLIC-DATA-001 Phase D3b: final transition, seal, and allocation guards.

CREATE TRIGGER trg_projection_position_final_graph_transition
BEFORE UPDATE OF stage,status,checkpoint_json
  ON public_projection_position_items
WHEN OLD.stage='canonical_resolution' AND NEW.stage='content'
BEGIN
  SELECT CASE WHEN OLD.status<>'queued' OR NEW.status<>'queued'
    OR NOT EXISTS (
      SELECT 1 FROM public_projection_resolution_seals seal
      JOIN public_projection_allocation_members member
        ON member.run_id=seal.run_id
       AND member.position_item_id=seal.position_item_id
       AND member.member_kind='shadow'
      JOIN public_projection_allocation_components allocation
        ON allocation.run_id=member.run_id
       AND allocation.id=member.allocation_id
       WHERE seal.run_id=OLD.run_id AND seal.position_item_id=OLD.id
         AND seal.state='resolved'
         AND member.source_position_id=OLD.source_position_id
         AND member.input_hash=OLD.input_hash
         AND json_extract(NEW.checkpoint_json,
               '$.finalDuplicateGraph.allocationId')=allocation.id
         AND json_extract(NEW.checkpoint_json,
               '$.finalDuplicateGraph.allocationHash')=
             allocation.allocation_hash
         AND json_extract(NEW.checkpoint_json,
               '$.finalDuplicateGraph.state')=allocation.state
         AND json_extract(NEW.checkpoint_json,
               '$.finalDuplicateGraph.reasonCode')=allocation.reason_code
    )
  THEN RAISE(ABORT,'position final duplicate allocation changed') END;
END;

CREATE TRIGGER trg_projection_final_seal_validate
BEFORE INSERT ON public_projection_final_duplicate_seals
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
    JOIN public_projection_duplicate_batches batch ON batch.run_id=run.id
     WHERE run.id=NEW.run_id AND run.mode='shadow'
       AND run.status='running' AND run.selection_complete=1
       AND batch.canonical_identity_state='pending'
       AND batch.input_hash=NEW.duplicate_batch_input_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM public_projection_final_work work
     WHERE work.run_id=NEW.run_id AND work.phase='ready'
       AND work.status='queued'
       AND work.resolution_count=NEW.resolution_count
       AND work.resolution_digest=NEW.resolution_digest
       AND work.canonical_match_count=NEW.canonical_live_input_count
       AND work.canonical_match_digest=NEW.canonical_live_input_digest
       AND work.relation_count=NEW.relation_count
       AND work.relation_digest=NEW.relation_digest
       AND work.component_count=NEW.allocation_count
       AND work.component_digest=NEW.allocation_digest
       AND work.allocation_digest=NEW.allocation_digest
       AND work.source_mapping_count=NEW.source_mapping_input_count
       AND work.source_mapping_digest=NEW.source_mapping_input_digest
  ) THEN RAISE(ABORT,'final duplicate seal boundary changed') END;

  SELECT CASE WHEN NEW.resolution_count<>(
    SELECT COUNT(*) FROM public_projection_duplicate_batch_members member
    JOIN public_projection_resolution_seals seal
      ON seal.run_id=member.run_id
     AND seal.position_item_id=member.position_item_id
     WHERE member.run_id=NEW.run_id
  ) OR NEW.resolution_count<>(
    SELECT COUNT(*) FROM public_projection_duplicate_batch_members member
     WHERE member.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'final duplicate resolution set is incomplete') END;

  SELECT CASE WHEN NEW.resolved_position_count<>(
    SELECT COUNT(*) FROM public_projection_resolution_seals seal
     WHERE seal.run_id=NEW.run_id AND seal.state='resolved'
  ) OR NEW.blocked_resolution_count<>(
    SELECT COUNT(*) FROM public_projection_resolution_seals seal
     WHERE seal.run_id=NEW.run_id AND seal.state<>'resolved'
  ) THEN RAISE(ABORT,'final duplicate resolution counts changed') END;

  SELECT CASE WHEN NEW.relation_count<>(
    SELECT COUNT(*) FROM public_projection_final_duplicate_relations relation
     WHERE relation.run_id=NEW.run_id
  ) OR NEW.allocation_count<>(
    SELECT COUNT(*) FROM public_projection_allocation_components allocation
     WHERE allocation.run_id=NEW.run_id
  ) OR NEW.promotable_count<>(
    SELECT COUNT(*) FROM public_projection_allocation_components allocation
     WHERE allocation.run_id=NEW.run_id AND allocation.state='promotable'
  ) OR NEW.blocked_allocation_count<>(
    SELECT COUNT(*) FROM public_projection_allocation_components allocation
     WHERE allocation.run_id=NEW.run_id AND allocation.state='blocked'
  ) THEN RAISE(ABORT,'final duplicate artifact counts changed') END;

  SELECT CASE WHEN NEW.canonical_live_input_count<>(
    SELECT COUNT(*)
      FROM public_projection_final_canonical_live_inputs input
     WHERE input.run_id=NEW.run_id
  ) OR NEW.source_mapping_input_count<>(
    SELECT COUNT(*)
      FROM public_projection_final_source_mapping_inputs input
     WHERE input.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'final duplicate live input counts changed') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_work work
     WHERE work.run_id=NEW.run_id AND (
       work.resolution_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_resolution_inputs input
          WHERE input.run_id=work.run_id
       )
       OR work.mapping_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_mapping_inputs input
          WHERE input.run_id=work.run_id
       )
       OR work.source_mapping_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_mapping_inputs input
          WHERE input.run_id=work.run_id
            AND input.mapping_state='mapped' AND input.public_job_id IS NOT NULL
       )
       OR work.canonical_request_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_canonical_requests request
          WHERE request.run_id=work.run_id
       )
       OR EXISTS (
         SELECT 1
           FROM public_projection_final_work_canonical_requests request
          WHERE request.run_id=work.run_id
            AND (request.match_complete<>1 OR request.match_digest IS NULL)
       )
       OR work.canonical_match_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_canonical_matches input
          WHERE input.run_id=work.run_id
       )
       OR work.canonical_match_count<>(
         SELECT COALESCE(SUM(request.match_count),0)
           FROM public_projection_final_work_canonical_requests request
          WHERE request.run_id=work.run_id
       )
       OR work.public_root_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_public_roots input
          WHERE input.run_id=work.run_id
       )
       OR work.relation_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_relations relation
          WHERE relation.run_id=work.run_id
       )
       OR work.component_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_component_work component
          WHERE component.run_id=work.run_id AND component.state='sealed'
       )
       OR work.resolution_last_cursor<>COALESCE((
         SELECT json_object(
                  'inputHash',input.input_hash,
                  'positionItemId',input.position_item_id,
                  'sourcePositionId',input.source_position_id
                )
           FROM public_projection_final_work_resolution_inputs input
          WHERE input.run_id=work.run_id ORDER BY input.ordinal DESC LIMIT 1
       ),'')
       OR work.mapping_last_cursor<>COALESCE((
         SELECT input.source_position_id
           FROM public_projection_final_work_mapping_inputs input
          WHERE input.run_id=work.run_id ORDER BY input.ordinal DESC LIMIT 1
       ),'')
       OR work.source_mapping_last_cursor<>COALESCE((
         SELECT input.source_position_id
           FROM public_projection_final_work_mapping_inputs input
          WHERE input.run_id=work.run_id
            AND input.mapping_state='mapped' AND input.public_job_id IS NOT NULL
          ORDER BY input.ordinal DESC LIMIT 1
       ),'')
       OR work.canonical_request_last_cursor<>COALESCE((
         SELECT request.signal_hash
           FROM public_projection_final_work_canonical_requests request
          WHERE request.run_id=work.run_id ORDER BY request.ordinal DESC LIMIT 1
       ),'')
       OR work.canonical_match_last_cursor<>COALESCE((
         SELECT json_object(
                  'publicJobId',input.public_job_id,
                  'publicJobVersion',input.public_job_version,
                  'signalHash',input.signal_hash
                )
           FROM public_projection_final_work_canonical_matches input
          WHERE input.run_id=work.run_id ORDER BY input.ordinal DESC LIMIT 1
       ),'')
       OR work.public_root_last_cursor<>COALESCE((
         SELECT input.originating_public_job_id
           FROM public_projection_final_work_public_roots input
          WHERE input.run_id=work.run_id ORDER BY input.ordinal DESC LIMIT 1
       ),'')
       OR work.relation_last_cursor<>COALESCE((
         SELECT relation.id
           FROM public_projection_final_work_relations relation
          WHERE relation.run_id=work.run_id
          ORDER BY relation.ordinal DESC LIMIT 1
       ),'')
       OR work.component_last_cursor<>COALESCE((
         SELECT component.seed_member_key
           FROM public_projection_final_component_work component
          WHERE component.run_id=work.run_id AND component.state='sealed'
          ORDER BY component.seed_member_key DESC LIMIT 1
       ),'')
     )
  ) THEN RAISE(ABORT,'final duplicate normalized work is incomplete') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_component_work component
     WHERE component.run_id=NEW.run_id AND component.state='sealed' AND (
       component.allocation_id IS NULL
       OR component.allocation_hash IS NULL
       OR component.artifact_hash IS NULL
       OR component.member_digest IS NULL
       OR component.relation_digest IS NULL
       OR component.root_digest IS NULL
       OR component.root_summary_ready<>1
       OR component.root_expected_count IS NULL
       OR component.root_expected_count<>component.root_candidate_count
       OR component.root_count<>component.root_expected_count
       OR component.root_candidate_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_component_root_candidates candidate
          WHERE candidate.run_id=component.run_id
            AND candidate.seed_member_key=component.seed_member_key
       )
       OR component.member_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_component_members member
          WHERE member.run_id=component.run_id
            AND member.seed_member_key=component.seed_member_key
       )
       OR component.member_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_component_frontier frontier
          WHERE frontier.run_id=component.run_id
            AND frontier.seed_member_key=component.seed_member_key
       )
       OR component.root_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_component_roots root
          WHERE root.run_id=component.run_id
            AND root.seed_member_key=component.seed_member_key
       )
       OR component.relation_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_component_relations relation
          WHERE relation.run_id=component.run_id
            AND relation.seed_member_key=component.seed_member_key
       )
       OR component.relation_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_relations relation
          WHERE relation.run_id=component.run_id
            AND (EXISTS (
              SELECT 1
                FROM public_projection_final_component_frontier frontier
               WHERE frontier.run_id=relation.run_id
                 AND frontier.seed_member_key=component.seed_member_key
                 AND frontier.member_key=relation.left_member_key
            ) OR EXISTS (
              SELECT 1
                FROM public_projection_final_component_frontier frontier
               WHERE frontier.run_id=relation.run_id
                 AND frontier.seed_member_key=component.seed_member_key
                 AND frontier.member_key=relation.right_member_key
            ))
       )
       OR component.member_last_cursor<>(
         SELECT COALESCE(MAX(CAST(
           json_extract(member.payload_json,'$.memberKey') AS TEXT
         )), '')
           FROM public_projection_final_work_component_members member
          WHERE member.run_id=component.run_id
            AND member.seed_member_key=component.seed_member_key
       )
       OR component.member_last_cursor<>(
         SELECT COALESCE(MAX(frontier.member_key),'')
           FROM public_projection_final_component_frontier frontier
          WHERE frontier.run_id=component.run_id
            AND frontier.seed_member_key=component.seed_member_key
       )
       OR component.relation_last_cursor<>(
         SELECT COALESCE(MAX(relation.relation_id),'')
           FROM public_projection_final_work_component_relations relation
          WHERE relation.run_id=component.run_id
            AND relation.seed_member_key=component.seed_member_key
       )
       OR component.relation_last_cursor<>(
         SELECT COALESCE(MAX(relation.id),'')
           FROM public_projection_final_work_relations relation
          WHERE relation.run_id=component.run_id
            AND (EXISTS (
              SELECT 1
                FROM public_projection_final_component_frontier frontier
               WHERE frontier.run_id=relation.run_id
                 AND frontier.seed_member_key=component.seed_member_key
                 AND frontier.member_key=relation.left_member_key
            ) OR EXISTS (
              SELECT 1
                FROM public_projection_final_component_frontier frontier
               WHERE frontier.run_id=relation.run_id
                 AND frontier.seed_member_key=component.seed_member_key
                 AND frontier.member_key=relation.right_member_key
            ))
       )
       OR component.root_last_cursor<>(
         SELECT COALESCE(MAX(CAST(
           json_extract(root.payload_json,'$.memberKey') AS TEXT
         )), '')
           FROM public_projection_final_work_component_roots root
          WHERE root.run_id=component.run_id
            AND root.seed_member_key=component.seed_member_key
       )
       OR component.update_last_cursor<>(
         SELECT COALESCE(MAX(input.member_key),'')
           FROM public_projection_final_work_position_updates update_row
           JOIN public_projection_final_work_resolution_inputs input
             ON input.run_id=update_row.run_id
            AND input.position_item_id=update_row.position_item_id
          WHERE update_row.run_id=component.run_id
            AND update_row.seed_member_key=component.seed_member_key
       )
     )
  ) OR NEW.resolved_position_count<>(
    SELECT COUNT(*)
      FROM public_projection_final_work_position_updates update_row
     WHERE update_row.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'final duplicate normalized component is incomplete') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_allocation_components allocation
     WHERE allocation.run_id=NEW.run_id AND (
       allocation.member_count<>(
         SELECT COUNT(*) FROM public_projection_allocation_members member
          WHERE member.run_id=allocation.run_id
            AND member.allocation_id=allocation.id
       )
       OR allocation.relation_count<>(
         SELECT COUNT(*) FROM public_projection_allocation_relations relation
          WHERE relation.run_id=allocation.run_id
            AND relation.allocation_id=allocation.id
       )
       OR allocation.candidate_root_count<>(
         SELECT COUNT(*) FROM public_projection_allocation_roots root
          WHERE root.run_id=allocation.run_id
            AND root.allocation_id=allocation.id
       )
       OR allocation.losing_root_count<>(
         SELECT COUNT(*) FROM public_projection_allocation_roots root
          WHERE root.run_id=allocation.run_id
            AND root.allocation_id=allocation.id AND root.selected=0
       )
     )
  ) THEN RAISE(ABORT,'final duplicate component children changed') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_allocation_components allocation
     WHERE allocation.run_id=NEW.run_id AND (
       (allocation.winning_public_job_id IS NULL AND EXISTS (
         SELECT 1 FROM public_projection_allocation_roots root
          WHERE root.run_id=allocation.run_id
            AND root.allocation_id=allocation.id AND root.selected=1
       ))
       OR (allocation.winning_public_job_id IS NOT NULL AND (
         1<>(
           SELECT COUNT(*) FROM public_projection_allocation_roots root
            WHERE root.run_id=allocation.run_id
              AND root.allocation_id=allocation.id AND root.selected=1
         )
         OR NOT EXISTS (
           SELECT 1 FROM public_projection_allocation_roots root
            WHERE root.run_id=allocation.run_id
              AND root.allocation_id=allocation.id AND root.selected=1
              AND root.public_job_id=allocation.winning_public_job_id
         )
       ))
     )
  ) THEN RAISE(ABORT,'final duplicate selected root changed') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_resolution_seals seal
     WHERE seal.run_id=NEW.run_id AND seal.state='resolved'
       AND NOT EXISTS (
         SELECT 1 FROM public_projection_position_items item
         JOIN public_projection_allocation_members member
           ON member.run_id=item.run_id AND member.position_item_id=item.id
         WHERE item.run_id=seal.run_id
           AND item.id=seal.position_item_id
           AND item.stage='content' AND item.status='queued'
       )
  ) THEN RAISE(ABORT,'resolved position did not reach content') END;
END;

CREATE TRIGGER trg_public_job_allocation_validate
BEFORE INSERT ON public_job_allocations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_allocation_components allocation
     WHERE allocation.run_id=NEW.originating_run_id
       AND allocation.id=NEW.originating_allocation_id
       AND allocation.state='promotable'
       AND allocation.reason_code='new_public_entity'
       AND allocation.proposed_public_job_id=NEW.public_job_id
       AND allocation.founding_source_position_id=
         NEW.founding_source_position_id
       AND allocation.allocation_hash=NEW.allocation_hash
       AND allocation.allocation_algorithm_version=
         NEW.allocation_algorithm_version
  ) THEN RAISE(ABORT,'public job allocation evidence changed') END;
END;
