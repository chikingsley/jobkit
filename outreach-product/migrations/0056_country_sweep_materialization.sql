-- MARKETS-MATERIALIZATION-001: immutable country output manifests and
-- resumable server-owned domain publication.

CREATE TABLE country_sweep_outputs (
  id TEXT PRIMARY KEY,
  sweep_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_run_id TEXT NOT NULL REFERENCES agent_task_runs(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number>0),
  schema_version INTEGER NOT NULL CHECK (schema_version>0),
  status TEXT NOT NULL CHECK (
    status IN (
      'uploading','accepted','materializing','materialized','failed','abandoned'
    )
  ),
  next_chunk_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (next_chunk_ordinal>=0),
  rolling_sha256 TEXT NOT NULL CHECK (length(rolling_sha256)=64),
  manifest_sha256 TEXT CHECK (
    manifest_sha256 IS NULL OR length(manifest_sha256)=64
  ),
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count>=0),
  total_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes>=0),
  organization_count INTEGER NOT NULL DEFAULT 0 CHECK (organization_count>=0),
  contact_count INTEGER NOT NULL DEFAULT 0 CHECK (contact_count>=0),
  scope_count INTEGER NOT NULL DEFAULT 0 CHECK (scope_count>=0),
  coverage_summary_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(coverage_summary_json)
    AND json_type(coverage_summary_json)='object'
    AND length(CAST(coverage_summary_json AS BLOB))<=1000000
  ),
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  materialized_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id,attempt_number),
  UNIQUE(agent_run_id),
  FOREIGN KEY(task_id,sweep_id)
    REFERENCES country_sweep_tasks(id,sweep_id) ON DELETE RESTRICT
);

CREATE INDEX idx_country_sweep_outputs_materialization
  ON country_sweep_outputs(status,accepted_at,id);

-- Country materialization Queue wakes target one immutable work item.  The
-- outbox row ID remains the delivery/idempotency identity so one item can be
-- re-woken for a later page or attempt without reusing an outbox primary key.
ALTER TABLE work_outbox
  ADD COLUMN work_item_id TEXT NOT NULL DEFAULT '';

-- Preserve a currently leased country attempt across a rolling migration.
-- Its exact run, attempt, task, and source lease remain the publication fence.
INSERT INTO country_sweep_outputs (
  id,sweep_id,task_id,agent_run_id,attempt_number,schema_version,status,
  rolling_sha256,created_at,updated_at
)
SELECT
  'historical-output:'||run.id,task.sweep_id,task.id,run.id,
  run.attempt_number,1,'uploading',printf('%064d',0),run.started_at,run.updated_at
FROM country_sweep_tasks task
JOIN agent_task_runs run
  ON run.source_task_id=task.id
 AND run.task_type='country_sweep.'||task.phase
 AND run.attempt_number=task.attempt_count
 AND run.lease_token=task.lease_token
 AND run.source_hash=task.input_hash
 AND run.status='running'
WHERE task.status='claimed';

CREATE TABLE country_sweep_output_chunks (
  id TEXT PRIMARY KEY,
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  kind TEXT NOT NULL CHECK (kind IN ('organizations','contacts','scopes')),
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (length(sha256)=64),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 1000000),
  record_count INTEGER NOT NULL CHECK (record_count BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  UNIQUE(output_id,ordinal)
);

CREATE INDEX idx_country_sweep_output_chunks_output
  ON country_sweep_output_chunks(output_id,ordinal);

CREATE TABLE country_sweep_materialization_items (
  id TEXT PRIMARY KEY,
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'organizations_chunk','contacts_chunk','scopes_chunk',
      'campaign_fanout','verification_fanout','phase_finalize'
    )
  ),
  chunk_id TEXT REFERENCES country_sweep_output_chunks(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence>=0),
  status TEXT NOT NULL CHECK (
    status IN ('queued','processing','completed','failed')
  ),
  cursor_primary TEXT NOT NULL DEFAULT '',
  cursor_secondary TEXT NOT NULL DEFAULT '',
  expected_count INTEGER NOT NULL DEFAULT 0 CHECK (expected_count>=0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count>=0),
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count>=0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts>0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(output_id,kind,sequence),
  CHECK (attempt_count<=max_attempts),
  CHECK (processed_count<=expected_count OR expected_count=0),
  CHECK (
    (
      status='processing'
      AND lease_owner IS NOT NULL
      AND trim(lease_owner)<>''
      AND lease_token IS NOT NULL
      AND trim(lease_token)<>''
      AND lease_expires_at IS NOT NULL
      AND trim(lease_expires_at)<>''
      AND attempt_count>0
    )
    OR (
      status<>'processing'
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
    )
  ),
  CHECK (
    (kind LIKE '%_chunk' AND chunk_id IS NOT NULL)
    OR (kind NOT LIKE '%_chunk' AND chunk_id IS NULL)
  )
);

