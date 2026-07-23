-- PUBLIC-DATA-001 Phase D3b: live evidence and immutable-input guards.

-- Live ownership evidence. Shadow finalization only reads this table while
-- authorized promotion owns every insert.
CREATE TABLE public_job_allocations (
  public_job_id TEXT PRIMARY KEY REFERENCES public_jobs(id)
    ON DELETE RESTRICT,
  allocation_algorithm_version TEXT NOT NULL CHECK (
    allocation_algorithm_version='public-job-allocation-v1'
  ),
  founding_source_position_id TEXT NOT NULL REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  allocation_hash TEXT NOT NULL CHECK (length(allocation_hash)=64),
  originating_run_id TEXT NOT NULL,
  originating_allocation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (originating_run_id,originating_allocation_id)
    REFERENCES public_projection_allocation_components(run_id,id)
    ON DELETE RESTRICT
);

CREATE TABLE public_projection_final_assertions (
  expected_changes INTEGER NOT NULL CHECK (expected_changes>=0),
  actual_changes INTEGER NOT NULL,
  CHECK (expected_changes=actual_changes)
);

CREATE TRIGGER trg_projection_final_assertion_consume
AFTER INSERT ON public_projection_final_assertions
BEGIN
  DELETE FROM public_projection_final_assertions WHERE rowid=NEW.rowid;
END;

CREATE TRIGGER trg_projection_operator_decision_validate
BEFORE INSERT ON public_projection_duplicate_operator_decisions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users
     WHERE id=NEW.operator_user_id AND role='operator'
  ) THEN RAISE(ABORT,'final duplicate decision requires an operator') END;

  SELECT CASE WHEN NEW.supersedes_decision_id IS NULL AND EXISTS (
    SELECT 1 FROM public_projection_duplicate_operator_decisions prior
     WHERE prior.left_member_key=NEW.left_member_key
       AND prior.right_member_key=NEW.right_member_key
  ) THEN RAISE(ABORT,'final duplicate decision requires its predecessor') END;

  SELECT CASE WHEN NEW.supersedes_decision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_operator_decisions prior
     WHERE prior.id=NEW.supersedes_decision_id
       AND prior.left_member_key=NEW.left_member_key
       AND prior.right_member_key=NEW.right_member_key
  ) THEN RAISE(ABORT,'final duplicate decision predecessor changed') END;

  SELECT CASE WHEN NEW.supersedes_decision_id IS NOT NULL AND (
    NEW.decision='deferred' OR NOT EXISTS (
      SELECT 1 FROM public_projection_duplicate_operator_decisions prior
       WHERE prior.id=NEW.supersedes_decision_id
         AND prior.decision='deferred'
    )
  ) THEN RAISE(ABORT,'final duplicate decision resolution is invalid') END;
END;

