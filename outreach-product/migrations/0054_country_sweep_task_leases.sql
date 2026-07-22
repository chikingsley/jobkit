-- AGENT-LEASES-002: exact country-sweep task attempts and shared runner leases.
--
-- The parent tables need new CHECK domains, so this migration rebuilds them.
-- External sweep references are copied before the old parent is dropped and
-- restored after the replacement takes its canonical name. This preserves the
-- existing sweep and task IDs while avoiding ON DELETE SET NULL data loss.

CREATE TABLE country_sweep_organization_refs (
  row_id TEXT PRIMARY KEY,
  sweep_id TEXT NOT NULL
);

INSERT INTO country_sweep_organization_refs(row_id,sweep_id)
SELECT id,source_sweep_id FROM organizations WHERE source_sweep_id IS NOT NULL;

CREATE TABLE country_sweep_evidence_refs (
  row_id TEXT PRIMARY KEY,
  sweep_id TEXT NOT NULL
);

INSERT INTO country_sweep_evidence_refs(row_id,sweep_id)
SELECT id,source_sweep_id
FROM organization_evidence
WHERE source_sweep_id IS NOT NULL;

CREATE TABLE country_sweep_campaign_market_refs (
  campaign_id TEXT NOT NULL,
  country_code TEXT NOT NULL,
  sweep_id TEXT NOT NULL,
  PRIMARY KEY(campaign_id,country_code)
);

INSERT INTO country_sweep_campaign_market_refs(
  campaign_id,country_code,sweep_id
)
SELECT campaign_id,country_code,sweep_id
FROM campaign_markets
WHERE sweep_id IS NOT NULL;

CREATE TABLE country_sweeps_next (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL CHECK (length(country_code)=2),
  country_name TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN (
      'queued','running','completed','completed_with_gaps','failed','canceled'
    )
  ),
  requested_scope_json TEXT NOT NULL CHECK (json_valid(requested_scope_json)),
  coverage_summary_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(coverage_summary_json)
  ),
  error_detail TEXT NOT NULL DEFAULT '',
  task_total INTEGER NOT NULL DEFAULT 0 CHECK (task_total>=0),
  task_completed INTEGER NOT NULL DEFAULT 0 CHECK (task_completed>=0),
  task_failed INTEGER NOT NULL DEFAULT 0 CHECK (task_failed>=0),
  missing_scope_count INTEGER NOT NULL DEFAULT 0 CHECK (
    missing_scope_count>=0
  ),
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (task_completed+task_failed<=task_total)
);

INSERT INTO country_sweeps_next (
  id,country_code,country_name,requested_by_user_id,status,
  requested_scope_json,coverage_summary_json,error_detail,task_total,
  task_completed,task_failed,missing_scope_count,requested_at,started_at,
  completed_at,updated_at
)
SELECT
  sweep.id,sweep.country_code,sweep.country_name,sweep.requested_by_user_id,
  CASE WHEN sweep.status='claimed' THEN 'running' ELSE sweep.status END,
  sweep.requested_scope_json,sweep.coverage_summary_json,sweep.error_detail,
  (SELECT COUNT(*) FROM country_sweep_tasks task WHERE task.sweep_id=sweep.id),
  (SELECT COUNT(*) FROM country_sweep_tasks task
    WHERE task.sweep_id=sweep.id AND task.status='completed'),
  (SELECT COUNT(*) FROM country_sweep_tasks task
    WHERE task.sweep_id=sweep.id AND task.status='failed'),
  (SELECT COUNT(*) FROM country_sweep_tasks task
    WHERE task.sweep_id=sweep.id AND task.status='failed'
      AND task.phase IN ('discovery','verification')),
  sweep.requested_at,sweep.started_at,sweep.completed_at,sweep.updated_at
FROM country_sweeps sweep;

