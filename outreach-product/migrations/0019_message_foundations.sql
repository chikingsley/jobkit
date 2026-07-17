CREATE TABLE user_message_foundations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','archived')),
  voice_rules_json TEXT NOT NULL,
  templates_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  UNIQUE (user_id, version)
);

CREATE UNIQUE INDEX idx_message_foundations_active_user
  ON user_message_foundations(user_id)
  WHERE status='active';

CREATE TABLE user_message_calibration_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  foundation_id TEXT NOT NULL REFERENCES user_message_foundations(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  route TEXT NOT NULL CHECK (
    route IN ('advertised_position','multi_position','school_outreach')
  ),
  rendered_message TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('yes','no')),
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'product',
  decided_at TEXT NOT NULL
);

CREATE INDEX idx_message_calibration_user_foundation
  ON user_message_calibration_decisions(user_id,foundation_id,decided_at);

ALTER TABLE application_drafts
  ADD COLUMN message_foundation_id TEXT REFERENCES user_message_foundations(id);
ALTER TABLE application_drafts ADD COLUMN message_template_key TEXT;
