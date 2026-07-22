-- AGENT-LEASES-001: request-backed attempts, shared leases, and durable history.
-- Existing parent tables are extended in place so every dependent foreign key
-- keeps its original table identity.

ALTER TABLE agent_task_requests
ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0);

ALTER TABLE agent_task_requests
ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts>0);

ALTER TABLE agent_task_requests ADD COLUMN lease_token TEXT;
ALTER TABLE agent_task_requests ADD COLUMN next_attempt_at TEXT;

ALTER TABLE agent_task_requests
ADD COLUMN last_error_code TEXT NOT NULL DEFAULT '';

ALTER TABLE agent_task_requests
ADD COLUMN retry_of_request_id TEXT
  REFERENCES agent_task_requests(id) ON DELETE SET NULL;

ALTER TABLE agent_task_runs
ADD COLUMN attempt_number INTEGER NOT NULL DEFAULT 1
  CHECK (attempt_number>0);

ALTER TABLE agent_task_runs
ADD COLUMN lease_token TEXT NOT NULL DEFAULT 'historical'
  CHECK (trim(lease_token)<>'');

ALTER TABLE agent_task_runs
ADD COLUMN error_code TEXT NOT NULL DEFAULT '';

-- Historical runs receive a stable ordinal within their immutable source.
UPDATE agent_task_runs AS current_run
SET attempt_number=(
  SELECT COUNT(*)
  FROM agent_task_runs prior_run
  WHERE prior_run.user_id=current_run.user_id
    AND prior_run.task_type=current_run.task_type
    AND prior_run.source_task_id=current_run.source_task_id
    AND (
      prior_run.started_at<current_run.started_at
      OR (
        prior_run.started_at=current_run.started_at
        AND prior_run.id<=current_run.id
      )
    )
),
lease_token='historical:'||current_run.id;

UPDATE agent_task_requests
SET attempt_count=MAX(
  CASE WHEN status='claimed' THEN 1 ELSE 0 END,
  COALESCE((
    SELECT MAX(history.attempt_number)
    FROM agent_task_runs history
    WHERE history.source_task_id=agent_task_requests.id
      AND history.user_id=agent_task_requests.user_id
      AND history.task_type=agent_task_requests.task_type
  ),0)
);

UPDATE agent_task_requests
SET max_attempts=attempt_count
WHERE attempt_count>max_attempts;

-- Recover a claimed historical pair under one deterministic shared token.
UPDATE agent_task_requests
SET lease_token=(
  SELECT active_run.lease_token
  FROM agent_task_runs active_run
  WHERE active_run.source_task_id=agent_task_requests.id
    AND active_run.user_id=agent_task_requests.user_id
    AND active_run.task_type=agent_task_requests.task_type
    AND active_run.runner_id=agent_task_requests.runner_id
    AND active_run.status='running'
  ORDER BY active_run.attempt_number DESC
  LIMIT 1
)
WHERE status='claimed'
  AND EXISTS (
    SELECT 1
    FROM agent_task_runs active_run
    WHERE active_run.source_task_id=agent_task_requests.id
      AND active_run.user_id=agent_task_requests.user_id
      AND active_run.task_type=agent_task_requests.task_type
      AND active_run.runner_id=agent_task_requests.runner_id
      AND active_run.status='running'
  );

-- A legacy claimed request without its run is recoverable queued work.
UPDATE agent_task_requests
SET status='queued',runner_id=NULL,claimed_at=NULL,lease_expires_at=NULL,
    lease_token=NULL,last_error_code='legacy_orphaned_claim',
    error_detail='Recovered orphaned claim during attempt-lease migration',
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE status='claimed' AND lease_token IS NULL;

UPDATE agent_task_requests
SET runner_id=NULL,lease_expires_at=NULL,lease_token=NULL
WHERE status<>'claimed';

CREATE UNIQUE INDEX idx_agent_task_runs_source_attempt
  ON agent_task_runs(user_id,task_type,source_task_id,attempt_number);

CREATE INDEX idx_agent_task_requests_ready
  ON agent_task_requests(
    user_id,task_type,status,next_attempt_at,created_at
  );

CREATE INDEX idx_agent_task_requests_active_lease
  ON agent_task_requests(
    user_id,runner_id,status,lease_expires_at,lease_token
  );

CREATE TABLE transaction_assertions (
  must_equal_one INTEGER NOT NULL CHECK (must_equal_one=1)
);

CREATE TABLE work_outbox (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  available_at TEXT NOT NULL,
  published_at TEXT,
  publish_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    publish_attempt_count>=0
  ),
  created_at TEXT NOT NULL,
  UNIQUE(topic,aggregate_id,id)
);

