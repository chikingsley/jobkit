CREATE TABLE ai_model_settings (
  purpose TEXT PRIMARY KEY CHECK (purpose IN ('application_message','profile_extraction')),
  model_provider TEXT NOT NULL CHECK (model_provider IN ('cerebras', 'mistral')),
  model_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO ai_model_settings (purpose, model_provider, model_id, updated_at)
VALUES ('application_message', 'cerebras', 'gemma-4-31b', CURRENT_TIMESTAMP);

INSERT INTO ai_model_settings (purpose, model_provider, model_id, updated_at)
VALUES ('profile_extraction', 'cerebras', 'gpt-oss-120b', CURRENT_TIMESTAMP);
