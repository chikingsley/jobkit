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

-- D3 is a serial, leased, phase-paged pipeline. The controller contains only
-- bounded cursors and streaming evidence totals; normalized work rows carry
-- the immutable inputs and artifacts used by the final seal fence.
CREATE TABLE public_projection_final_work (
  run_id TEXT PRIMARY KEY REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  input_digest TEXT NOT NULL CHECK (length(input_digest)=64),
  phase TEXT NOT NULL CHECK (phase IN (
    'resolution_inputs','mapping_inputs','canonical_requests',
    'canonical_matches','public_roots','relations','components',
    'allocation_digest','ready','sealed'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'queued','processing','sealed','failed','superseded'
  )),
  phase_cursor TEXT NOT NULL DEFAULT '',
  phase_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (phase_ordinal>=0),
  active_component_seed TEXT,
  resolution_count INTEGER NOT NULL DEFAULT 0 CHECK (resolution_count>=0),
  resolution_bytes INTEGER NOT NULL DEFAULT 0 CHECK (resolution_bytes>=0),
  resolution_digest TEXT CHECK (
    resolution_digest IS NULL OR length(resolution_digest)=64
  ),
  resolution_last_cursor TEXT NOT NULL DEFAULT '',
  mapping_count INTEGER NOT NULL DEFAULT 0 CHECK (mapping_count>=0),
  mapping_bytes INTEGER NOT NULL DEFAULT 0 CHECK (mapping_bytes>=0),
  mapping_digest TEXT CHECK (
    mapping_digest IS NULL OR length(mapping_digest)=64
  ),
  mapping_last_cursor TEXT NOT NULL DEFAULT '',
  source_mapping_count INTEGER NOT NULL DEFAULT 0 CHECK (
    source_mapping_count>=0
  ),
  source_mapping_digest TEXT CHECK (
    source_mapping_digest IS NULL OR length(source_mapping_digest)=64
  ),
  source_mapping_last_cursor TEXT NOT NULL DEFAULT '',
  canonical_request_count INTEGER NOT NULL DEFAULT 0 CHECK (
    canonical_request_count>=0
  ),
  canonical_request_bytes INTEGER NOT NULL DEFAULT 0 CHECK (
    canonical_request_bytes>=0
  ),
  canonical_request_digest TEXT CHECK (
    canonical_request_digest IS NULL OR length(canonical_request_digest)=64
  ),
  canonical_request_last_cursor TEXT NOT NULL DEFAULT '',
  canonical_match_count INTEGER NOT NULL DEFAULT 0 CHECK (
    canonical_match_count>=0
  ),
  canonical_match_bytes INTEGER NOT NULL DEFAULT 0 CHECK (
    canonical_match_bytes>=0
  ),
  canonical_match_digest TEXT CHECK (
    canonical_match_digest IS NULL OR length(canonical_match_digest)=64
  ),
  canonical_match_last_cursor TEXT NOT NULL DEFAULT '',
  public_root_count INTEGER NOT NULL DEFAULT 0 CHECK (public_root_count>=0),
  public_root_bytes INTEGER NOT NULL DEFAULT 0 CHECK (public_root_bytes>=0),
  public_root_digest TEXT CHECK (
    public_root_digest IS NULL OR length(public_root_digest)=64
  ),
  public_root_last_cursor TEXT NOT NULL DEFAULT '',
  relation_count INTEGER NOT NULL DEFAULT 0 CHECK (relation_count>=0),
  relation_bytes INTEGER NOT NULL DEFAULT 0 CHECK (relation_bytes>=0),
  relation_digest TEXT CHECK (
    relation_digest IS NULL OR length(relation_digest)=64
  ),
  relation_last_cursor TEXT NOT NULL DEFAULT '',
  component_count INTEGER NOT NULL DEFAULT 0 CHECK (component_count>=0),
  component_bytes INTEGER NOT NULL DEFAULT 0 CHECK (component_bytes>=0),
  component_digest TEXT CHECK (
    component_digest IS NULL OR length(component_digest)=64
  ),
  component_last_cursor TEXT NOT NULL DEFAULT '',
  allocation_bytes INTEGER NOT NULL DEFAULT 0 CHECK (allocation_bytes>=0),
  allocation_digest TEXT CHECK (
    allocation_digest IS NULL OR length(allocation_digest)=64
  ),
  lease_token TEXT,
  lease_expires_at TEXT,
  lease_epoch INTEGER NOT NULL DEFAULT 0 CHECK (lease_epoch>=0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  last_error_code TEXT,
  last_error_message TEXT,
  frozen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (status='processing' AND lease_token IS NOT NULL
      AND trim(lease_token)<>'' AND lease_expires_at IS NOT NULL
      AND trim(lease_expires_at)<>'')
    OR (status<>'processing' AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK ((phase='sealed')=(status='sealed'))
);

CREATE TABLE public_projection_final_work_resolution_inputs (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  position_item_id TEXT NOT NULL,
  source_position_id TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  checkpoint_json TEXT NOT NULL CHECK (
    json_valid(checkpoint_json) AND json_type(checkpoint_json)='object'
  ),
  resolution_state TEXT NOT NULL CHECK (
    resolution_state IN ('ambiguous','blocked','resolved','unresolved')
  ),
  resolution_reason_code TEXT NOT NULL,
  resolution_seal_hash TEXT NOT NULL CHECK (length(resolution_seal_hash)=64),
  canonical_signal_hash TEXT CHECK (
    canonical_signal_hash IS NULL OR length(canonical_signal_hash)=64
  ),
  member_key TEXT,
  member_hash TEXT CHECK (member_hash IS NULL OR length(member_hash)=64),
  row_hash TEXT NOT NULL CHECK (length(row_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,position_item_id),
  UNIQUE (run_id,ordinal),
  UNIQUE (run_id,source_position_id,input_hash)
);

CREATE TABLE public_projection_final_work_mapping_inputs (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  source_position_id TEXT NOT NULL,
  head_present INTEGER NOT NULL CHECK (head_present IN (0,1)),
  mapping_state TEXT NOT NULL CHECK (
    mapping_state IN ('absent','mapped','unmapped')
  ),
  mapping_version INTEGER CHECK (mapping_version IS NULL OR mapping_version>0),
  public_job_id TEXT,
  mapping_hash TEXT CHECK (mapping_hash IS NULL OR length(mapping_hash)=64),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  row_hash TEXT NOT NULL CHECK (length(row_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,source_position_id),
  UNIQUE (run_id,ordinal),
  CHECK (
    (mapping_state='absent' AND head_present=0
      AND mapping_version IS NULL AND public_job_id IS NULL
      AND mapping_hash IS NULL)
    OR (mapping_state='mapped' AND head_present=1
      AND mapping_version IS NOT NULL AND public_job_id IS NOT NULL
      AND mapping_hash IS NOT NULL)
    OR (mapping_state='unmapped' AND head_present=1
      AND mapping_version IS NOT NULL AND public_job_id IS NULL
      AND mapping_hash IS NOT NULL)
  )
);

CREATE INDEX idx_projection_final_resolution_relation_lookup
  ON public_projection_final_work_resolution_inputs(
    run_id,resolution_state,canonical_signal_hash,member_key,position_item_id
  );

CREATE INDEX idx_projection_final_resolution_source_page
  ON public_projection_final_work_resolution_inputs(
    run_id,source_position_id
  ) WHERE resolution_state='resolved';

CREATE INDEX idx_projection_final_member_snapshot_page
  ON public_projection_duplicate_batch_members(
    run_id,source_position_id,input_hash,position_item_id
  );

CREATE TABLE public_projection_final_work_canonical_requests (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  signal_hash TEXT NOT NULL CHECK (length(signal_hash)=64),
  match_count INTEGER NOT NULL DEFAULT 0 CHECK (match_count>=0),
  match_digest TEXT CHECK (match_digest IS NULL OR length(match_digest)=64),
  match_cursor TEXT NOT NULL DEFAULT '',
  match_complete INTEGER NOT NULL DEFAULT 0 CHECK (match_complete IN (0,1)),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,signal_hash),
  UNIQUE (run_id,ordinal),
  CHECK (match_complete=0 OR match_digest IS NOT NULL)
);

CREATE TABLE public_projection_final_work_canonical_matches (
  run_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  signal_hash TEXT NOT NULL,
  public_job_id TEXT NOT NULL,
  public_job_version INTEGER NOT NULL CHECK (public_job_version>0),
  signal_kind TEXT NOT NULL CHECK (signal_kind='canonical_identity_v1'),
  public_member_key TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  row_hash TEXT NOT NULL CHECK (length(row_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,signal_hash,public_job_id,public_job_version),
  UNIQUE (run_id,ordinal),
  FOREIGN KEY (run_id,signal_hash)
    REFERENCES public_projection_final_work_canonical_requests(run_id,signal_hash)
    ON DELETE RESTRICT
);

CREATE INDEX idx_projection_final_canonical_match_member_page
  ON public_projection_final_work_canonical_matches(
    run_id,public_member_key,signal_hash,public_job_id,public_job_version
  );

CREATE INDEX idx_projection_final_canonical_match_public_page
  ON public_projection_final_work_canonical_matches(
    run_id,public_job_id,public_job_version,signal_hash
  );

CREATE TABLE public_projection_final_work_canonical_members (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  public_member_key TEXT NOT NULL,
  signal_hash TEXT NOT NULL CHECK (length(signal_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,public_member_key,signal_hash)
);

CREATE INDEX idx_projection_final_canonical_member_page
  ON public_projection_final_work_canonical_members(
    run_id,public_member_key,signal_hash
  );

CREATE TABLE public_projection_final_work_public_roots (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  originating_public_job_id TEXT NOT NULL,
  redirect_root_id TEXT NOT NULL,
  public_member_key TEXT NOT NULL,
  redirect_path_json TEXT NOT NULL CHECK (
    json_valid(redirect_path_json) AND json_type(redirect_path_json)='array'
  ),
  public_job_version INTEGER NOT NULL CHECK (public_job_version>0),
  eligibility_decision_version INTEGER NOT NULL CHECK (
    eligibility_decision_version>0
  ),
  public_job_created_at TEXT NOT NULL,
  served_publicly INTEGER NOT NULL CHECK (served_publicly IN (0,1)),
  first_published_at TEXT,
  founding_source_position_id TEXT,
  allocation_hash TEXT CHECK (allocation_hash IS NULL OR length(allocation_hash)=64),
  content_head_hash TEXT NOT NULL CHECK (length(content_head_hash)=64),
  redirect_path_hash TEXT NOT NULL CHECK (length(redirect_path_hash)=64),
  history_hash TEXT NOT NULL CHECK (length(history_hash)=64),
  allocation_input_hash TEXT NOT NULL CHECK (length(allocation_input_hash)=64),
  row_hash TEXT NOT NULL CHECK (length(row_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,originating_public_job_id),
  UNIQUE (run_id,ordinal)
);

CREATE INDEX idx_projection_final_public_root_member_page
  ON public_projection_final_work_public_roots(
    run_id,public_member_key,originating_public_job_id
  );

CREATE INDEX idx_projection_final_mapping_public_page
  ON public_projection_final_work_mapping_inputs(
    run_id,mapping_state,public_job_id
  );

CREATE INDEX idx_public_job_canonical_signal_page
  ON public_job_identity_signals(
    signal_kind,signal_hash,public_job_id,public_job_version
  );

CREATE INDEX idx_projection_final_d2_public_page
  ON public_projection_duplicate_comparisons(
    run_id,target_kind,target_public_job_id
  ) WHERE target_kind='existing_public';

CREATE TABLE public_projection_final_work_relations (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  id TEXT NOT NULL,
  left_member_key TEXT NOT NULL,
  right_member_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json) AND json_type(payload_json)='object'
  ),
  operator_decision_id TEXT,
  operator_decision_hash TEXT CHECK (
    operator_decision_hash IS NULL OR length(operator_decision_hash)=64
  ),
  operator_terminal INTEGER NOT NULL CHECK (operator_terminal IN (0,1)),
  relation TEXT NOT NULL CHECK (relation IN ('same','different','ambiguous')),
  relation_hash TEXT NOT NULL CHECK (length(relation_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,id),
  UNIQUE (run_id,ordinal),
  UNIQUE (run_id,left_member_key,right_member_key),
  CHECK (left_member_key<right_member_key)
);

CREATE TABLE public_projection_final_component_work (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  seed_member_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'expanding','members','roots','relations','updates','sealed'
  )),
  child_cursor TEXT NOT NULL DEFAULT '',
  member_count INTEGER NOT NULL DEFAULT 0 CHECK (member_count>=0),
  relation_count INTEGER NOT NULL DEFAULT 0 CHECK (relation_count>=0),
  root_count INTEGER NOT NULL DEFAULT 0 CHECK (root_count>=0),
  root_candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (
    root_candidate_count>=0
  ),
  root_expected_count INTEGER CHECK (
    root_expected_count IS NULL OR root_expected_count>=0
  ),
  root_summary_ready INTEGER NOT NULL DEFAULT 0 CHECK (
    root_summary_ready IN (0,1)
  ),
  oversized INTEGER NOT NULL DEFAULT 0 CHECK (oversized IN (0,1)),
  ambiguous INTEGER NOT NULL DEFAULT 0 CHECK (ambiguous IN (0,1)),
  source_mapped_winner INTEGER NOT NULL DEFAULT 0 CHECK (
    source_mapped_winner IN (0,1)
  ),
  member_digest TEXT CHECK (member_digest IS NULL OR length(member_digest)=64),
  member_last_cursor TEXT NOT NULL DEFAULT '',
  relation_digest TEXT CHECK (
    relation_digest IS NULL OR length(relation_digest)=64
  ),
  relation_last_cursor TEXT NOT NULL DEFAULT '',
  root_digest TEXT CHECK (root_digest IS NULL OR length(root_digest)=64),
  root_last_cursor TEXT NOT NULL DEFAULT '',
  update_last_cursor TEXT NOT NULL DEFAULT '',
  allocation_id TEXT,
  allocation_hash TEXT CHECK (allocation_hash IS NULL OR length(allocation_hash)=64),
  artifact_hash TEXT CHECK (artifact_hash IS NULL OR length(artifact_hash)=64),
  founding_source_position_id TEXT,
  proposed_public_job_id TEXT,
  winning_public_job_id TEXT,
  losing_root_count INTEGER CHECK (
    losing_root_count IS NULL OR losing_root_count>=0
  ),
  allocation_state TEXT CHECK (
    allocation_state IS NULL OR allocation_state IN ('promotable','blocked')
  ),
  reason_code TEXT,
  encoded_bytes INTEGER NOT NULL DEFAULT 0 CHECK (encoded_bytes>=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key)
);

CREATE TABLE public_projection_final_component_frontier (
  run_id TEXT NOT NULL,
  seed_member_key TEXT NOT NULL,
  member_key TEXT NOT NULL,
  expanded INTEGER NOT NULL DEFAULT 0 CHECK (expanded IN (0,1)),
  left_edge_cursor TEXT NOT NULL DEFAULT '',
  right_edge_cursor TEXT NOT NULL DEFAULT '',
  ordinal INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key,member_key),
  UNIQUE (run_id,member_key),
  FOREIGN KEY (run_id,seed_member_key)
    REFERENCES public_projection_final_component_work(run_id,seed_member_key)
    ON DELETE RESTRICT
);

CREATE TABLE public_projection_final_work_component_members (
  run_id TEXT NOT NULL,
  seed_member_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json) AND json_type(payload_json)='object'
  ),
  member_hash TEXT NOT NULL CHECK (length(member_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key,ordinal),
  UNIQUE (run_id,seed_member_key,member_hash),
  FOREIGN KEY (run_id,seed_member_key)
    REFERENCES public_projection_final_component_work(run_id,seed_member_key)
    ON DELETE RESTRICT
);

CREATE TABLE public_projection_final_work_component_roots (
  run_id TEXT NOT NULL,
  seed_member_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json) AND json_type(payload_json)='object'
  ),
  root_hash TEXT NOT NULL CHECK (length(root_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key,ordinal),
  FOREIGN KEY (run_id,seed_member_key)
    REFERENCES public_projection_final_component_work(run_id,seed_member_key)
    ON DELETE RESTRICT
);