CREATE TRIGGER trg_projection_final_relation_validate
BEFORE INSERT ON public_projection_final_duplicate_relations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
    JOIN public_projection_duplicate_batches batch ON batch.run_id=run.id
     WHERE run.id=NEW.run_id AND run.mode='shadow'
       AND run.status='running' AND run.selection_complete=1
       AND batch.canonical_identity_state='pending'
  ) OR EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'final duplicate relation boundary is unavailable') END;

  SELECT CASE WHEN NEW.d2_comparison_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_comparisons comparison
     WHERE comparison.id=NEW.d2_comparison_id
       AND comparison.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'final duplicate D2 reference changed') END;

  SELECT CASE WHEN NEW.operator_decision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_operator_decisions decision
     WHERE decision.id=NEW.operator_decision_id
       AND decision.left_member_key=NEW.left_member_key
       AND decision.right_member_key=NEW.right_member_key
       AND (
         (decision.decision='same' AND NEW.relation='same'
           AND NEW.reason_code='operator_confirmed_same')
         OR (decision.decision='different' AND NEW.relation='different'
           AND NEW.reason_code='operator_confirmed_different')
         OR (decision.decision='deferred' AND NEW.relation='ambiguous'
           AND NEW.reason_code='operator_deferred')
       )
  ) THEN RAISE(ABORT,'final duplicate operator decision changed') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_final_work_relations work
     WHERE work.run_id=NEW.run_id AND work.id=NEW.id
       AND work.relation_hash=NEW.relation_hash
       AND work.operator_terminal=1
       AND (
         (
           work.operator_decision_id IS NULL
           AND NEW.operator_decision_id IS NULL
           AND (
             NEW.relation<>'ambiguous' OR NOT EXISTS (
               SELECT 1
                 FROM public_projection_duplicate_operator_decisions decision
                WHERE decision.left_member_key=NEW.left_member_key
                  AND decision.right_member_key=NEW.right_member_key
                  AND NOT EXISTS (
                    SELECT 1
                      FROM public_projection_duplicate_operator_decisions next
                     WHERE next.supersedes_decision_id=decision.id
                  )
             )
           )
         )
         OR (
           work.operator_decision_id=NEW.operator_decision_id
           AND work.operator_decision_hash=(
             SELECT decision.decision_hash
               FROM public_projection_duplicate_operator_decisions decision
              WHERE decision.id=NEW.operator_decision_id
           )
           AND NOT EXISTS (
             SELECT 1
               FROM public_projection_duplicate_operator_decisions next
              WHERE next.supersedes_decision_id=NEW.operator_decision_id
           )
         )
       )
  ) THEN RAISE(ABORT,'final duplicate relation work pin changed') END;

  SELECT CASE WHEN NEW.left_member_kind='shadow' AND NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_batch_members member
    JOIN public_projection_resolution_seals seal
      ON seal.run_id=member.run_id
     AND seal.position_item_id=member.position_item_id
     WHERE member.run_id=NEW.run_id
       AND member.source_position_id=NEW.left_source_position_id
       AND member.input_hash=NEW.left_input_hash
       AND seal.state='resolved'
  ) THEN RAISE(ABORT,'final duplicate left shadow member changed') END;

  SELECT CASE WHEN NEW.right_member_kind='shadow' AND NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_batch_members member
    JOIN public_projection_resolution_seals seal
      ON seal.run_id=member.run_id
     AND seal.position_item_id=member.position_item_id
     WHERE member.run_id=NEW.run_id
       AND member.source_position_id=NEW.right_source_position_id
       AND member.input_hash=NEW.right_input_hash
       AND seal.state='resolved'
  ) THEN RAISE(ABORT,'final duplicate right shadow member changed') END;

  SELECT CASE WHEN NEW.left_member_kind='public' AND NOT EXISTS (
    SELECT 1 FROM public_job_heads job_head
    JOIN public_job_eligibility_heads eligibility_head
      ON eligibility_head.public_job_id=job_head.public_job_id
     WHERE job_head.public_job_id=NEW.left_public_job_id
       AND job_head.current_version=NEW.left_public_job_version
       AND eligibility_head.current_decision_version=
         NEW.left_eligibility_decision_version
  ) THEN RAISE(ABORT,'final duplicate left public member changed') END;

  SELECT CASE WHEN NEW.right_member_kind='public' AND NOT EXISTS (
    SELECT 1 FROM public_job_heads job_head
    JOIN public_job_eligibility_heads eligibility_head
      ON eligibility_head.public_job_id=job_head.public_job_id
     WHERE job_head.public_job_id=NEW.right_public_job_id
       AND job_head.current_version=NEW.right_public_job_version
       AND eligibility_head.current_decision_version=
         NEW.right_eligibility_decision_version
  ) THEN RAISE(ABORT,'final duplicate right public member changed') END;
END;

CREATE TRIGGER trg_projection_allocation_component_validate
BEFORE INSERT ON public_projection_allocation_components
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
    JOIN public_projection_duplicate_batches batch ON batch.run_id=run.id
     WHERE run.id=NEW.run_id AND run.mode='shadow'
       AND run.status='running' AND run.selection_complete=1
       AND batch.canonical_identity_state='pending'
  ) OR EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'allocation component boundary is unavailable') END;
END;

CREATE TRIGGER trg_projection_allocation_member_validate
BEFORE INSERT ON public_projection_allocation_members
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'allocation member boundary is sealed') END;

  SELECT CASE WHEN NEW.member_kind='shadow' AND (
    NEW.member_key<>'shadow:' || NEW.source_position_id || ':' || NEW.input_hash
    OR NOT EXISTS (
      SELECT 1 FROM public_projection_duplicate_batch_members member
      JOIN public_projection_resolution_seals seal
        ON seal.run_id=member.run_id
       AND seal.position_item_id=member.position_item_id
       WHERE member.run_id=NEW.run_id
         AND member.position_item_id=NEW.position_item_id
         AND member.source_position_id=NEW.source_position_id
         AND member.input_hash=NEW.input_hash AND seal.state='resolved'
    )
  ) THEN RAISE(ABORT,'allocation shadow member changed') END;

  SELECT CASE WHEN NEW.member_kind='public' AND (
    NEW.member_key<>'public:' || NEW.public_job_id || ':' ||
      NEW.public_job_version || ':' || NEW.eligibility_decision_version
    OR NOT EXISTS (
      SELECT 1 FROM public_job_heads job_head
      JOIN public_job_eligibility_heads eligibility_head
        ON eligibility_head.public_job_id=job_head.public_job_id
       WHERE job_head.public_job_id=NEW.public_job_id
         AND job_head.current_version=NEW.public_job_version
         AND eligibility_head.current_decision_version=
           NEW.eligibility_decision_version
    )
  ) THEN RAISE(ABORT,'allocation public member changed') END;
