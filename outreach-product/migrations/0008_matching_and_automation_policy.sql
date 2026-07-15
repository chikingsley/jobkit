CREATE TABLE ai_model_settings_next (
  purpose TEXT PRIMARY KEY CHECK (purpose IN ('application_message','profile_extraction','job_fact_extraction')),
  model_provider TEXT NOT NULL CHECK (model_provider IN ('cerebras','mistral')),
  model_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO ai_model_settings_next (purpose,model_provider,model_id,updated_at)
SELECT purpose,model_provider,model_id,updated_at FROM ai_model_settings;

INSERT INTO ai_model_settings_next (purpose,model_provider,model_id,updated_at)
VALUES ('job_fact_extraction','cerebras','zai-glm-4.7',CURRENT_TIMESTAMP);

DROP TABLE ai_model_settings;
ALTER TABLE ai_model_settings_next RENAME TO ai_model_settings;

ALTER TABLE job_match_facts
ADD COLUMN source_hash TEXT NOT NULL DEFAULT '';

CREATE TABLE user_automation_policies (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','draft','review','auto')),
  allowed_boards_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_boards_json)),
  minimum_fit TEXT NOT NULL DEFAULT 'strong' CHECK (minimum_fit IN ('likely','strong')),
  daily_application_limit INTEGER NOT NULL DEFAULT 1 CHECK (daily_application_limit BETWEEN 1 AND 25),
  require_known_compensation INTEGER NOT NULL DEFAULT 0 CHECK (require_known_compensation IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