CREATE TABLE public_projection_final_work_component_relations (
  run_id TEXT NOT NULL,
  seed_member_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  relation_id TEXT NOT NULL,
  relation_hash TEXT NOT NULL CHECK (length(relation_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key,ordinal),
  UNIQUE (run_id,seed_member_key,relation_id),
  FOREIGN KEY (run_id,seed_member_key)
    REFERENCES public_projection_final_component_work(run_id,seed_member_key)
    ON DELETE RESTRICT
);

CREATE TABLE public_projection_final_component_root_candidates (
  run_id TEXT NOT NULL,
  seed_member_key TEXT NOT NULL,
  member_key TEXT NOT NULL,
  originating_public_job_id TEXT NOT NULL,
  served_publicly INTEGER NOT NULL CHECK (served_publicly IN (0,1)),
  published_missing_rank INTEGER NOT NULL CHECK (
    published_missing_rank IN (0,1)
  ),
  first_published_sort TEXT NOT NULL,
  public_job_created_at TEXT NOT NULL,
  redirect_root_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key,member_key),
  FOREIGN KEY (run_id,seed_member_key)
    REFERENCES public_projection_final_component_work(run_id,seed_member_key)
    ON DELETE RESTRICT,
  FOREIGN KEY (run_id,originating_public_job_id)
    REFERENCES public_projection_final_work_public_roots(
      run_id,originating_public_job_id
    )
    ON DELETE RESTRICT
);