END;

CREATE TRIGGER trg_projection_allocation_relation_validate
BEFORE INSERT ON public_projection_allocation_relations
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'allocation relation boundary is sealed') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_relations relation
     WHERE relation.run_id=NEW.run_id AND relation.id=NEW.relation_id
       AND relation.relation_hash=NEW.relation_hash
       AND (
         EXISTS (
           SELECT 1 FROM public_projection_allocation_members member
            WHERE member.run_id=NEW.run_id
              AND member.allocation_id=NEW.allocation_id
              AND member.member_key=relation.left_member_key
         )
         OR EXISTS (
           SELECT 1 FROM public_projection_allocation_members member
            WHERE member.run_id=NEW.run_id
              AND member.allocation_id=NEW.allocation_id
              AND member.member_key=relation.right_member_key
         )
       )
  ) THEN RAISE(ABORT,'allocation relation does not touch its component') END;
END;

CREATE TRIGGER trg_projection_allocation_root_validate
BEFORE INSERT ON public_projection_allocation_roots
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'allocation root boundary is sealed') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_job_heads job_head
    JOIN public_job_eligibility_heads eligibility_head
      ON eligibility_head.public_job_id=job_head.public_job_id
     WHERE job_head.public_job_id=NEW.public_job_id
       AND job_head.current_version=NEW.public_job_version
       AND eligibility_head.current_decision_version=
         NEW.eligibility_decision_version
  ) THEN RAISE(ABORT,'allocation public root changed') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_allocation_members member
     WHERE member.run_id=NEW.run_id
       AND member.allocation_id=NEW.allocation_id
       AND member.member_kind='public'
       AND member.member_key=NEW.member_key
  ) AND NOT EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_relations relation
     WHERE relation.run_id=NEW.run_id AND relation.relation<>'different'
       AND (
         (relation.left_member_key=NEW.member_key AND EXISTS (
           SELECT 1 FROM public_projection_allocation_members member
            WHERE member.run_id=NEW.run_id
              AND member.allocation_id=NEW.allocation_id
              AND member.member_key=relation.right_member_key
         ))
         OR (relation.right_member_key=NEW.member_key AND EXISTS (
           SELECT 1 FROM public_projection_allocation_members member
            WHERE member.run_id=NEW.run_id
              AND member.allocation_id=NEW.allocation_id
              AND member.member_key=relation.left_member_key
         ))
       )
  ) THEN RAISE(ABORT,'allocation root does not touch its component') END;
END;

CREATE TRIGGER trg_projection_final_canonical_live_input_validate
BEFORE INSERT ON public_projection_final_canonical_live_inputs
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
     WHERE run.id=NEW.run_id AND run.status='running' AND run.mode='shadow'
  ) THEN RAISE(ABORT,'canonical live input boundary is unavailable') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_job_identity_signals signal
    JOIN public_job_heads head ON head.public_job_id=signal.public_job_id
     WHERE signal.public_job_id=NEW.public_job_id
       AND signal.public_job_version=NEW.public_job_version
       AND signal.signal_kind=NEW.signal_kind
       AND signal.signal_hash=NEW.signal_hash
       AND head.current_version=NEW.public_job_version
  ) THEN RAISE(ABORT,'canonical live input snapshot changed') END;
END;

CREATE TRIGGER trg_projection_final_source_mapping_input_validate
BEFORE INSERT ON public_projection_final_source_mapping_inputs
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
     WHERE run.id=NEW.run_id AND run.status='running' AND run.mode='shadow'
  ) THEN RAISE(ABORT,'source mapping input boundary is unavailable') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM job_source_position_mapping_heads head
    JOIN job_source_position_mapping_versions mapping
      ON mapping.source_position_id=head.source_position_id
     AND mapping.version=head.current_version
     WHERE head.source_position_id=NEW.source_position_id
       AND head.current_version=NEW.mapping_version
       AND mapping.mapping_state='mapped'
       AND mapping.public_job_id=NEW.public_job_id
       AND mapping.mapping_hash=NEW.mapping_hash
  ) THEN RAISE(ABORT,'source mapping input snapshot changed') END;
END;
