-- PUBLIC-DATA-001 Phase D3b: immutable final duplicate graph and allocation
-- evidence. Every projection relation in this migration is shadow-only.
-- Live allocation evidence is schema-only until an authorized promotion.

CREATE TABLE public_projection_duplicate_operator_decisions (
  id TEXT PRIMARY KEY CHECK (
    length(id)=73
    AND substr(id,1,9)='pfdec_v1_'
    AND substr(id,10) NOT GLOB '*[^0-9a-f]*'
  ),
  left_member_key TEXT NOT NULL CHECK (trim(left_member_key)<>''),
  right_member_key TEXT NOT NULL CHECK (trim(right_member_key)<>''),
  decision TEXT NOT NULL CHECK (
    decision IN ('same','different','deferred')
  ),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'operator_confirmed_same','operator_confirmed_different',
      'operator_deferred'
    )
  ),
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash)=64),
  supersedes_decision_id TEXT REFERENCES
    public_projection_duplicate_operator_decisions(id) ON DELETE RESTRICT,
  operator_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TEXT NOT NULL,
  decision_hash TEXT NOT NULL UNIQUE CHECK (length(decision_hash)=64),
  created_at TEXT NOT NULL,
  CHECK (left_member_key<right_member_key),
  CHECK (
    (decision='same' AND reason_code='operator_confirmed_same')
    OR (decision='different'
      AND reason_code='operator_confirmed_different')
    OR (decision='deferred' AND reason_code='operator_deferred')
  )
);

CREATE UNIQUE INDEX idx_projection_operator_decision_first
  ON public_projection_duplicate_operator_decisions(
    left_member_key,right_member_key
  ) WHERE supersedes_decision_id IS NULL;

