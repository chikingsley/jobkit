ALTER TABLE jobs ADD COLUMN opportunity_scope TEXT NOT NULL DEFAULT 'unknown'
  CHECK (opportunity_scope IN ('direct','multi_position','unknown'));

ALTER TABLE jobs ADD COLUMN market_segments_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(market_segments_json));