CREATE INDEX idx_country_materialization_claim
  ON country_sweep_materialization_items(output_id,status,sequence,id);
CREATE INDEX idx_country_materialization_lease
  ON country_sweep_materialization_items(status,lease_expires_at,id);

-- R2 cleanup is resumable independently from the immutable terminal output.
-- Each scheduled pass processes at most one output and one bounded R2 page.
CREATE TABLE country_sweep_output_cleanup (
  output_id TEXT PRIMARY KEY
    REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','completed')
  ),
  deleted_object_count INTEGER NOT NULL DEFAULT 0 CHECK (
    deleted_object_count>=0
  ),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (
    (status='pending' AND completed_at IS NULL)
    OR (status='completed' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX idx_country_sweep_output_cleanup_pending
  ON country_sweep_output_cleanup(status,updated_at,output_id);

CREATE TABLE country_sweep_output_organizations (
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  chunk_id TEXT NOT NULL REFERENCES country_sweep_output_chunks(id) ON DELETE RESTRICT,
  identity_key TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  PRIMARY KEY(output_id,identity_key)
);

CREATE INDEX idx_country_output_organizations_organization
  ON country_sweep_output_organizations(organization_id,output_id);

CREATE TABLE country_sweep_output_contacts (
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  chunk_id TEXT NOT NULL REFERENCES country_sweep_output_chunks(id) ON DELETE RESTRICT,
  contact_key TEXT NOT NULL,
  contact_point_id TEXT NOT NULL
    REFERENCES organization_contact_points(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  PRIMARY KEY(output_id,contact_key)
);

CREATE INDEX idx_country_output_contacts_organization
  ON country_sweep_output_contacts(organization_id,output_id);

CREATE TABLE country_sweep_output_scopes (
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  chunk_id TEXT NOT NULL REFERENCES country_sweep_output_chunks(id) ON DELETE RESTRICT,
  scope_key TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES country_sweep_tasks(id) ON DELETE RESTRICT,
  PRIMARY KEY(output_id,scope_key)
);

CREATE INDEX idx_country_output_scopes_task
  ON country_sweep_output_scopes(task_id,output_id);

CREATE TRIGGER trg_country_output_update_guard
BEFORE UPDATE ON country_sweep_outputs
BEGIN
  SELECT CASE WHEN OLD.status IN ('materialized','failed','abandoned')
    THEN RAISE(ABORT,'terminal country output is immutable') END;
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.sweep_id IS NOT OLD.sweep_id
    OR NEW.task_id IS NOT OLD.task_id
    OR NEW.agent_run_id IS NOT OLD.agent_run_id
    OR NEW.attempt_number IS NOT OLD.attempt_number
    OR NEW.schema_version IS NOT OLD.schema_version
    OR NEW.created_at IS NOT OLD.created_at
    THEN RAISE(ABORT,'country output identity is immutable') END;
  SELECT CASE WHEN OLD.status<>'uploading' AND (
    NEW.next_chunk_ordinal IS NOT OLD.next_chunk_ordinal
    OR NEW.rolling_sha256 IS NOT OLD.rolling_sha256
    OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256
    OR NEW.chunk_count IS NOT OLD.chunk_count
    OR NEW.total_bytes IS NOT OLD.total_bytes
    OR NEW.organization_count IS NOT OLD.organization_count
    OR NEW.contact_count IS NOT OLD.contact_count
    OR NEW.scope_count IS NOT OLD.scope_count
    OR NEW.coverage_summary_json IS NOT OLD.coverage_summary_json
    OR NEW.accepted_at IS NOT OLD.accepted_at
  ) THEN RAISE(ABORT,'accepted country output manifest is immutable') END;
  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='uploading' AND NEW.status IN ('accepted','abandoned'))
    OR (OLD.status='accepted' AND NEW.status IN ('materializing','failed'))
    OR (OLD.status='materializing' AND NEW.status IN ('materialized','failed'))
  ) THEN RAISE(ABORT,'invalid country output status transition') END;
END;

CREATE TRIGGER trg_country_output_chunk_immutable
BEFORE UPDATE ON country_sweep_output_chunks
BEGIN
  SELECT RAISE(ABORT,'country output chunk is immutable');
END;

CREATE TRIGGER trg_country_output_chunk_insert_before_acceptance
BEFORE INSERT ON country_sweep_output_chunks
WHEN EXISTS (
  SELECT 1
  FROM country_sweep_outputs output
  WHERE output.id=NEW.output_id
    AND output.status<>'uploading'
)
BEGIN
  SELECT RAISE(ABORT,'accepted country output manifest is immutable');
END;

CREATE TRIGGER trg_country_output_chunk_no_delete
BEFORE DELETE ON country_sweep_output_chunks
BEGIN
  SELECT RAISE(ABORT,'country output chunk is immutable');
END;
