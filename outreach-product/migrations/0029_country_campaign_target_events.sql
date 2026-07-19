CREATE TABLE country_campaign_target_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES country_campaigns(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES country_campaign_targets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  previous_status TEXT NOT NULL CHECK (
    previous_status IN (
      'pending','review','approved','sent','held','skipped','failed','replied'
    )
  ),
  next_status TEXT NOT NULL CHECK (
    next_status IN ('review','approved','held')
  ),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_campaign_target_events_target
  ON country_campaign_target_events(target_id,created_at DESC);

CREATE INDEX idx_campaign_target_events_campaign
  ON country_campaign_target_events(campaign_id,created_at DESC);
