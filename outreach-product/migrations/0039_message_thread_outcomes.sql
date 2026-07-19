CREATE TABLE message_thread_outcomes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN (
      'interested','interview','offer','declined','withdrawn','bounced',
      'no_response'
    )
  ),
  note TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,gmail_thread_id)
);

CREATE INDEX idx_message_thread_outcomes_user
  ON message_thread_outcomes(user_id,outcome,updated_at DESC);
