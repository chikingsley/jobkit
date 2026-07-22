-- PUBLIC-DATA-001 Phase C: shadow-only projection operations.
-- These tables checkpoint private projection work. They grant no publication
-- authority and insert no rows into the Phase-B public entity graph.

CREATE TABLE public_projection_runs (
  id TEXT PRIMARY KEY,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode='shadow'),
  request_key TEXT NOT NULL UNIQUE CHECK (trim(request_key)<>''),
  scope_json TEXT NOT NULL CHECK (
    json_valid(scope_json) AND json_type(scope_json)='object'
  ),
  contract_version INTEGER NOT NULL CHECK (contract_version>0),
  projector_version TEXT NOT NULL CHECK (trim(projector_version)<>''),
  policy_heads_hash TEXT NOT NULL CHECK (length(policy_heads_hash)=64),
  source_watermark_json TEXT NOT NULL CHECK (
    json_valid(source_watermark_json)
    AND json_type(source_watermark_json)='object'
  ),
  status TEXT NOT NULL CHECK (
    status IN (
      'queued','running','completed','completed_with_blocks','failed',
      'canceled'
    )
  ),
  listing_total INTEGER NOT NULL DEFAULT 0 CHECK (listing_total>=0),
  listing_completed INTEGER NOT NULL DEFAULT 0 CHECK (listing_completed>=0),
  listing_blocked INTEGER NOT NULL DEFAULT 0 CHECK (listing_blocked>=0),
  listing_failed INTEGER NOT NULL DEFAULT 0 CHECK (listing_failed>=0),
  listing_superseded INTEGER NOT NULL DEFAULT 0 CHECK (
    listing_superseded>=0
  ),
  position_total INTEGER NOT NULL DEFAULT 0 CHECK (position_total>=0),
  position_completed INTEGER NOT NULL DEFAULT 0 CHECK (position_completed>=0),
  position_blocked INTEGER NOT NULL DEFAULT 0 CHECK (position_blocked>=0),
  position_failed INTEGER NOT NULL DEFAULT 0 CHECK (position_failed>=0),
  position_superseded INTEGER NOT NULL DEFAULT 0 CHECK (
    position_superseded>=0
  ),
  selection_cursor TEXT NOT NULL DEFAULT '',
  selection_complete INTEGER NOT NULL DEFAULT 0 CHECK (
    selection_complete IN (0,1)
  ),
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (
    listing_completed+listing_blocked+listing_failed+listing_superseded
      <=listing_total
  ),
  CHECK (
    position_completed+position_blocked+position_failed+position_superseded
      <=position_total
  ),
  CHECK (
    status NOT IN ('completed','completed_with_blocks','failed','canceled')
    OR completed_at IS NOT NULL
  ),
  CHECK (status<>'running' OR started_at IS NOT NULL)
);

