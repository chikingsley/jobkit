ALTER TABLE jobs ADD COLUMN contact_name TEXT NOT NULL DEFAULT '';

CREATE TABLE ai_model_settings_next (
  purpose TEXT PRIMARY KEY CHECK (
    purpose IN ('application_message','profile_extraction','job_fact_extraction')
  ),
  model_provider TEXT NOT NULL CHECK (
    model_provider IN ('cerebras','llamacpp','mistral')
  ),
  model_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO ai_model_settings_next (purpose,model_provider,model_id,updated_at)
SELECT purpose,model_provider,model_id,updated_at FROM ai_model_settings;

DROP TABLE ai_model_settings;
ALTER TABLE ai_model_settings_next RENAME TO ai_model_settings;
