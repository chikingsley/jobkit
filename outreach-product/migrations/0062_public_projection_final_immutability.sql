-- PUBLIC-DATA-001 Phase D3b: append-only final graph enforcement.

-- Every finalized shadow row and live allocation row is append-only.
CREATE TRIGGER trg_projection_operator_decision_immutable_update
BEFORE UPDATE ON public_projection_duplicate_operator_decisions
BEGIN SELECT RAISE(ABORT,'final duplicate decisions are immutable'); END;
CREATE TRIGGER trg_projection_operator_decision_immutable_delete
BEFORE DELETE ON public_projection_duplicate_operator_decisions
BEGIN SELECT RAISE(ABORT,'final duplicate decisions are append-only'); END;
CREATE TRIGGER trg_projection_final_relation_immutable_update
BEFORE UPDATE ON public_projection_final_duplicate_relations
BEGIN SELECT RAISE(ABORT,'final duplicate relations are immutable'); END;
CREATE TRIGGER trg_projection_final_relation_immutable_delete
BEFORE DELETE ON public_projection_final_duplicate_relations
BEGIN SELECT RAISE(ABORT,'final duplicate relations are append-only'); END;
CREATE TRIGGER trg_projection_allocation_component_immutable_update
BEFORE UPDATE ON public_projection_allocation_components
BEGIN SELECT RAISE(ABORT,'allocation components are immutable'); END;
CREATE TRIGGER trg_projection_allocation_component_immutable_delete
BEFORE DELETE ON public_projection_allocation_components
BEGIN SELECT RAISE(ABORT,'allocation components are append-only'); END;
CREATE TRIGGER trg_projection_allocation_member_immutable_update
BEFORE UPDATE ON public_projection_allocation_members
BEGIN SELECT RAISE(ABORT,'allocation members are immutable'); END;
CREATE TRIGGER trg_projection_allocation_member_immutable_delete
BEFORE DELETE ON public_projection_allocation_members
BEGIN SELECT RAISE(ABORT,'allocation members are append-only'); END;
CREATE TRIGGER trg_projection_allocation_root_immutable_update
BEFORE UPDATE ON public_projection_allocation_roots
BEGIN SELECT RAISE(ABORT,'allocation roots are immutable'); END;
CREATE TRIGGER trg_projection_allocation_root_immutable_delete
BEFORE DELETE ON public_projection_allocation_roots
BEGIN SELECT RAISE(ABORT,'allocation roots are append-only'); END;
CREATE TRIGGER trg_projection_allocation_relation_immutable_update
BEFORE UPDATE ON public_projection_allocation_relations
BEGIN SELECT RAISE(ABORT,'allocation relations are immutable'); END;
CREATE TRIGGER trg_projection_allocation_relation_immutable_delete
BEFORE DELETE ON public_projection_allocation_relations
BEGIN SELECT RAISE(ABORT,'allocation relations are append-only'); END;
CREATE TRIGGER trg_projection_final_seal_immutable_update
BEFORE UPDATE ON public_projection_final_duplicate_seals
BEGIN SELECT RAISE(ABORT,'final duplicate seals are immutable'); END;
CREATE TRIGGER trg_projection_final_seal_immutable_delete
BEFORE DELETE ON public_projection_final_duplicate_seals
BEGIN SELECT RAISE(ABORT,'final duplicate seals are append-only'); END;
CREATE TRIGGER trg_projection_final_canonical_live_input_immutable_update
BEFORE UPDATE ON public_projection_final_canonical_live_inputs
BEGIN SELECT RAISE(ABORT,'canonical live inputs are immutable'); END;
CREATE TRIGGER trg_projection_final_canonical_live_input_immutable_delete
BEFORE DELETE ON public_projection_final_canonical_live_inputs
BEGIN SELECT RAISE(ABORT,'canonical live inputs are append-only'); END;
CREATE TRIGGER trg_projection_final_source_mapping_input_immutable_update
BEFORE UPDATE ON public_projection_final_source_mapping_inputs
BEGIN SELECT RAISE(ABORT,'source mapping inputs are immutable'); END;
CREATE TRIGGER trg_projection_final_source_mapping_input_immutable_delete
BEFORE DELETE ON public_projection_final_source_mapping_inputs
BEGIN SELECT RAISE(ABORT,'source mapping inputs are append-only'); END;
CREATE TRIGGER trg_public_job_allocation_immutable_update
BEFORE UPDATE ON public_job_allocations
BEGIN SELECT RAISE(ABORT,'public job allocations are immutable'); END;
CREATE TRIGGER trg_public_job_allocation_immutable_delete
BEFORE DELETE ON public_job_allocations
BEGIN SELECT RAISE(ABORT,'public job allocations are append-only'); END;

