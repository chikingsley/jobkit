CREATE TABLE application_attempts_next (
  id TEXT PRIMARY KEY,
  user_job_id TEXT NOT NULL REFERENCES "user_listing_states"(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE RESTRICT,
  route_id TEXT NOT NULL REFERENCES application_routes(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (
    channel IN ('email','board_form','login_gated_form')
  ),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  payload_sha256 TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (
    status IN ('approved','claimed','drafted','sending','sent','failed','uncertain')
  ),
  confirmation_url TEXT NOT NULL DEFAULT '',
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
  send_requested_at TEXT,
  application_bundle_id TEXT REFERENCES application_bundles(id) ON DELETE SET NULL,
  UNIQUE(user_job_id,draft_id,route_id)
);

INSERT INTO application_attempts_next (
  id,user_job_id,draft_id,route_id,channel,recipient,subject,payload_sha256,
  status,gmail_draft_id,gmail_draft_message_id,gmail_message_id,gmail_thread_id,
  error_stage,error_detail,approved_at,claimed_at,drafted_at,sending_at,sent_at,
  created_at,updated_at,send_requested_at,application_bundle_id
)
SELECT
  id,user_job_id,draft_id,route_id,channel,recipient,subject,payload_sha256,
  status,gmail_draft_id,gmail_draft_message_id,gmail_message_id,gmail_thread_id,
  error_stage,error_detail,approved_at,claimed_at,drafted_at,sending_at,sent_at,
  created_at,updated_at,send_requested_at,application_bundle_id
FROM application_attempts;

DROP TABLE application_attempts;

ALTER TABLE application_attempts_next RENAME TO application_attempts;

CREATE INDEX idx_application_attempts_user_job_status
  ON application_attempts(user_job_id,status,updated_at DESC);

CREATE INDEX idx_application_attempts_channel_sent
  ON application_attempts(channel,status,sent_at DESC);

CREATE TRIGGER application_attempts_followable_channel
BEFORE INSERT ON outreach_followups
FOR EACH ROW WHEN NEW.source_kind = 'application'
BEGIN
  SELECT RAISE(ABORT,'only email attempts can be followed up')
  WHERE (
    SELECT channel FROM application_attempts WHERE id = NEW.source_attempt_id
  ) <> 'email';
END;
