-- PUBLIC-DATA-001 Phase D3b: component work, artifacts, and the final seal.

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
