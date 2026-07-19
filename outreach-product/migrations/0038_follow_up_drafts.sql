ALTER TABLE user_automation_policies
ADD COLUMN follow_up_delays_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(follow_up_delays_json));

CREATE TABLE outreach_followups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('application','campaign')),
  source_attempt_id TEXT NOT NULL,
  gmail_thread_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  delay_days INTEGER NOT NULL CHECK (delay_days > 0),
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (
    status IN (
      'scheduled','drafting','review','drafted','sending','sent','failed',
      'uncertain','canceled'
    )
  ),
  message TEXT NOT NULL DEFAULT '',
  change_summary TEXT NOT NULL DEFAULT '',
  model_id TEXT,
  agent_task_request_id TEXT REFERENCES agent_task_requests(id)
    ON DELETE SET NULL,
  gmail_draft_id TEXT NOT NULL DEFAULT '',
  gmail_draft_message_id TEXT NOT NULL DEFAULT '',
  gmail_message_id TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  drafted_at TEXT,
  sent_at TEXT,
  UNIQUE(user_id,gmail_thread_id,ordinal)
);

CREATE INDEX idx_outreach_followups_due
  ON outreach_followups(status,due_at,created_at);

CREATE INDEX idx_outreach_followups_thread
  ON outreach_followups(user_id,gmail_thread_id,ordinal);