CREATE TABLE country_sweep_tasks_next (
  id TEXT PRIMARY KEY,
  sweep_id TEXT NOT NULL REFERENCES country_sweeps_next(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (
    phase IN ('discovery','verification','coverage_audit')
  ),
  scope_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued','claimed','materializing','completed','failed')
  ),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
  worker_id TEXT,
  claimed_at TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  completed_at TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts>0),
  accepted_output_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(sweep_id,phase,scope_key),
  UNIQUE(id,sweep_id),
  CHECK (attempt_count<=max_attempts),
  CHECK (
    (
      status='claimed'
      AND worker_id IS NOT NULL
      AND trim(worker_id)<>''
      AND lease_token IS NOT NULL
      AND trim(lease_token)<>''
      AND lease_expires_at IS NOT NULL
      AND trim(lease_expires_at)<>''
      AND attempt_count>0
    )
    OR (
      status<>'claimed'
      AND worker_id IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
    )
  ),
  CHECK (status<>'materializing' OR accepted_output_id IS NOT NULL)
);

INSERT INTO country_sweep_tasks_next (
  id,sweep_id,phase,scope_key,status,input_json,input_hash,output_json,
  worker_id,claimed_at,lease_token,lease_expires_at,completed_at,error_code,
  error_detail,attempt_count,max_attempts,accepted_output_id,created_at,
  updated_at
)
SELECT
  task.id,task.sweep_id,task.phase,task.scope_key,
  CASE
    WHEN task.status='claimed' AND EXISTS (
      SELECT 1 FROM agent_task_runs run
      WHERE run.source_task_id=task.id
        AND run.task_type='country_sweep.'||task.phase
        AND run.runner_id=task.worker_id
        AND run.status='running'
    ) THEN 'claimed'
    WHEN task.status='claimed' THEN 'queued'
    ELSE task.status
  END,
  task.input_json,
  COALESCE((
    SELECT run.source_hash FROM agent_task_runs run
    WHERE run.source_task_id=task.id
      AND run.task_type='country_sweep.'||task.phase
      AND length(run.source_hash)=64
    ORDER BY run.attempt_number DESC,run.started_at DESC,run.id DESC
    LIMIT 1
  ),printf('%064d',0)),
  task.output_json,
  CASE WHEN task.status='claimed' THEN (
    SELECT run.runner_id FROM agent_task_runs run
    WHERE run.source_task_id=task.id
      AND run.task_type='country_sweep.'||task.phase
      AND run.runner_id=task.worker_id
      AND run.status='running'
    ORDER BY run.attempt_number DESC LIMIT 1
  ) ELSE NULL END,
  task.claimed_at,
  CASE WHEN task.status='claimed' THEN (
    SELECT run.lease_token FROM agent_task_runs run
    WHERE run.source_task_id=task.id
      AND run.task_type='country_sweep.'||task.phase
      AND run.runner_id=task.worker_id
      AND run.status='running'
    ORDER BY run.attempt_number DESC LIMIT 1
  ) ELSE NULL END,
  CASE WHEN task.status='claimed' THEN (
    SELECT run.lease_expires_at FROM agent_task_runs run
    WHERE run.source_task_id=task.id
      AND run.task_type='country_sweep.'||task.phase
      AND run.runner_id=task.worker_id
      AND run.status='running'
    ORDER BY run.attempt_number DESC LIMIT 1
  ) ELSE NULL END,
  CASE WHEN task.status='claimed' AND NOT EXISTS (
    SELECT 1 FROM agent_task_runs run
    WHERE run.source_task_id=task.id
      AND run.task_type='country_sweep.'||task.phase
      AND run.runner_id=task.worker_id
      AND run.status='running'
  ) THEN NULL ELSE task.completed_at END,
  CASE
    WHEN task.status='claimed' AND NOT EXISTS (
      SELECT 1 FROM agent_task_runs run
      WHERE run.source_task_id=task.id
        AND run.task_type='country_sweep.'||task.phase
        AND run.runner_id=task.worker_id
        AND run.status='running'
    ) THEN 'legacy_orphaned_claim'
    WHEN task.status='failed' THEN 'legacy_failure'
    ELSE ''
  END,
  CASE
    WHEN task.status='claimed' AND NOT EXISTS (
      SELECT 1 FROM agent_task_runs run
      WHERE run.source_task_id=task.id
        AND run.task_type='country_sweep.'||task.phase
        AND run.runner_id=task.worker_id
        AND run.status='running'
    ) THEN 'Recovered orphaned country task claim during lease migration'
    ELSE task.error_detail
  END,
  MAX(task.attempt_count,COALESCE((
    SELECT MAX(run.attempt_number) FROM agent_task_runs run
    WHERE run.source_task_id=task.id
      AND run.task_type='country_sweep.'||task.phase
  ),0)),
  MAX(3,task.attempt_count,COALESCE((
    SELECT MAX(run.attempt_number) FROM agent_task_runs run
    WHERE run.source_task_id=task.id
      AND run.task_type='country_sweep.'||task.phase
  ),0)),
  NULL,task.created_at,task.updated_at