CREATE TABLE public_projection_listing_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  listing_id TEXT NOT NULL,
  material_version INTEGER NOT NULL CHECK (material_version>0),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  stage TEXT NOT NULL CHECK (
    stage IN ('selected','prerequisites','source_positions','completed')
  ),
  status TEXT NOT NULL CHECK (
    status IN (
      'queued','processing','waiting_analysis','blocked','completed','failed',
      'superseded'
    )
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts>0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(checkpoint_json) AND json_type(checkpoint_json)='object'
  ),
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id,listing_id,material_version),
  UNIQUE (id,run_id),
  FOREIGN KEY (listing_id,material_version)
    REFERENCES job_listing_versions(listing_id,material_version)
    ON DELETE RESTRICT,
  CHECK (attempt_count<=max_attempts),
  CHECK (
    (status='processing'
      AND lease_owner IS NOT NULL
      AND trim(lease_owner)<>''
      AND lease_token IS NOT NULL
      AND trim(lease_token)<>''
      AND lease_expires_at IS NOT NULL
      AND trim(lease_expires_at)<>''
      AND attempt_count>0)
    OR (status<>'processing'
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK (status<>'completed' OR stage='completed'),
  CHECK (
    status NOT IN ('blocked','completed','failed','superseded')
    OR completed_at IS NOT NULL
  ),
  CHECK (
    status NOT IN ('blocked','failed','superseded') OR trim(error_code)<>''
  )
);

CREATE TABLE public_projection_position_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  listing_item_id TEXT NOT NULL,
  source_position_id TEXT NOT NULL REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  stage TEXT NOT NULL CHECK (
    stage IN (
      'identity','canonical_resolution','content','eligibility','completed'
    )
  ),
  status TEXT NOT NULL CHECK (
    status IN (
      'queued','processing','waiting_analysis','blocked','completed','failed',
      'superseded'
    )
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts>0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  public_job_id TEXT REFERENCES public_jobs(id) ON DELETE RESTRICT,
  simulated_browse_eligible INTEGER NOT NULL DEFAULT 0 CHECK (
    simulated_browse_eligible IN (0,1)
  ),
  simulated_organic_eligible INTEGER NOT NULL DEFAULT 0 CHECK (
    simulated_organic_eligible IN (0,1)
  ),
  simulated_job_posting_eligible INTEGER NOT NULL DEFAULT 0 CHECK (
    simulated_job_posting_eligible IN (0,1)
  ),
  readiness_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(readiness_json) AND json_type(readiness_json)='object'
  ),
  reason_codes_json TEXT NOT NULL DEFAULT '["shadow_mode"]' CHECK (
    json_valid(reason_codes_json)
    AND json_type(reason_codes_json)='array'
    AND json_array_length(reason_codes_json)>0
  ),
  checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(checkpoint_json) AND json_type(checkpoint_json)='object'
  ),
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id,source_position_id),
  UNIQUE (id,run_id),
  FOREIGN KEY (listing_item_id,run_id)
    REFERENCES public_projection_listing_items(id,run_id)
    ON DELETE RESTRICT,
  CHECK (attempt_count<=max_attempts),
  CHECK (
    simulated_job_posting_eligible<=simulated_organic_eligible
  ),
  CHECK (simulated_organic_eligible<=simulated_browse_eligible),
  CHECK (
    (status='processing'
      AND lease_owner IS NOT NULL
      AND trim(lease_owner)<>''
      AND lease_token IS NOT NULL
      AND trim(lease_token)<>''
      AND lease_expires_at IS NOT NULL
      AND trim(lease_expires_at)<>''
      AND attempt_count>0)
    OR (status<>'processing'
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK (status<>'completed' OR stage='completed'),
  CHECK (
    status NOT IN ('blocked','completed','failed','superseded')
    OR completed_at IS NOT NULL
  ),
  CHECK (
    status NOT IN ('blocked','failed','superseded') OR trim(error_code)<>''
  )
);

CREATE TABLE public_projection_duplicate_candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  position_item_id TEXT NOT NULL,
  candidate_public_job_id TEXT NOT NULL,
  candidate_public_job_version INTEGER NOT NULL CHECK (
    candidate_public_job_version>0
  ),
  retrieval_algorithm_version TEXT NOT NULL CHECK (
    trim(retrieval_algorithm_version)<>''
  ),
  signals_json TEXT NOT NULL CHECK (
    json_valid(signals_json)
    AND json_type(signals_json)='array'
    AND json_array_length(signals_json)>0
  ),
  codex_recommendation TEXT CHECK (
    codex_recommendation IS NULL
    OR codex_recommendation IN ('same','different','unclear')
  ),
  agent_task_run_id TEXT REFERENCES agent_task_runs(id) ON DELETE RESTRICT,
  operator_decision TEXT NOT NULL DEFAULT 'pending' CHECK (
    operator_decision IN ('pending','same','different','deferred')
  ),
  operator_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  operator_decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (position_item_id,candidate_public_job_id),
  FOREIGN KEY (position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (candidate_public_job_id,candidate_public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT,
  CHECK (
    codex_recommendation IS NULL OR agent_task_run_id IS NOT NULL
  ),
  CHECK (
    (operator_decision='pending'
      AND operator_user_id IS NULL
      AND operator_decided_at IS NULL)
    OR (operator_decision<>'pending'
      AND operator_user_id IS NOT NULL
      AND operator_decided_at IS NOT NULL)
  )
);

CREATE TABLE public_job_identity_signals (
  public_job_id TEXT NOT NULL,
  public_job_version INTEGER NOT NULL CHECK (public_job_version>0),
  signal_kind TEXT NOT NULL CHECK (
    signal_kind IN (
      'canonical_identity_v1','material_clone_v1','source_reference_v1'
    )
  ),
  signal_hash TEXT NOT NULL CHECK (length(signal_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (
    public_job_id,public_job_version,signal_kind,signal_hash
  ),
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT
);

CREATE INDEX idx_public_projection_runs_status
  ON public_projection_runs(status,requested_at);
CREATE INDEX idx_public_projection_listing_claim
  ON public_projection_listing_items(status,stage,updated_at);
CREATE INDEX idx_public_projection_position_claim
  ON public_projection_position_items(status,stage,updated_at);
CREATE INDEX idx_public_projection_duplicates_review
  ON public_projection_duplicate_candidates(operator_decision,created_at);
CREATE INDEX idx_public_job_identity_signal_lookup
  ON public_job_identity_signals(signal_kind,signal_hash);

-- Run request envelopes are idempotent snapshots. Counters and checkpoints
-- advance in place while status follows one bounded execution lifecycle.
CREATE TRIGGER trg_public_projection_run_update_guard
BEFORE UPDATE ON public_projection_runs
BEGIN
  SELECT CASE WHEN
    OLD.status IN ('completed','completed_with_blocks','failed','canceled')
    AND (
      NEW.status IS NOT OLD.status
      OR NEW.listing_total IS NOT OLD.listing_total
      OR NEW.listing_completed IS NOT OLD.listing_completed
      OR NEW.listing_blocked IS NOT OLD.listing_blocked
      OR NEW.listing_failed IS NOT OLD.listing_failed
      OR NEW.listing_superseded IS NOT OLD.listing_superseded
      OR NEW.position_total IS NOT OLD.position_total
      OR NEW.position_completed IS NOT OLD.position_completed
      OR NEW.position_blocked IS NOT OLD.position_blocked
      OR NEW.position_failed IS NOT OLD.position_failed
      OR NEW.position_superseded IS NOT OLD.position_superseded
      OR NEW.selection_cursor IS NOT OLD.selection_cursor
      OR NEW.selection_complete IS NOT OLD.selection_complete
      OR NEW.error_code IS NOT OLD.error_code
      OR NEW.error_detail IS NOT OLD.error_detail
      OR NEW.started_at IS NOT OLD.started_at
      OR NEW.completed_at IS NOT OLD.completed_at
      OR NEW.updated_at IS NOT OLD.updated_at
    )
  THEN RAISE(ABORT,'terminal projection run is immutable') END;

  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.requested_by_user_id IS NOT OLD.requested_by_user_id
    OR NEW.mode IS NOT OLD.mode
    OR NEW.request_key IS NOT OLD.request_key
    OR NEW.scope_json IS NOT OLD.scope_json
    OR NEW.contract_version IS NOT OLD.contract_version
    OR NEW.projector_version IS NOT OLD.projector_version
    OR NEW.policy_heads_hash IS NOT OLD.policy_heads_hash
    OR NEW.source_watermark_json IS NOT OLD.source_watermark_json
    OR NEW.requested_at IS NOT OLD.requested_at
  THEN RAISE(ABORT,'projection run request snapshot is immutable') END;

  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('running','failed','canceled'))
    OR (OLD.status='running' AND NEW.status IN (
      'completed','completed_with_blocks','failed','canceled'
    ))
  ) THEN RAISE(ABORT,'invalid projection run status transition') END;

  SELECT CASE WHEN
    NEW.listing_total<OLD.listing_total
    OR NEW.listing_completed<OLD.listing_completed
    OR NEW.listing_blocked<OLD.listing_blocked
    OR NEW.listing_failed<OLD.listing_failed
    OR NEW.listing_superseded<OLD.listing_superseded
    OR NEW.position_total<OLD.position_total
    OR NEW.position_completed<OLD.position_completed
    OR NEW.position_blocked<OLD.position_blocked
    OR NEW.position_failed<OLD.position_failed
    OR NEW.position_superseded<OLD.position_superseded
    OR NEW.selection_complete<OLD.selection_complete
  THEN RAISE(ABORT,'projection run progress cannot move backward') END;
END;

CREATE TRIGGER trg_public_projection_listing_update_guard
BEFORE UPDATE ON public_projection_listing_items
BEGIN
  SELECT CASE WHEN
    OLD.status IN ('completed','superseded')
    AND (
      NEW.stage IS NOT OLD.stage
      OR NEW.status IS NOT OLD.status
      OR NEW.attempt_count IS NOT OLD.attempt_count
      OR NEW.lease_owner IS NOT OLD.lease_owner
      OR NEW.lease_token IS NOT OLD.lease_token
      OR NEW.lease_expires_at IS NOT OLD.lease_expires_at
      OR NEW.checkpoint_json IS NOT OLD.checkpoint_json
      OR NEW.error_code IS NOT OLD.error_code
      OR NEW.error_detail IS NOT OLD.error_detail
      OR NEW.started_at IS NOT OLD.started_at
      OR NEW.completed_at IS NOT OLD.completed_at
      OR NEW.updated_at IS NOT OLD.updated_at
    )
  THEN RAISE(ABORT,'terminal projection listing is immutable') END;

  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.run_id IS NOT OLD.run_id
    OR NEW.listing_id IS NOT OLD.listing_id
    OR NEW.material_version IS NOT OLD.material_version
    OR NEW.input_hash IS NOT OLD.input_hash
    OR NEW.max_attempts IS NOT OLD.max_attempts
    OR NEW.created_at IS NOT OLD.created_at
  THEN RAISE(ABORT,'projection listing input snapshot is immutable') END;

  SELECT CASE WHEN NEW.stage<>OLD.stage AND NOT (
    (OLD.stage='selected' AND NEW.stage='prerequisites')
    OR (OLD.stage='prerequisites' AND NEW.stage='source_positions')
    OR (OLD.stage='source_positions' AND NEW.stage='completed')
  ) THEN RAISE(ABORT,'invalid projection listing stage transition') END;

  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('processing','superseded'))
    OR (OLD.status='processing' AND NEW.status IN (
      'queued','waiting_analysis','blocked','completed','failed','superseded'
    ))
    OR (OLD.status='waiting_analysis' AND NEW.status IN (
      'queued','processing','blocked','failed','superseded'
    ))
    OR (OLD.status IN ('blocked','failed') AND NEW.status IN (
      'queued','superseded'
    ))
  ) THEN RAISE(ABORT,'invalid projection listing status transition') END;

  SELECT CASE WHEN
    OLD.status<>'processing'
    AND NEW.status='processing'
    AND NEW.attempt_count<>OLD.attempt_count+1
  THEN RAISE(ABORT,'projection listing claim must advance attempt') END;

  SELECT CASE WHEN NOT (
    OLD.status<>'processing' AND NEW.status='processing'
  ) AND NEW.attempt_count<>OLD.attempt_count
  THEN RAISE(ABORT,'projection listing attempt changes require a claim') END;

  SELECT CASE WHEN
    OLD.status='processing'
    AND NEW.status='processing'
    AND (
      NEW.lease_owner IS NOT OLD.lease_owner
      OR NEW.lease_token IS NOT OLD.lease_token
    )
  THEN RAISE(ABORT,'projection listing lease ownership is immutable') END;
