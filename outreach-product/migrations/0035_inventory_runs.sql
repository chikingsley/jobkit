CREATE TABLE inventory_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  completeness_policy TEXT NOT NULL CHECK (
    completeness_policy IN ('complete_snapshot','append_only')
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active','paused')
  ),
  refresh_interval_minutes INTEGER CHECK (refresh_interval_minutes > 0),
  next_refresh_at TEXT,
  last_started_at TEXT,
  last_completed_at TEXT,
  last_success_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO inventory_sources (
  id,name,completeness_policy,status,created_at,updated_at
) VALUES (
  'job-search-sqlite','Job search source inventory','complete_snapshot',
  'active',datetime('now'),datetime('now')
);

UPDATE agent_runners
SET capabilities_json=json_insert(capabilities_json,'$[#]','operations'),
    updated_at=datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM json_each(agent_runners.capabilities_json)
  WHERE value='operations'
);

UPDATE agent_runner_pairings
SET capabilities_json=json_insert(capabilities_json,'$[#]','operations')
WHERE consumed_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM json_each(agent_runner_pairings.capabilities_json)
  WHERE value='operations'
);

CREATE TABLE inventory_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES inventory_sources(id) ON DELETE RESTRICT,
  snapshot_key TEXT NOT NULL,
  started_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  runner_id TEXT REFERENCES agent_runners(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'ingesting','reconciling','completed','partial','failed','canceled'
    )
  ),
  source_total_count INTEGER NOT NULL CHECK (source_total_count >= 0),
  source_active_count INTEGER NOT NULL CHECK (source_active_count >= 0),
  source_closed_count INTEGER NOT NULL CHECK (source_closed_count >= 0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  upserted_count INTEGER NOT NULL DEFAULT 0 CHECK (upserted_count >= 0),
  unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
  closed_count INTEGER NOT NULL DEFAULT 0 CHECK (closed_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(checkpoint_json)),
  error_detail TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(source_id,snapshot_key)
);

CREATE INDEX idx_inventory_runs_source_status
  ON inventory_runs(source_id,status,started_at DESC);

CREATE TABLE inventory_run_batches (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES inventory_runs(id) ON DELETE CASCADE,
  batch_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  status TEXT NOT NULL CHECK (status IN ('processing','completed','failed')),
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(run_id,batch_key),
  UNIQUE(run_id,ordinal)
);

CREATE INDEX idx_inventory_run_batches_run
  ON inventory_run_batches(run_id,ordinal);

CREATE TABLE inventory_run_items (
  run_id TEXT NOT NULL REFERENCES inventory_runs(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES inventory_run_batches(id) ON DELETE CASCADE,
  source_job_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('upserted','unchanged','failed')),
  error_detail TEXT NOT NULL DEFAULT '',
  processed_at TEXT NOT NULL,
  PRIMARY KEY(run_id,source_job_id)
);

CREATE INDEX idx_inventory_run_items_job
  ON inventory_run_items(job_id,processed_at DESC);

CREATE INDEX idx_inventory_run_items_batch
  ON inventory_run_items(batch_id,status,processed_at DESC);

ALTER TABLE jobs ADD COLUMN inventory_source_id TEXT
  REFERENCES inventory_sources(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN inventory_status TEXT NOT NULL DEFAULT 'active'
  CHECK (inventory_status IN ('active','closed'));
ALTER TABLE jobs ADD COLUMN source_last_seen_at TEXT;
ALTER TABLE jobs ADD COLUMN source_content_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN inventory_run_id TEXT
  REFERENCES inventory_runs(id) ON DELETE SET NULL;

CREATE INDEX idx_jobs_inventory_source_status
  ON jobs(inventory_source_id,inventory_status,source_last_seen_at DESC);