CREATE TRIGGER trg_projection_final_work_resolution_input_immutable_update
BEFORE UPDATE ON public_projection_final_work_resolution_inputs
BEGIN SELECT RAISE(ABORT,'D3 resolution inputs are immutable'); END;
CREATE TRIGGER trg_projection_final_work_resolution_input_immutable_delete
BEFORE DELETE ON public_projection_final_work_resolution_inputs
BEGIN SELECT RAISE(ABORT,'D3 resolution inputs are append-only'); END;
CREATE TRIGGER trg_projection_final_work_mapping_input_immutable_update
BEFORE UPDATE ON public_projection_final_work_mapping_inputs
BEGIN SELECT RAISE(ABORT,'D3 mapping inputs are immutable'); END;
CREATE TRIGGER trg_projection_final_work_mapping_input_immutable_delete
BEFORE DELETE ON public_projection_final_work_mapping_inputs
BEGIN SELECT RAISE(ABORT,'D3 mapping inputs are append-only'); END;
CREATE TRIGGER trg_projection_final_work_canonical_request_validate_update
BEFORE UPDATE ON public_projection_final_work_canonical_requests
BEGIN
  SELECT CASE WHEN OLD.match_complete=1
    OR NEW.run_id<>OLD.run_id OR NEW.ordinal<>OLD.ordinal
    OR NEW.signal_hash<>OLD.signal_hash OR NEW.request_hash<>OLD.request_hash
    OR NEW.encoded_bytes<>OLD.encoded_bytes OR NEW.created_at<>OLD.created_at
    OR NEW.match_count<OLD.match_count OR NEW.match_digest IS NULL
    OR (NEW.match_count>0 AND NEW.match_cursor='')
  THEN RAISE(ABORT,'D3 canonical request update is invalid') END;
END;
CREATE TRIGGER trg_projection_final_work_canonical_request_immutable_delete
BEFORE DELETE ON public_projection_final_work_canonical_requests
BEGIN SELECT RAISE(ABORT,'D3 canonical requests are append-only'); END;
CREATE TRIGGER trg_projection_final_work_canonical_match_immutable_update
BEFORE UPDATE ON public_projection_final_work_canonical_matches
BEGIN SELECT RAISE(ABORT,'D3 canonical matches are immutable'); END;
CREATE TRIGGER trg_projection_final_work_canonical_match_immutable_delete
BEFORE DELETE ON public_projection_final_work_canonical_matches
BEGIN SELECT RAISE(ABORT,'D3 canonical matches are append-only'); END;
CREATE TRIGGER trg_projection_final_work_canonical_member_immutable_update
BEFORE UPDATE ON public_projection_final_work_canonical_members
BEGIN SELECT RAISE(ABORT,'D3 canonical members are immutable'); END;
CREATE TRIGGER trg_projection_final_work_canonical_member_immutable_delete
BEFORE DELETE ON public_projection_final_work_canonical_members
BEGIN SELECT RAISE(ABORT,'D3 canonical members are append-only'); END;
CREATE TRIGGER trg_projection_final_work_public_root_immutable_update
BEFORE UPDATE ON public_projection_final_work_public_roots
BEGIN SELECT RAISE(ABORT,'D3 public roots are immutable'); END;
CREATE TRIGGER trg_projection_final_work_public_root_immutable_delete
BEFORE DELETE ON public_projection_final_work_public_roots
BEGIN SELECT RAISE(ABORT,'D3 public roots are append-only'); END;
CREATE TRIGGER trg_projection_final_work_relation_immutable_update
BEFORE UPDATE ON public_projection_final_work_relations
BEGIN SELECT RAISE(ABORT,'D3 relation inputs are immutable'); END;
CREATE TRIGGER trg_projection_final_work_relation_immutable_delete
BEFORE DELETE ON public_projection_final_work_relations
BEGIN SELECT RAISE(ABORT,'D3 relation inputs are append-only'); END;
CREATE TRIGGER trg_projection_final_work_component_member_immutable_update
BEFORE UPDATE ON public_projection_final_work_component_members
BEGIN SELECT RAISE(ABORT,'D3 component members are immutable'); END;
CREATE TRIGGER trg_projection_final_work_component_member_immutable_delete
BEFORE DELETE ON public_projection_final_work_component_members
BEGIN SELECT RAISE(ABORT,'D3 component members are append-only'); END;
CREATE TRIGGER trg_projection_final_work_component_root_immutable_update
BEFORE UPDATE ON public_projection_final_work_component_roots
BEGIN SELECT RAISE(ABORT,'D3 component roots are immutable'); END;
CREATE TRIGGER trg_projection_final_work_component_root_immutable_delete
BEFORE DELETE ON public_projection_final_work_component_roots
BEGIN SELECT RAISE(ABORT,'D3 component roots are append-only'); END;
CREATE TRIGGER trg_projection_final_work_component_relation_immutable_update
BEFORE UPDATE ON public_projection_final_work_component_relations
BEGIN SELECT RAISE(ABORT,'D3 component relations are immutable'); END;
CREATE TRIGGER trg_projection_final_work_component_relation_immutable_delete
BEFORE DELETE ON public_projection_final_work_component_relations
BEGIN SELECT RAISE(ABORT,'D3 component relations are append-only'); END;
CREATE TRIGGER trg_projection_final_component_root_candidate_immutable_update
BEFORE UPDATE ON public_projection_final_component_root_candidates
BEGIN SELECT RAISE(ABORT,'D3 component root candidates are immutable'); END;
CREATE TRIGGER trg_projection_final_component_root_candidate_immutable_delete
BEFORE DELETE ON public_projection_final_component_root_candidates
BEGIN SELECT RAISE(ABORT,'D3 component root candidates are append-only'); END;
CREATE TRIGGER trg_projection_final_work_position_update_immutable_update
BEFORE UPDATE ON public_projection_final_work_position_updates
BEGIN SELECT RAISE(ABORT,'D3 position updates are immutable'); END;
CREATE TRIGGER trg_projection_final_work_position_update_immutable_delete
BEFORE DELETE ON public_projection_final_work_position_updates
BEGIN SELECT RAISE(ABORT,'D3 position updates are append-only'); END;
