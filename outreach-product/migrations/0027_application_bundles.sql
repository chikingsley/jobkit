CREATE TABLE application_bundles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('anesl_positions')),
  contact_channel_id TEXT NOT NULL REFERENCES contact_channels(id) ON DELETE RESTRICT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'review' CHECK (
    status IN ('review','approved','sent','failed','cancelled')
  ),
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_application_bundles_user_status
  ON application_bundles(user_id,status,updated_at DESC);

CREATE TABLE application_bundle_targets (
  bundle_id TEXT NOT NULL REFERENCES application_bundles(id) ON DELETE CASCADE,
  user_job_id TEXT NOT NULL REFERENCES user_jobs(id) ON DELETE RESTRICT,
  route_id TEXT NOT NULL REFERENCES application_routes(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 4),
  source_reference TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(bundle_id,user_job_id),
  UNIQUE(bundle_id,ordinal)
);

CREATE INDEX idx_application_bundle_targets_user_job
  ON application_bundle_targets(user_job_id,bundle_id);

ALTER TABLE application_drafts ADD COLUMN application_bundle_id TEXT
  REFERENCES application_bundles(id) ON DELETE SET NULL;

ALTER TABLE application_drafts
  ADD COLUMN required_opening TEXT NOT NULL DEFAULT 'Hello,';

CREATE INDEX idx_application_drafts_bundle_version
  ON application_drafts(application_bundle_id,version DESC)
  WHERE application_bundle_id IS NOT NULL;

ALTER TABLE application_attempts ADD COLUMN application_bundle_id TEXT
  REFERENCES application_bundles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_application_attempts_bundle_draft
  ON application_attempts(application_bundle_id,draft_id)
  WHERE application_bundle_id IS NOT NULL;

CREATE TABLE application_bundle_test_sends (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES application_bundles(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE RESTRICT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (
    status IN ('approved','claimed','drafted','sending','sent','failed','uncertain')
  ),
  gmail_draft_id TEXT NOT NULL DEFAULT '',
  gmail_message_id TEXT NOT NULL DEFAULT '',
  gmail_thread_id TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(bundle_id,draft_id,recipient)
);

CREATE INDEX idx_application_bundle_test_sends_bundle
  ON application_bundle_test_sends(bundle_id,updated_at DESC);
