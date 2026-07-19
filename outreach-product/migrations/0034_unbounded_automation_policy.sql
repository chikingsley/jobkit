CREATE TABLE user_automation_policies_next (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_mode TEXT NOT NULL DEFAULT 'review'
    CHECK (email_mode IN ('off','review','auto')),
  email_daily_limit INTEGER NOT NULL DEFAULT 20
    CHECK (email_daily_limit > 0),
  board_form_mode TEXT NOT NULL DEFAULT 'review'
    CHECK (board_form_mode IN ('off','review','auto')),
  board_form_daily_limit INTEGER NOT NULL DEFAULT 10
    CHECK (board_form_daily_limit > 0),
  allowed_boards_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(allowed_boards_json)),
  excluded_market_segments_json TEXT NOT NULL
    DEFAULT '["language_center","training_center"]'
    CHECK (json_valid(excluded_market_segments_json)),
  minimum_fit TEXT NOT NULL DEFAULT 'strong'
    CHECK (minimum_fit IN ('likely','strong')),
  require_known_compensation INTEGER NOT NULL DEFAULT 0
    CHECK (require_known_compensation IN (0,1)),
  route_freshness_days INTEGER NOT NULL DEFAULT 30
    CHECK (route_freshness_days > 0),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO user_automation_policies_next (
  user_id,email_mode,email_daily_limit,board_form_mode,
  board_form_daily_limit,allowed_boards_json,
  excluded_market_segments_json,minimum_fit,require_known_compensation,
  route_freshness_days,paused,created_at,updated_at
)
SELECT
  user_id,email_mode,email_daily_limit,board_form_mode,
  board_form_daily_limit,allowed_boards_json,
  excluded_market_segments_json,minimum_fit,require_known_compensation,
  route_freshness_days,paused,created_at,updated_at
FROM user_automation_policies;

DROP TABLE user_automation_policies;
ALTER TABLE user_automation_policies_next RENAME TO user_automation_policies;
