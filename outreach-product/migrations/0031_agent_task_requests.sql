ALTER TABLE profile_imports
  ADD COLUMN source_text_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE profile_imports
  ADD COLUMN source_text_detail TEXT NOT NULL DEFAULT '';

CREATE TABLE agent_task_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','claimed','completed','failed','cancelled')),
  runner_id TEXT REFERENCES agent_runners(id) ON DELETE SET NULL,
  lease_expires_at TEXT,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_agent_task_requests_active_subject
  ON agent_task_requests(user_id,task_type,subject_type,subject_id)
  WHERE status IN ('queued','claimed');

CREATE INDEX idx_agent_task_requests_claim
  ON agent_task_requests(user_id,task_type,status,created_at);
CREATE INDEX idx_agent_task_requests_runner
  ON agent_task_requests(runner_id,status,lease_expires_at);
