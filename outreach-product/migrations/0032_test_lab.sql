CREATE TABLE test_lab_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  corpus_version TEXT NOT NULL,
  case_id TEXT NOT NULL,
  case_kind TEXT NOT NULL CHECK (case_kind IN ('corpus','document')),
  capability TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (
    variant IN ('codex','jina','hybrid','deterministic','codex_vision','mistral_ocr')
  ),
  provider TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (
    status IN ('queued','running','completed','failed','cancelled')
  ),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  expected_json TEXT NOT NULL CHECK (json_valid(expected_json)),
  intermediate_json TEXT CHECK (
    intermediate_json IS NULL OR json_valid(intermediate_json)
  ),
  output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
  metrics_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json)),
  agent_task_request_id TEXT REFERENCES agent_task_requests(id) ON DELETE SET NULL,
  error_detail TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_test_lab_runs_user_created
  ON test_lab_runs(user_id,created_at DESC);
CREATE INDEX idx_test_lab_runs_case_variant
  ON test_lab_runs(user_id,case_id,variant,created_at DESC);
CREATE INDEX idx_test_lab_runs_status
  ON test_lab_runs(user_id,status,updated_at);

CREATE TABLE test_lab_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  left_run_id TEXT NOT NULL REFERENCES test_lab_runs(id) ON DELETE CASCADE,
  right_run_id TEXT NOT NULL REFERENCES test_lab_runs(id) ON DELETE CASCADE,
  preference TEXT NOT NULL CHECK (
    preference IN ('left','right','tie','both_bad')
  ),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(user_id,left_run_id,right_run_id)
);

CREATE TABLE agent_task_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_task_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  purpose TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id,object_key)
);

CREATE INDEX idx_agent_task_artifacts_run
  ON agent_task_artifacts(run_id,user_id);

CREATE TABLE test_delivery_allowlist (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  ownership_basis TEXT NOT NULL CHECK (
    ownership_basis IN ('account_email','gmail_mailbox')
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id,email)
);

CREATE TABLE test_delivery_captures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  mime_sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachments_json)),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_test_delivery_captures_user_created
  ON test_delivery_captures(user_id,created_at DESC);

CREATE TABLE test_delivery_events (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL REFERENCES test_delivery_captures(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('automated_reply','bounce','human_reply')
  ),
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_test_delivery_events_capture
  ON test_delivery_events(capture_id,created_at);