FROM country_sweep_tasks task;

DROP TABLE country_sweep_tasks;
DROP TABLE country_sweeps;

ALTER TABLE country_sweeps_next RENAME TO country_sweeps;
ALTER TABLE country_sweep_tasks_next RENAME TO country_sweep_tasks;

UPDATE organizations
SET source_sweep_id=(
  SELECT ref.sweep_id FROM country_sweep_organization_refs ref
  WHERE ref.row_id=organizations.id
)
WHERE id IN (SELECT row_id FROM country_sweep_organization_refs);

UPDATE organization_evidence
SET source_sweep_id=(
  SELECT ref.sweep_id FROM country_sweep_evidence_refs ref
  WHERE ref.row_id=organization_evidence.id
)
WHERE id IN (SELECT row_id FROM country_sweep_evidence_refs);

UPDATE campaign_markets
SET sweep_id=(
  SELECT ref.sweep_id FROM country_sweep_campaign_market_refs ref
  WHERE ref.campaign_id=campaign_markets.campaign_id
    AND ref.country_code=campaign_markets.country_code
)
WHERE (campaign_id,country_code) IN (
  SELECT campaign_id,country_code FROM country_sweep_campaign_market_refs
);

DROP TABLE country_sweep_organization_refs;
DROP TABLE country_sweep_evidence_refs;
DROP TABLE country_sweep_campaign_market_refs;

CREATE INDEX idx_country_sweeps_country_status
  ON country_sweeps(country_code,status,requested_at DESC);
CREATE INDEX idx_country_sweeps_requester
  ON country_sweeps(requested_by_user_id,requested_at DESC);
CREATE INDEX idx_country_sweep_tasks_claim
  ON country_sweep_tasks(status,phase,created_at);
CREATE INDEX idx_country_sweep_tasks_active_lease
  ON country_sweep_tasks(sweep_id,worker_id,status,lease_expires_at,lease_token);

CREATE TRIGGER trg_country_sweep_update_guard
BEFORE UPDATE ON country_sweeps
BEGIN
  SELECT CASE WHEN OLD.status IN (
    'completed','completed_with_gaps','failed','canceled'
  ) THEN RAISE(ABORT,'terminal country sweep is immutable') END;
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.country_code IS NOT OLD.country_code
    OR NEW.country_name IS NOT OLD.country_name
    OR NEW.requested_by_user_id IS NOT OLD.requested_by_user_id
    OR NEW.requested_scope_json IS NOT OLD.requested_scope_json
    OR NEW.requested_at IS NOT OLD.requested_at
    THEN RAISE(ABORT,'country sweep request is immutable') END;
  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('running','failed','canceled'))
    OR (
      OLD.status='running'
      AND NEW.status IN (
        'completed','completed_with_gaps','failed','canceled'
      )
    )
  ) THEN RAISE(ABORT,'invalid country sweep status transition') END;