END;

CREATE TRIGGER trg_public_projection_position_validate_listing
BEFORE INSERT ON public_projection_position_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM public_projection_listing_items listing_item
    JOIN job_source_positions source_position
      ON source_position.id=NEW.source_position_id
     AND source_position.listing_id=listing_item.listing_id
    WHERE listing_item.id=NEW.listing_item_id
      AND listing_item.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'projection position must belong to listing item') END;
END;

CREATE TRIGGER trg_public_projection_position_update_guard
BEFORE UPDATE ON public_projection_position_items
BEGIN
  SELECT CASE WHEN
    OLD.status IN ('completed','superseded')
    AND (
      NEW.stage IS NOT OLD.stage
      OR NEW.status IS NOT OLD.status
      OR NEW.attempt_count IS NOT OLD.attempt_count
      OR NEW.lease_owner IS NOT OLD.lease_owner
      OR NEW.lease_token IS NOT OLD.lease_token
      OR NEW.lease_expires_at IS NOT OLD.lease_expires_at
      OR NEW.public_job_id IS NOT OLD.public_job_id
      OR NEW.simulated_browse_eligible IS NOT OLD.simulated_browse_eligible
      OR NEW.simulated_organic_eligible IS NOT OLD.simulated_organic_eligible
      OR NEW.simulated_job_posting_eligible
        IS NOT OLD.simulated_job_posting_eligible
      OR NEW.readiness_json IS NOT OLD.readiness_json
      OR NEW.reason_codes_json IS NOT OLD.reason_codes_json
      OR NEW.checkpoint_json IS NOT OLD.checkpoint_json
      OR NEW.error_code IS NOT OLD.error_code
      OR NEW.error_detail IS NOT OLD.error_detail
      OR NEW.started_at IS NOT OLD.started_at
      OR NEW.completed_at IS NOT OLD.completed_at
      OR NEW.updated_at IS NOT OLD.updated_at
    )
  THEN RAISE(ABORT,'terminal projection position is immutable') END;

  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.run_id IS NOT OLD.run_id
    OR NEW.listing_item_id IS NOT OLD.listing_item_id
    OR NEW.source_position_id IS NOT OLD.source_position_id
    OR NEW.input_hash IS NOT OLD.input_hash
    OR NEW.max_attempts IS NOT OLD.max_attempts
    OR NEW.created_at IS NOT OLD.created_at
    OR (OLD.public_job_id IS NOT NULL
      AND NEW.public_job_id IS NOT OLD.public_job_id)
  THEN RAISE(ABORT,'projection position input snapshot is immutable') END;

  SELECT CASE WHEN NEW.stage<>OLD.stage AND NOT (
    (OLD.stage='identity' AND NEW.stage='canonical_resolution')
    OR (OLD.stage='canonical_resolution' AND NEW.stage='content')
    OR (OLD.stage='content' AND NEW.stage='eligibility')
    OR (OLD.stage='eligibility' AND NEW.stage='completed')
  ) THEN RAISE(ABORT,'invalid projection position stage transition') END;

  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('processing','superseded'))
    OR (OLD.status='processing' AND NEW.status IN (
      'queued','waiting_analysis','blocked','completed','failed','superseded'
    ))
    OR (OLD.status='waiting_analysis' AND NEW.status IN (
      'queued','processing','blocked','failed','superseded'
    ))
    OR (OLD.status IN ('blocked','failed') AND NEW.status IN (
      'queued','superseded'
    ))
  ) THEN RAISE(ABORT,'invalid projection position status transition') END;

  SELECT CASE WHEN
    OLD.status<>'processing'
    AND NEW.status='processing'
    AND NEW.attempt_count<>OLD.attempt_count+1
  THEN RAISE(ABORT,'projection position claim must advance attempt') END;

  SELECT CASE WHEN NOT (
    OLD.status<>'processing' AND NEW.status='processing'
  ) AND NEW.attempt_count<>OLD.attempt_count
  THEN RAISE(ABORT,'projection position attempt changes require a claim') END;

  SELECT CASE WHEN
    OLD.status='processing'
    AND NEW.status='processing'
    AND (
      NEW.lease_owner IS NOT OLD.lease_owner
      OR NEW.lease_token IS NOT OLD.lease_token
    )
  THEN RAISE(ABORT,'projection position lease ownership is immutable') END;
