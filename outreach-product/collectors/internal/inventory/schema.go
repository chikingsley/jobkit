package inventory

var schemaStatements = []string{
	`CREATE TABLE IF NOT EXISTS jobs (
		board TEXT NOT NULL,
		job_id TEXT NOT NULL,
		source_board TEXT NOT NULL DEFAULT '',
		url TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL DEFAULT '',
		company TEXT NOT NULL DEFAULT '',
		location TEXT NOT NULL DEFAULT '',
		country TEXT NOT NULL DEFAULT '',
		salary TEXT NOT NULL DEFAULT '',
		currency TEXT NOT NULL DEFAULT '',
		degree_required TEXT NOT NULL DEFAULT '',
		eu_passport_required TEXT NOT NULL DEFAULT '',
		contract_length TEXT NOT NULL DEFAULT '',
		start_date TEXT NOT NULL DEFAULT '',
		apply_email TEXT NOT NULL DEFAULT '',
		apply_url TEXT NOT NULL DEFAULT '',
		posted_date TEXT NOT NULL DEFAULT '',
		description TEXT NOT NULL DEFAULT '',
		raw TEXT NOT NULL DEFAULT '',
		raw_json TEXT NOT NULL DEFAULT '{}',
		normalized_json TEXT NOT NULL DEFAULT '{}',
		status TEXT NOT NULL DEFAULT 'active'
			CHECK(status IN ('active','stale','closed','ignored','applied')),
		first_seen_at TEXT NOT NULL DEFAULT '',
		last_seen_at TEXT NOT NULL DEFAULT '',
		last_present_at TEXT NOT NULL DEFAULT '',
		last_checked_at TEXT NOT NULL DEFAULT '',
		closed_at TEXT NOT NULL DEFAULT '',
		last_run_id INTEGER,
		PRIMARY KEY(board, job_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`,
	`CREATE INDEX IF NOT EXISTS idx_jobs_board_status ON jobs(board, status)`,
	`CREATE INDEX IF NOT EXISTS idx_jobs_country ON jobs(country)`,
	`CREATE TABLE IF NOT EXISTS collector_schema_migrations (
		version INTEGER PRIMARY KEY,
		applied_at TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS collector_runs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		board TEXT NOT NULL,
		scope_key TEXT NOT NULL,
		mode TEXT NOT NULL CHECK(mode IN ('full','latest')),
		partitions_json TEXT NOT NULL DEFAULT '[]',
		status TEXT NOT NULL
			CHECK(status IN ('discovering','hydrating','partial','completed','canceled')),
		discovery_complete INTEGER NOT NULL DEFAULT 0,
		source_complete INTEGER NOT NULL DEFAULT 0,
		discovery_evidence_json TEXT NOT NULL DEFAULT '{}',
		discovered_count INTEGER NOT NULL DEFAULT 0,
		hydrated_count INTEGER NOT NULL DEFAULT 0,
		failed_count INTEGER NOT NULL DEFAULT 0,
		error_detail TEXT NOT NULL DEFAULT '',
		started_at TEXT NOT NULL,
		finished_at TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_collector_active_scope
		ON collector_runs(board, scope_key, mode)
		WHERE status IN ('discovering','hydrating','partial')`,
	`CREATE INDEX IF NOT EXISTS idx_collector_runs_board
		ON collector_runs(board, id DESC)`,
	`CREATE TABLE IF NOT EXISTS collector_items (
		run_id INTEGER NOT NULL REFERENCES collector_runs(id) ON DELETE CASCADE,
		source_board TEXT NOT NULL DEFAULT '',
		item_id TEXT NOT NULL,
		ordinal INTEGER NOT NULL,
		metadata_json TEXT NOT NULL DEFAULT '{}',
		status TEXT NOT NULL DEFAULT 'discovered'
			CHECK(status IN ('discovered','hydrated','failed')),
		attempts INTEGER NOT NULL DEFAULT 0,
		error_detail TEXT NOT NULL DEFAULT '',
		discovered_at TEXT NOT NULL,
		last_attempt_at TEXT NOT NULL DEFAULT '',
		hydrated_at TEXT NOT NULL DEFAULT '',
		PRIMARY KEY(run_id, source_board, item_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_collector_pending
		ON collector_items(run_id, status, ordinal)`,
}
