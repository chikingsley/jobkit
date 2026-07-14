create table "users" ("id" text not null primary key, "name" text not null, "email" text not null unique, "email_verified" integer not null, "image" text, "created_at" date not null, "updated_at" date not null);

create table "user_sessions" ("id" text not null primary key, "expires_at" date not null, "token" text not null unique, "created_at" date not null, "updated_at" date not null, "ip_address" text, "user_agent" text, "user_id" text not null references "users" ("id") on delete cascade);

create table "user_accounts" ("id" text not null primary key, "account_id" text not null, "provider_id" text not null, "user_id" text not null references "users" ("id") on delete cascade, "access_token" text, "refresh_token" text, "id_token" text, "access_token_expires_at" date, "refresh_token_expires_at" date, "scope" text, "password" text, "created_at" date not null, "updated_at" date not null);

create table "auth_verifications" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expires_at" date not null, "created_at" date not null, "updated_at" date not null);

create index "user_sessions_user_id_idx" on "user_sessions" ("user_id");

create index "user_accounts_user_id_idx" on "user_accounts" ("user_id");

create index "auth_verifications_identifier_idx" on "auth_verifications" ("identifier");

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
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs_next(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','review','approved','submitting','applied','ignored','failed')),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, job_id)
);

INSERT INTO user_jobs (id,user_id,job_id,status,priority,created_at,updated_at)
SELECT 'legacy:' || id,NULL,id,status,priority,first_seen_at,updated_at FROM jobs;

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
  UNIQUE(user_job_id, version)
);

INSERT INTO application_drafts_next (
  id,user_job_id,version,message,change_summary,revision_instruction,status,
  created_at,approved_at,submitted_at,model_provider,model_id
)
SELECT
  id,'legacy:' || job_id,version,message,change_summary,revision_instruction,status,
  created_at,approved_at,submitted_at,model_provider,model_id
FROM application_drafts;

CREATE TABLE job_events_next (
  id TEXT PRIMARY KEY,
  user_job_id TEXT NOT NULL REFERENCES user_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  draft_id TEXT REFERENCES application_drafts_next(id) ON DELETE SET NULL,
  detail TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

INSERT INTO job_events_next (
  id,user_job_id,event_type,draft_id,detail,metadata_json,created_at
)
SELECT
  id,'legacy:' || job_id,event_type,draft_id,detail,metadata_json,created_at
FROM job_events;

CREATE TABLE user_profiles_next (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1
);

INSERT INTO user_profiles_next (id,user_id,profile_json,updated_at,schema_version)
SELECT id,NULL,profile_json,updated_at,schema_version FROM user_profiles;

CREATE TABLE user_preferences_next (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  preferences_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1
);

INSERT INTO user_preferences_next (
  id,user_id,preferences_json,updated_at,schema_version
)
SELECT id,NULL,preferences_json,updated_at,schema_version FROM user_preferences;

CREATE TABLE user_documents_next (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

INSERT INTO user_documents_next (
  id,user_id,category,filename,object_key,content_type,size_bytes,is_default,created_at
)
SELECT
  id,NULL,category,filename,object_key,content_type,size_bytes,is_default,created_at
FROM user_documents;

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

CREATE TABLE legacy_data_claims (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  claimed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  claimed_at TEXT
);

INSERT INTO legacy_data_claims (id,claimed_by,claimed_at) VALUES (1,NULL,NULL);

CREATE INDEX idx_user_jobs_user_status_priority
  ON user_jobs(user_id,status,priority DESC,updated_at DESC);
CREATE INDEX idx_user_jobs_job ON user_jobs(job_id);
CREATE INDEX idx_drafts_user_job_version
  ON application_drafts(user_job_id,version DESC);
CREATE INDEX idx_events_user_job_created
  ON job_events(user_job_id,created_at DESC);
CREATE INDEX idx_user_documents_user
  ON user_documents(user_id,category,created_at DESC);
