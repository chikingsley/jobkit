UPDATE ai_model_settings
SET model_provider = 'cerebras',
    model_id = 'gpt-oss-120b',
    updated_at = CURRENT_TIMESTAMP
WHERE purpose = 'job_fact_extraction';