CREATE TRIGGER trg_agent_task_request_insert_lease_guard
BEFORE INSERT ON agent_task_requests
BEGIN
  SELECT CASE WHEN NEW.attempt_count>NEW.max_attempts
    THEN RAISE(ABORT,'agent task request attempt budget exceeded') END;
  SELECT CASE WHEN NOT (
    (
      NEW.status='claimed'
      AND NEW.runner_id IS NOT NULL
      AND trim(NEW.runner_id)<>''
      AND NEW.lease_token IS NOT NULL
      AND trim(NEW.lease_token)<>''
      AND NEW.lease_expires_at IS NOT NULL
      AND trim(NEW.lease_expires_at)<>''
      AND NEW.attempt_count>0
    )
    OR (
      NEW.status<>'claimed'
      AND NEW.runner_id IS NULL
      AND NEW.lease_token IS NULL
      AND NEW.lease_expires_at IS NULL
    )
  ) THEN RAISE(ABORT,'invalid agent task request lease state') END;
END;

CREATE TRIGGER trg_agent_task_request_update_guard
BEFORE UPDATE ON agent_task_requests
BEGIN
  SELECT CASE WHEN
    OLD.status IN ('completed','failed','cancelled')
    THEN RAISE(ABORT,'terminal agent task request is immutable') END;
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.user_id IS NOT OLD.user_id
    OR NEW.task_type IS NOT OLD.task_type
    OR NEW.subject_type IS NOT OLD.subject_type
    OR NEW.subject_id IS NOT OLD.subject_id
    OR NEW.input_json IS NOT OLD.input_json
    OR NEW.retry_of_request_id IS NOT OLD.retry_of_request_id
    OR NEW.created_at IS NOT OLD.created_at
    THEN RAISE(ABORT,'agent task request input is immutable') END;
  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('claimed','cancelled','failed'))
    OR (OLD.status='claimed' AND NEW.status IN ('queued','completed','failed'))
  ) THEN RAISE(ABORT,'invalid agent task request status transition') END;
  SELECT CASE WHEN
    OLD.status='queued' AND NEW.status='claimed'
    AND NEW.attempt_count<>OLD.attempt_count+1
    THEN RAISE(ABORT,'agent task claim must advance attempt') END;
  SELECT CASE WHEN NOT (
    OLD.status='queued' AND NEW.status='claimed'
  ) AND NEW.attempt_count<>OLD.attempt_count
    THEN RAISE(ABORT,'agent task attempts change only on claim') END;
  SELECT CASE WHEN NEW.attempt_count>NEW.max_attempts
    THEN RAISE(ABORT,'agent task request attempt budget exceeded') END;
  SELECT CASE WHEN
    OLD.status='claimed' AND NEW.status='claimed'
    AND (
      NEW.runner_id IS NOT OLD.runner_id
      OR NEW.lease_token IS NOT OLD.lease_token
    )
    THEN RAISE(ABORT,'agent task lease ownership is immutable') END;
  SELECT CASE WHEN NOT (
    (
      NEW.status='claimed'
      AND NEW.runner_id IS NOT NULL
      AND trim(NEW.runner_id)<>''
      AND NEW.lease_token IS NOT NULL
      AND trim(NEW.lease_token)<>''
      AND NEW.lease_expires_at IS NOT NULL
      AND trim(NEW.lease_expires_at)<>''
      AND NEW.attempt_count>0
    )
    OR (
      NEW.status<>'claimed'
      AND NEW.runner_id IS NULL
      AND NEW.lease_token IS NULL
      AND NEW.lease_expires_at IS NULL
    )
  ) THEN RAISE(ABORT,'invalid agent task request lease state') END;
END;

CREATE TRIGGER trg_agent_task_run_insert_guard
BEFORE INSERT ON agent_task_runs
BEGIN
  SELECT CASE WHEN
    NEW.attempt_number<=0 OR trim(NEW.lease_token)=''
    THEN RAISE(ABORT,'invalid agent task run attempt lease') END;
END;

CREATE TRIGGER trg_agent_task_run_update_guard
BEFORE UPDATE ON agent_task_runs
BEGIN
  SELECT CASE WHEN OLD.status IN ('completed','failed')
    THEN RAISE(ABORT,'terminal agent task run is immutable') END;
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.user_id IS NOT OLD.user_id
    OR NEW.runner_id IS NOT OLD.runner_id
    OR NEW.task_type IS NOT OLD.task_type
    OR NEW.source_task_id IS NOT OLD.source_task_id
    OR NEW.prompt_version IS NOT OLD.prompt_version
    OR NEW.model IS NOT OLD.model
    OR NEW.reasoning_effort IS NOT OLD.reasoning_effort
    OR NEW.source_hash IS NOT OLD.source_hash
    OR NEW.prompt_hash IS NOT OLD.prompt_hash
    OR NEW.started_at IS NOT OLD.started_at
    OR NEW.attempt_number IS NOT OLD.attempt_number
    OR NEW.lease_token IS NOT OLD.lease_token
    THEN RAISE(ABORT,'agent task run attempt is immutable') END;
  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    OLD.status='running' AND NEW.status IN ('completed','failed')
  ) THEN RAISE(ABORT,'invalid agent task run status transition') END;
END;
