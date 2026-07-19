CREATE TABLE inventory_source_operators (
  source_id TEXT NOT NULL REFERENCES inventory_sources(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('operator')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(source_id,user_id)
);

INSERT INTO inventory_source_operators (source_id,user_id,created_at)
SELECT source.id,user.id,datetime('now')
FROM inventory_sources source CROSS JOIN users user;

CREATE TABLE inventory_refresh_requests (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES inventory_sources(id) ON DELETE RESTRICT,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  runner_id TEXT REFERENCES agent_runners(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('latest','full')),
  boards_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(boards_json)),
  request_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued','claimed','crawling','publishing','completed','failed','canceled')
  ),
  inventory_run_id TEXT REFERENCES inventory_runs(id) ON DELETE SET NULL,
  lease_expires_at TEXT,
  error_detail TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  claimed_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_inventory_refresh_requests_claim
  ON inventory_refresh_requests(status,requested_at);

CREATE INDEX idx_inventory_refresh_requests_source
  ON inventory_refresh_requests(source_id,status,requested_at DESC);

CREATE UNIQUE INDEX idx_inventory_refresh_requests_active_key
  ON inventory_refresh_requests(request_key)
  WHERE status IN ('queued','claimed','crawling','publishing');

ALTER TABLE inventory_runs ADD COLUMN refresh_request_id TEXT
  REFERENCES inventory_refresh_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_inventory_runs_refresh_request
  ON inventory_runs(refresh_request_id)
  WHERE refresh_request_id IS NOT NULL;
