CREATE TABLE job_content_analyses (
  job_id TEXT PRIMARY KEY REFERENCES job_listings(id) ON DELETE CASCADE,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  schema_version INTEGER NOT NULL,
  model_provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_job_content_analyses_version
  ON job_content_analyses(schema_version,updated_at DESC);

CREATE UNIQUE INDEX idx_agent_task_runs_active_global_job_analysis
  ON agent_task_runs(task_type,source_task_id)
  WHERE status='running'
    AND task_type IN (
      'job.match_facts',
      'job.position_analysis',
      'job.content_analysis'
    );
