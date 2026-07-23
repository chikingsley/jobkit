-- PUBLIC-DATA-001 Phase D3b: durable final-work inputs and relation paging.

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