END;

CREATE TRIGGER trg_country_sweep_task_insert_guard
BEFORE INSERT ON country_sweep_tasks
BEGIN
  SELECT CASE WHEN NEW.attempt_count>NEW.max_attempts
    THEN RAISE(ABORT,'country task attempt budget exceeded') END;
  SELECT CASE WHEN NOT (
    (
      NEW.status='claimed'
      AND NEW.worker_id IS NOT NULL
      AND trim(NEW.worker_id)<>''
      AND NEW.lease_token IS NOT NULL
      AND trim(NEW.lease_token)<>''
      AND NEW.lease_expires_at IS NOT NULL
      AND trim(NEW.lease_expires_at)<>''
      AND NEW.attempt_count>0
    )
    OR (
      NEW.status<>'claimed'
      AND NEW.worker_id IS NULL
      AND NEW.lease_token IS NULL
      AND NEW.lease_expires_at IS NULL
    )
  ) THEN RAISE(ABORT,'invalid country task lease state') END;
END;

CREATE TRIGGER trg_country_sweep_task_update_guard
BEFORE UPDATE ON country_sweep_tasks
BEGIN
  SELECT CASE WHEN OLD.status IN ('completed','failed')
    THEN RAISE(ABORT,'terminal country task is immutable') END;
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.sweep_id IS NOT OLD.sweep_id
    OR NEW.phase IS NOT OLD.phase
    OR NEW.scope_key IS NOT OLD.scope_key
    OR NEW.input_json IS NOT OLD.input_json
    OR NEW.max_attempts IS NOT OLD.max_attempts
    OR NEW.created_at IS NOT OLD.created_at
    OR (
      NEW.input_hash IS NOT OLD.input_hash
      AND NOT (
        OLD.status='queued' AND NEW.status='queued'
        AND OLD.attempt_count=0 AND NEW.attempt_count=0
        AND OLD.input_hash=printf('%064d',0)
      )
    )
    THEN RAISE(ABORT,'country task input is immutable') END;
  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('claimed','failed'))
    OR (
      OLD.status='claimed'
      AND NEW.status IN ('queued','materializing','completed','failed')
    )
    OR (OLD.status='materializing' AND NEW.status IN ('completed','failed'))
  ) THEN RAISE(ABORT,'invalid country task status transition') END;
  SELECT CASE WHEN
    OLD.status='queued' AND NEW.status='claimed'
    AND NEW.attempt_count<>OLD.attempt_count+1
    THEN RAISE(ABORT,'country task claim must advance attempt') END;
  SELECT CASE WHEN NOT (
    OLD.status='queued' AND NEW.status='claimed'
  ) AND NEW.attempt_count<>OLD.attempt_count
    THEN RAISE(ABORT,'country task attempts change only on claim') END;
  SELECT CASE WHEN
    OLD.status='claimed' AND NEW.status='claimed'
    AND (
      NEW.worker_id IS NOT OLD.worker_id
      OR NEW.lease_token IS NOT OLD.lease_token
    )
    THEN RAISE(ABORT,'country task lease ownership is immutable') END;
  SELECT CASE WHEN NOT (
    (
      NEW.status='claimed'
      AND NEW.worker_id IS NOT NULL
      AND trim(NEW.worker_id)<>''
      AND NEW.lease_token IS NOT NULL
      AND trim(NEW.lease_token)<>''
      AND NEW.lease_expires_at IS NOT NULL
      AND trim(NEW.lease_expires_at)<>''
      AND NEW.attempt_count>0
    )
    OR (
      NEW.status<>'claimed'
      AND NEW.worker_id IS NULL
      AND NEW.lease_token IS NULL
      AND NEW.lease_expires_at IS NULL
    )
  ) THEN RAISE(ABORT,'invalid country task lease state') END;
END;