END;

CREATE TRIGGER trg_public_projection_duplicate_update_guard
BEFORE UPDATE ON public_projection_duplicate_candidates
BEGIN
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.run_id IS NOT OLD.run_id
    OR NEW.position_item_id IS NOT OLD.position_item_id
    OR NEW.candidate_public_job_id IS NOT OLD.candidate_public_job_id
    OR NEW.candidate_public_job_version IS NOT OLD.candidate_public_job_version
    OR NEW.retrieval_algorithm_version IS NOT OLD.retrieval_algorithm_version
    OR NEW.signals_json IS NOT OLD.signals_json
    OR NEW.created_at IS NOT OLD.created_at
  THEN RAISE(ABORT,'duplicate candidate evidence is immutable') END;

  SELECT CASE WHEN
    OLD.agent_task_run_id IS NOT NULL
    AND NEW.agent_task_run_id IS NOT OLD.agent_task_run_id
  THEN RAISE(ABORT,'duplicate advice task is immutable') END;

  SELECT CASE WHEN
    OLD.codex_recommendation IS NOT NULL
    AND NEW.codex_recommendation IS NOT OLD.codex_recommendation
  THEN RAISE(ABORT,'duplicate advice is immutable') END;

  SELECT CASE WHEN
    OLD.operator_decision<>'pending'
    AND (
      NEW.operator_decision IS NOT OLD.operator_decision
      OR NEW.operator_user_id IS NOT OLD.operator_user_id
      OR NEW.operator_decided_at IS NOT OLD.operator_decided_at
    )
  THEN RAISE(ABORT,'duplicate operator decision is immutable') END;
END;

CREATE TRIGGER trg_public_projection_duplicate_delete_immutable
BEFORE DELETE ON public_projection_duplicate_candidates
BEGIN
  SELECT RAISE(ABORT,'duplicate candidate evidence is append-only');
END;

CREATE TRIGGER trg_public_job_identity_signal_update_immutable
BEFORE UPDATE ON public_job_identity_signals
BEGIN
  SELECT RAISE(ABORT,'public job identity signals are append-only');
END;

CREATE TRIGGER trg_public_job_identity_signal_delete_immutable
BEFORE DELETE ON public_job_identity_signals
BEGIN
  SELECT RAISE(ABORT,'public job identity signals are append-only');
END;