CREATE UNIQUE INDEX idx_projection_operator_decision_successor
  ON public_projection_duplicate_operator_decisions(supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;

CREATE TABLE public_projection_final_duplicate_relations (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  id TEXT NOT NULL CHECK (
    length(id)=73
    AND substr(id,1,9)='pfrel_v1_'
    AND substr(id,10) NOT GLOB '*[^0-9a-f]*'
  ),
  left_member_key TEXT NOT NULL CHECK (trim(left_member_key)<>''),
  left_member_kind TEXT NOT NULL CHECK (
    left_member_kind IN ('shadow','public')
  ),
  left_source_position_id TEXT REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  left_input_hash TEXT CHECK (
    left_input_hash IS NULL OR length(left_input_hash)=64
  ),
  left_public_job_id TEXT REFERENCES public_jobs(id) ON DELETE RESTRICT,
  left_public_job_version INTEGER CHECK (
    left_public_job_version IS NULL OR left_public_job_version>0
  ),
  left_eligibility_decision_version INTEGER CHECK (
    left_eligibility_decision_version IS NULL
    OR left_eligibility_decision_version>0
  ),
  right_member_key TEXT NOT NULL CHECK (trim(right_member_key)<>''),
  right_member_kind TEXT NOT NULL CHECK (
    right_member_kind IN ('shadow','public')
  ),
  right_source_position_id TEXT REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  right_input_hash TEXT CHECK (
    right_input_hash IS NULL OR length(right_input_hash)=64
  ),
  right_public_job_id TEXT REFERENCES public_jobs(id) ON DELETE RESTRICT,
  right_public_job_version INTEGER CHECK (
    right_public_job_version IS NULL OR right_public_job_version>0
  ),
  right_eligibility_decision_version INTEGER CHECK (
    right_eligibility_decision_version IS NULL
    OR right_eligibility_decision_version>0
  ),
  d2_comparison_id TEXT REFERENCES public_projection_duplicate_comparisons(id)
    ON DELETE RESTRICT,
  matching_signals_json TEXT NOT NULL CHECK (
    json_valid(matching_signals_json)
    AND json_type(matching_signals_json)='array'
  ),
  conflicting_signals_json TEXT NOT NULL CHECK (
    json_valid(conflicting_signals_json)
    AND json_type(conflicting_signals_json)='array'
  ),
  operator_decision_id TEXT REFERENCES
    public_projection_duplicate_operator_decisions(id) ON DELETE RESTRICT,
  relation TEXT NOT NULL CHECK (
    relation IN ('same','different','ambiguous')
  ),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'same_source_position','same_source_reference_position',
      'same_employer_requisition','operator_confirmed_same',
      'same_listing_distinct_position','conflicting_stable_identifier',
      'conflicting_canonical_facts','operator_confirmed_different',
      'canonical_identity_only','duplicate_evidence_conflict',
      'operator_deferred'
    )
  ),
  finalization_algorithm_version TEXT NOT NULL CHECK (
    finalization_algorithm_version='public-duplicate-finalization-v1'
  ),
  relation_hash TEXT NOT NULL CHECK (length(relation_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,id),
  UNIQUE (run_id,left_member_key,right_member_key),
  FOREIGN KEY (left_public_job_id,left_public_job_version)
    REFERENCES public_job_versions(public_job_id,version) ON DELETE RESTRICT,
  FOREIGN KEY (left_public_job_id,left_eligibility_decision_version)
    REFERENCES public_job_eligibility_decisions(public_job_id,decision_version)
    ON DELETE RESTRICT,
  FOREIGN KEY (right_public_job_id,right_public_job_version)
    REFERENCES public_job_versions(public_job_id,version) ON DELETE RESTRICT,
  FOREIGN KEY (right_public_job_id,right_eligibility_decision_version)
    REFERENCES public_job_eligibility_decisions(public_job_id,decision_version)
    ON DELETE RESTRICT,
  CHECK (left_member_key<right_member_key),
  CHECK (
    (left_member_kind='shadow'
      AND left_source_position_id IS NOT NULL
      AND left_input_hash IS NOT NULL
      AND left_member_key='shadow:' || left_source_position_id || ':' ||
        left_input_hash
      AND left_public_job_id IS NULL
      AND left_public_job_version IS NULL
      AND left_eligibility_decision_version IS NULL)
    OR (left_member_kind='public'
      AND left_source_position_id IS NULL
      AND left_input_hash IS NULL
      AND left_public_job_id IS NOT NULL
      AND left_public_job_version IS NOT NULL
      AND left_eligibility_decision_version IS NOT NULL
      AND left_member_key='public:' || left_public_job_id || ':' ||
        left_public_job_version || ':' || left_eligibility_decision_version)
  ),
  CHECK (
    (right_member_kind='shadow'
      AND right_source_position_id IS NOT NULL
      AND right_input_hash IS NOT NULL
      AND right_member_key='shadow:' || right_source_position_id || ':' ||
        right_input_hash
      AND right_public_job_id IS NULL
      AND right_public_job_version IS NULL
      AND right_eligibility_decision_version IS NULL)
    OR (right_member_kind='public'
      AND right_source_position_id IS NULL
      AND right_input_hash IS NULL
      AND right_public_job_id IS NOT NULL
      AND right_public_job_version IS NOT NULL
      AND right_eligibility_decision_version IS NOT NULL
      AND right_member_key='public:' || right_public_job_id || ':' ||
        right_public_job_version || ':' || right_eligibility_decision_version)
  ),
  CHECK (
    (relation='same' AND reason_code IN (
      'same_source_position','same_source_reference_position',
      'same_employer_requisition','operator_confirmed_same'
    ))
    OR (relation='different' AND reason_code IN (
      'same_listing_distinct_position','conflicting_stable_identifier',
      'conflicting_canonical_facts','operator_confirmed_different'
    ))
    OR (relation='ambiguous' AND reason_code IN (
      'canonical_identity_only','duplicate_evidence_conflict',
      'operator_deferred'
    ))
  )
);

CREATE INDEX idx_projection_final_relation_left
  ON public_projection_final_duplicate_relations(run_id,left_member_key,id);
CREATE INDEX idx_projection_final_relation_right
  ON public_projection_final_duplicate_relations(run_id,right_member_key,id);

