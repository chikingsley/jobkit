-- Auditable history for the live campaign delivery authorization lock.
-- campaign_delivery_authorizations (0033) keeps only the current state, so
-- every operator toggle also records an immutable event row here.

CREATE TABLE campaign_delivery_authorization_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acting_user_id TEXT NOT NULL CHECK (trim(acting_user_id)<>''),
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  authorized_scope TEXT NOT NULL CHECK (authorized_scope IN ('campaigns')),
  reason TEXT NOT NULL CHECK (trim(reason)<>''),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_campaign_delivery_authorization_events_user
  ON campaign_delivery_authorization_events(user_id,created_at DESC);