CREATE INDEX idx_projection_final_component_root_winner
  ON public_projection_final_component_root_candidates(
    run_id,seed_member_key,served_publicly DESC,published_missing_rank,
    first_published_sort,public_job_created_at,redirect_root_id,member_key
  );

CREATE TRIGGER trg_projection_final_component_root_candidate_phase
BEFORE INSERT ON public_projection_final_component_root_candidates
WHEN NOT EXISTS (
  SELECT 1 FROM public_projection_final_component_work component
   WHERE component.run_id=NEW.run_id
     AND component.seed_member_key=NEW.seed_member_key
     AND component.state IN ('members','relations')
     AND component.root_summary_ready=0
)
BEGIN SELECT RAISE(ABORT,'D3 component root candidates are closed'); END;

CREATE TRIGGER trg_projection_final_component_root_candidate_count
AFTER INSERT ON public_projection_final_component_root_candidates
BEGIN
  UPDATE public_projection_final_component_work
     SET root_candidate_count=root_candidate_count+1
   WHERE run_id=NEW.run_id AND seed_member_key=NEW.seed_member_key;
END;

CREATE INDEX idx_projection_final_relations_left_page
  ON public_projection_final_work_relations(
    run_id,relation,left_member_key,right_member_key,id
  );

CREATE INDEX idx_projection_final_relations_right_page
  ON public_projection_final_work_relations(
    run_id,relation,right_member_key,left_member_key,id
  );

