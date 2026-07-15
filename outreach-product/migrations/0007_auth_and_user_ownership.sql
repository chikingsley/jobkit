PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL,
  image TEXT,
  created_at DATE NOT NULL,
  updated_at DATE NOT NULL
);

CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  expires_at DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at DATE NOT NULL,
  updated_at DATE NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE user_accounts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at DATE,
  refresh_token_expires_at DATE,
  scope TEXT,
  password TEXT,
  created_at DATE NOT NULL,
  updated_at DATE NOT NULL
);

CREATE TABLE auth_verifications (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at DATE NOT NULL,
  created_at DATE NOT NULL,
  updated_at DATE NOT NULL
);

CREATE INDEX user_sessions_user_id_idx ON user_sessions(user_id);
CREATE INDEX user_accounts_user_id_idx ON user_accounts(user_id);
CREATE INDEX auth_verifications_identifier_idx ON auth_verifications(identifier);

CREATE TABLE jobs_next (
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
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  compensation_display TEXT NOT NULL DEFAULT 'Salary not listed',
  compensation_amount_min INTEGER,
  compensation_amount_max INTEGER,
  compensation_currency TEXT,
  compensation_period TEXT CHECK (compensation_period IN ('hour','month','year')),
  compensation_qualifier TEXT CHECK (compensation_qualifier IN ('exact','range','up-to','from')),
  compensation_source TEXT NOT NULL DEFAULT 'unknown' CHECK (compensation_source IN ('listing-field','listing-description','curated-review','unknown')),
  compensation_confidence TEXT NOT NULL DEFAULT 'unknown' CHECK (compensation_confidence IN ('exact','inferred','conflict','unknown')),
  compensation_notes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(compensation_notes_json))
);

INSERT INTO jobs_next (
  id,board,title,company,country,location,salary,description,source_url,apply_url,
  employer_id,first_seen_at,updated_at,compensation_display,
  compensation_amount_min,compensation_amount_max,compensation_currency,
  compensation_period,compensation_qualifier,compensation_source,
  compensation_confidence,compensation_notes_json
)
SELECT
  id,board,title,company,country,location,salary,description,source_url,apply_url,
  employer_id,first_seen_at,updated_at,compensation_display,
  compensation_amount_min,compensation_amount_max,compensation_currency,
  compensation_period,compensation_qualifier,compensation_source,
  compensation_confidence,compensation_notes_json
FROM jobs;

CREATE TABLE user_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs_next(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','review','approved','submitting','applied','ignored','failed')),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,job_id)
);

CREATE TABLE application_drafts_next (
  id TEXT PRIMARY KEY,
  user_job_id TEXT NOT NULL REFERENCES user_jobs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  message TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  revision_instruction TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded','submitted')),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  submitted_at TEXT,
  model_provider TEXT,
  model_id TEXT,
  UNIQUE(user_job_id,version)
);

CREATE TABLE job_events_next (
  id TEXT PRIMARY KEY,
  user_job_id TEXT NOT NULL REFERENCES user_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  draft_id TEXT REFERENCES application_drafts_next(id) ON DELETE SET NULL,
  detail TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE user_profiles_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
  updated_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 3
);

CREATE TABLE user_preferences_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  preferences_json TEXT NOT NULL CHECK (json_valid(preferences_json)),
  updated_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE user_documents_next (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE profile_imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES user_documents_next(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('processing','ready','failed','applied')),
  source_text_key TEXT,
  proposal_json TEXT CHECK (proposal_json IS NULL OR json_valid(proposal_json)),
  model_provider TEXT,
  model_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE TABLE user_onboarding (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE job_match_facts (
  job_id TEXT PRIMARY KEY REFERENCES jobs_next(id) ON DELETE CASCADE,
  facts_json TEXT NOT NULL CHECK (json_valid(facts_json)),
  schema_version INTEGER NOT NULL,
  model_provider TEXT,
  model_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE job_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs_next(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('viewed','saved','dismissed','applied')),
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL
);

DROP TABLE job_events;
DROP TABLE application_drafts;
DROP TABLE jobs;
DROP TABLE user_profiles;
DROP TABLE user_preferences;
DROP TABLE user_documents;

ALTER TABLE jobs_next RENAME TO jobs;
ALTER TABLE application_drafts_next RENAME TO application_drafts;
ALTER TABLE job_events_next RENAME TO job_events;
ALTER TABLE user_profiles_next RENAME TO user_profiles;
ALTER TABLE user_preferences_next RENAME TO user_preferences;
ALTER TABLE user_documents_next RENAME TO user_documents;

CREATE INDEX idx_user_jobs_user_status_priority
  ON user_jobs(user_id,status,priority DESC,updated_at DESC);
CREATE INDEX idx_user_jobs_job ON user_jobs(job_id);
CREATE INDEX idx_drafts_user_job_version
  ON application_drafts(user_job_id,version DESC);
CREATE INDEX idx_events_user_job_created
  ON job_events(user_job_id,created_at DESC);
CREATE INDEX idx_user_documents_user
  ON user_documents(user_id,category,created_at DESC);
CREATE INDEX idx_profile_imports_user_created
  ON profile_imports(user_id,created_at DESC);
CREATE INDEX idx_job_feedback_user_created
  ON job_feedback(user_id,created_at DESC);
CREATE INDEX idx_job_feedback_user_job
  ON job_feedback(user_id,job_id,created_at DESC);
