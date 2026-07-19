CREATE TABLE agent_runner_pairings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_agent_runner_pairings_user
  ON agent_runner_pairings(user_id,created_at DESC);

CREATE TABLE agent_runners (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  codex_version TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_agent_runners_user
  ON agent_runners(user_id,created_at DESC);

CREATE TABLE agent_task_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  runner_id TEXT NOT NULL REFERENCES agent_runners(id) ON DELETE RESTRICT,
  task_type TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed')),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_detail TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_agent_task_runs_user_status
  ON agent_task_runs(user_id,status,started_at DESC);
CREATE INDEX idx_agent_task_runs_source
  ON agent_task_runs(task_type,source_task_id,started_at DESC);
CREATE UNIQUE INDEX idx_agent_task_runs_active_source
  ON agent_task_runs(user_id,task_type,source_task_id)
  WHERE status='running';

DROP TABLE country_sweep_runner_tokens;
