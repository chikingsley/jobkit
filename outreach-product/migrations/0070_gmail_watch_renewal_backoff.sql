-- Gmail watch renewals previously retried every non-active watch each cron
-- minute forever, so a revoked refresh token became a permanent failing
-- Google API call. Renewals now count consecutive failures, back off between
-- attempts, and park auth-dead watches in a terminal 'revoked' status that
-- only a reconnect clears. SQLite cannot extend a CHECK in place, so the
-- table is rebuilt.
CREATE TABLE gmail_mailbox_watches_v2 (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL UNIQUE,
  history_id TEXT NOT NULL,
  expiration_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active','error','expired','revoked')
  ),
  renewal_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (
    renewal_failure_count>=0
  ),
  renewal_auth_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (
    renewal_auth_failure_count>=0
  ),
  next_renewal_attempt_at TEXT,
  last_synced_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO gmail_mailbox_watches_v2
  (user_id,email_address,history_id,expiration_at,status,last_synced_at,
   last_error,created_at,updated_at)
SELECT user_id,email_address,history_id,expiration_at,status,last_synced_at,
       last_error,created_at,updated_at
  FROM gmail_mailbox_watches;

DROP TABLE gmail_mailbox_watches;

ALTER TABLE gmail_mailbox_watches_v2 RENAME TO gmail_mailbox_watches;

CREATE INDEX idx_gmail_mailbox_watches_expiration
  ON gmail_mailbox_watches(status,expiration_at);