CREATE TABLE public_projection_allocation_components (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  id TEXT NOT NULL CHECK (
    length(id)=74
    AND substr(id,1,10)='palloc_v1_'
    AND substr(id,11) NOT GLOB '*[^0-9a-f]*'
  ),
  finalization_algorithm_version TEXT NOT NULL CHECK (
    finalization_algorithm_version='public-duplicate-finalization-v1'
  ),
  allocation_algorithm_version TEXT NOT NULL CHECK (
    allocation_algorithm_version='public-job-allocation-v1'
  ),
  member_count INTEGER NOT NULL CHECK (member_count>0),
  relation_count INTEGER NOT NULL CHECK (relation_count>=0),
  candidate_root_count INTEGER NOT NULL CHECK (candidate_root_count>=0),
  founding_source_position_id TEXT REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  proposed_public_job_id TEXT,
  winning_public_job_id TEXT REFERENCES public_jobs(id) ON DELETE RESTRICT,
  losing_root_count INTEGER NOT NULL CHECK (losing_root_count>=0),
  state TEXT NOT NULL CHECK (state IN ('promotable','blocked')),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'new_public_entity','existing_source_mapping',
      'existing_duplicate_winner','public_identity_ambiguous',
      'public_job_id_collision','promotion_component_too_large'
    )
  ),
  allocation_hash TEXT NOT NULL CHECK (length(allocation_hash)=64),
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,id),
  CHECK (
    (state='promotable' AND reason_code='new_public_entity'
      AND founding_source_position_id IS NOT NULL
      AND proposed_public_job_id IS NOT NULL
      AND winning_public_job_id IS NULL
      AND candidate_root_count=0 AND losing_root_count=0)
    OR (state='promotable'
      AND reason_code IN (
        'existing_source_mapping','existing_duplicate_winner'
      )
      AND proposed_public_job_id IS NULL
      AND winning_public_job_id IS NOT NULL
      AND candidate_root_count>=1
      AND losing_root_count=candidate_root_count-1)
    OR (state='blocked' AND reason_code='public_identity_ambiguous'
      AND proposed_public_job_id IS NULL
      AND winning_public_job_id IS NULL
      AND losing_root_count=candidate_root_count)
    OR (state='blocked' AND reason_code='public_job_id_collision'
      AND founding_source_position_id IS NOT NULL
      AND proposed_public_job_id IS NOT NULL
      AND winning_public_job_id IS NULL
      AND candidate_root_count=0 AND losing_root_count=0)
    OR (state='blocked' AND reason_code='promotion_component_too_large'
      AND member_count>25
      AND founding_source_position_id IS NOT NULL
      AND proposed_public_job_id IS NULL
      AND winning_public_job_id IS NULL
      AND losing_root_count=candidate_root_count)
  )
);

