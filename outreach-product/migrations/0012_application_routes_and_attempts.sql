CREATE TABLE application_routes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (
    kind IN ('email','board_form','external_url','login_gated_form','phone','manual')
  ),
  destination TEXT NOT NULL,
  contact_point_id TEXT,
  source_evidence TEXT NOT NULL DEFAULT '',
  last_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active','stale','closed','invalid')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id,kind,destination)
);

CREATE INDEX idx_application_routes_job_status
  ON application_routes(job_id,status,kind);

INSERT INTO application_routes
  (id,job_id,kind,destination,source_evidence,last_verified_at,status,created_at,updated_at)
SELECT
  'route:' || id || ':board-form',
  id,
  'board_form',
  apply_url,
  source_url,
  updated_at,
  'active',
  first_seen_at,
  updated_at
FROM jobs
WHERE board='seriousteachers' AND trim(apply_url)<>'';

CREATE TABLE application_attempts (
  id TEXT PRIMARY KEY,
  user_job_id TEXT NOT NULL REFERENCES user_jobs(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE RESTRICT,
  route_id TEXT NOT NULL REFERENCES application_routes(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (channel IN ('email')),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (
    status IN ('approved','claimed','drafted','sending','sent','failed','uncertain')
  ),
  gmail_draft_id TEXT NOT NULL DEFAULT '',
  gmail_draft_message_id TEXT NOT NULL DEFAULT '',
  gmail_message_id TEXT NOT NULL DEFAULT '',
  gmail_thread_id TEXT NOT NULL DEFAULT '',
  error_stage TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  approved_at TEXT NOT NULL,
  claimed_at TEXT,
  drafted_at TEXT,
  sending_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_job_id,draft_id,route_id)
);

CREATE INDEX idx_application_attempts_user_job_status
  ON application_attempts(user_job_id,status,updated_at DESC);

CREATE INDEX idx_application_attempts_route
  ON application_attempts(route_id,created_at DESC);