CREATE INDEX idx_projection_final_relations_run_id_page
  ON public_projection_final_work_relations(run_id,id);

CREATE INDEX idx_projection_final_relations_left_component_page
  ON public_projection_final_work_relations(run_id,left_member_key,id);

CREATE INDEX idx_projection_final_relations_right_component_page
  ON public_projection_final_work_relations(run_id,right_member_key,id);

CREATE TABLE public_projection_final_work_position_updates (
  run_id TEXT NOT NULL,
  seed_member_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  position_item_id TEXT NOT NULL,
  source_position_id TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  checkpoint_json TEXT NOT NULL CHECK (
    json_valid(checkpoint_json) AND json_type(checkpoint_json)='object'
  ),
  row_hash TEXT NOT NULL CHECK (length(row_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key,ordinal),
  UNIQUE (run_id,position_item_id),
  FOREIGN KEY (run_id,seed_member_key)
    REFERENCES public_projection_final_component_work(run_id,seed_member_key)
    ON DELETE RESTRICT
);

CREATE TABLE public_projection_final_duplicate_seals (
  run_id TEXT PRIMARY KEY REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  duplicate_batch_input_hash TEXT NOT NULL CHECK (
    length(duplicate_batch_input_hash)=64
  ),
  resolution_digest TEXT NOT NULL CHECK (length(resolution_digest)=64),
  relation_digest TEXT NOT NULL CHECK (length(relation_digest)=64),
  allocation_digest TEXT NOT NULL CHECK (length(allocation_digest)=64),
  resolution_count INTEGER NOT NULL CHECK (resolution_count>=0),
  resolved_position_count INTEGER NOT NULL CHECK (
    resolved_position_count>=0
  ),
  blocked_resolution_count INTEGER NOT NULL CHECK (
    blocked_resolution_count>=0
  ),
  canonical_live_input_count INTEGER NOT NULL CHECK (
    canonical_live_input_count>=0
  ),
  canonical_live_input_digest TEXT NOT NULL CHECK (
    length(canonical_live_input_digest)=64
  ),
  source_mapping_input_count INTEGER NOT NULL CHECK (
    source_mapping_input_count>=0
  ),
  source_mapping_input_digest TEXT NOT NULL CHECK (
    length(source_mapping_input_digest)=64
  ),
  relation_count INTEGER NOT NULL CHECK (relation_count>=0),
  allocation_count INTEGER NOT NULL CHECK (allocation_count>=0),
  promotable_count INTEGER NOT NULL CHECK (promotable_count>=0),
  blocked_allocation_count INTEGER NOT NULL CHECK (
    blocked_allocation_count>=0
  ),
  finalization_algorithm_version TEXT NOT NULL CHECK (
    finalization_algorithm_version='public-duplicate-finalization-v1'
  ),
  allocation_algorithm_version TEXT NOT NULL CHECK (
    allocation_algorithm_version='public-job-allocation-v1'
  ),
  seal_hash TEXT NOT NULL CHECK (length(seal_hash)=64),
  created_at TEXT NOT NULL,
  CHECK (resolution_count=resolved_position_count+blocked_resolution_count),
  CHECK (allocation_count=promotable_count+blocked_allocation_count)
);

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
