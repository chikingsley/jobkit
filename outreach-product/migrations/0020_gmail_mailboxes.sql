CREATE TABLE gmail_mailbox_watches (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL UNIQUE,
  history_id TEXT NOT NULL,
  expiration_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active','error','expired')
  ),
  last_synced_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_gmail_mailbox_watches_expiration
  ON gmail_mailbox_watches(status,expiration_at);

CREATE TABLE gmail_pubsub_events (
  message_id TEXT PRIMARY KEY,
  email_address TEXT NOT NULL,
  history_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  messages_recorded INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_gmail_pubsub_events_processed
  ON gmail_pubsub_events(processed_at DESC);
