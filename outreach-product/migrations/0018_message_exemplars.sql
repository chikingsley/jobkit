-- Real outreach emails the candidate sent, labeled by outcome, used as
-- voice/shape exemplars during application-message generation. Imported from
-- the recovered sent-mail corpus; outcome_grade: 3 offer, 2 interview,
-- 1 replied, 0 none.
CREATE TABLE message_exemplars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'corpus',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  template_variant TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'none',
  outcome_grade INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_message_exemplars_user_grade
  ON message_exemplars(user_id, outcome_grade DESC, sent_at DESC);
