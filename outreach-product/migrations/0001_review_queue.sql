PRAGMA foreign_keys = ON;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  board TEXT NOT NULL DEFAULT 'seriousteachers',
  title TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  salary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  apply_url TEXT NOT NULL,
  employer_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','review','approved','submitting','applied','ignored','failed')),
  priority INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE application_drafts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  message TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  revision_instruction TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded','submitted')),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  submitted_at TEXT,
  UNIQUE(job_id, version)
);

CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  draft_id TEXT,
  detail TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_jobs_status_priority ON jobs(status, priority DESC, updated_at DESC);
CREATE INDEX idx_drafts_job_version ON application_drafts(job_id, version DESC);
CREATE INDEX idx_events_job_created ON job_events(job_id, created_at DESC);
