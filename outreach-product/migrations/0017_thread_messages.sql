-- Inbound email messages synced from Gmail by the local bridge. Outbound
-- application emails remain application_attempts rows; a thread is stitched
-- together by gmail_thread_id.
CREATE TABLE application_thread_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  gmail_message_id TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound','outbound')),
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, gmail_message_id)
);

CREATE INDEX idx_thread_messages_user_thread
  ON application_thread_messages(user_id, gmail_thread_id, sent_at);