CREATE TABLE public_projection_allocation_members (
  run_id TEXT NOT NULL,
  allocation_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  member_key TEXT NOT NULL CHECK (trim(member_key)<>''),
  member_kind TEXT NOT NULL CHECK (member_kind IN ('shadow','public')),
  position_item_id TEXT,
  source_position_id TEXT REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  input_hash TEXT CHECK (input_hash IS NULL OR length(input_hash)=64),
  public_job_id TEXT REFERENCES public_jobs(id) ON DELETE RESTRICT,
  public_job_version INTEGER CHECK (
    public_job_version IS NULL OR public_job_version>0
  ),
  eligibility_decision_version INTEGER CHECK (
    eligibility_decision_version IS NULL OR eligibility_decision_version>0
  ),
  member_hash TEXT NOT NULL CHECK (length(member_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,allocation_id,ordinal),
  UNIQUE (run_id,allocation_id,member_key),
  FOREIGN KEY (run_id,allocation_id)
    REFERENCES public_projection_allocation_components(run_id,id)
    ON DELETE RESTRICT,
  FOREIGN KEY (position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version) ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,eligibility_decision_version)
    REFERENCES public_job_eligibility_decisions(public_job_id,decision_version)
    ON DELETE RESTRICT,
  CHECK (
    (member_kind='shadow' AND position_item_id IS NOT NULL
      AND source_position_id IS NOT NULL AND input_hash IS NOT NULL
      AND public_job_id IS NULL AND public_job_version IS NULL
      AND eligibility_decision_version IS NULL)
    OR (member_kind='public' AND position_item_id IS NULL
      AND source_position_id IS NULL AND input_hash IS NULL
      AND public_job_id IS NOT NULL AND public_job_version IS NOT NULL
      AND eligibility_decision_version IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_projection_allocation_member_key
  ON public_projection_allocation_members(run_id,member_key);

CREATE TABLE public_projection_allocation_roots (
  run_id TEXT NOT NULL,
  allocation_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  member_key TEXT NOT NULL CHECK (trim(member_key)<>''),
  public_job_id TEXT NOT NULL REFERENCES public_jobs(id) ON DELETE RESTRICT,
  public_job_version INTEGER NOT NULL CHECK (public_job_version>0),
  eligibility_decision_version INTEGER NOT NULL CHECK (
    eligibility_decision_version>0
  ),
  served_publicly INTEGER NOT NULL CHECK (served_publicly IN (0,1)),
  first_published_at TEXT,
  public_job_created_at TEXT NOT NULL,
  founding_source_position_id TEXT REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  selected INTEGER NOT NULL CHECK (selected IN (0,1)),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'existing_source_mapping','existing_duplicate_winner',
      'merged_into_existing_winner','public_identity_ambiguous',
      'promotion_component_too_large'
    )
  ),
  root_hash TEXT NOT NULL CHECK (length(root_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,allocation_id,ordinal),
  UNIQUE (run_id,allocation_id,member_key),
  UNIQUE (run_id,allocation_id,public_job_id),
  FOREIGN KEY (run_id,allocation_id)
    REFERENCES public_projection_allocation_components(run_id,id)
    ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version) ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,eligibility_decision_version)
    REFERENCES public_job_eligibility_decisions(public_job_id,decision_version)
    ON DELETE RESTRICT,
  CHECK (
    (served_publicly=0 AND first_published_at IS NULL)
    OR (served_publicly=1 AND first_published_at IS NOT NULL)
  ),
  CHECK (
    member_key='public:' || public_job_id || ':' || public_job_version || ':' ||
      eligibility_decision_version
  ),
  CHECK (
    (selected=1 AND reason_code IN (
      'existing_source_mapping','existing_duplicate_winner'
    ))
    OR (selected=0 AND reason_code IN (
      'merged_into_existing_winner','public_identity_ambiguous',
      'promotion_component_too_large'
    ))
  )
);

CREATE TABLE public_projection_allocation_relations (
  run_id TEXT NOT NULL,
  allocation_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  relation_id TEXT NOT NULL,
  relation_hash TEXT NOT NULL CHECK (length(relation_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,allocation_id,ordinal),
  UNIQUE (run_id,allocation_id,relation_id),
  FOREIGN KEY (run_id,allocation_id)
    REFERENCES public_projection_allocation_components(run_id,id)
    ON DELETE RESTRICT,
  FOREIGN KEY (run_id,relation_id)
    REFERENCES public_projection_final_duplicate_relations(run_id,id)
    ON DELETE RESTRICT
);

CREATE TABLE public_projection_final_canonical_live_inputs (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  public_job_id TEXT NOT NULL REFERENCES public_jobs(id) ON DELETE RESTRICT,
  public_job_version INTEGER NOT NULL CHECK (public_job_version>0),
  signal_kind TEXT NOT NULL CHECK (signal_kind='canonical_identity_v1'),
  signal_hash TEXT NOT NULL CHECK (length(signal_hash)=64),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (
    run_id,public_job_id,public_job_version,signal_kind,signal_hash
  ),
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version) ON DELETE RESTRICT
);

CREATE TABLE public_projection_final_source_mapping_inputs (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  source_position_id TEXT NOT NULL REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  mapping_version INTEGER NOT NULL CHECK (mapping_version>0),
  public_job_id TEXT NOT NULL REFERENCES public_jobs(id) ON DELETE RESTRICT,
  mapping_hash TEXT NOT NULL CHECK (length(mapping_hash)=64),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,source_position_id),
  FOREIGN KEY (source_position_id,mapping_version)
    REFERENCES job_source_position_mapping_versions(source_position_id,version)
    ON DELETE RESTRICT
);
