UPDATE ai_model_settings
SET model_provider = 'cerebras',
    model_id = 'gemma-4-31b',
    updated_at = CURRENT_TIMESTAMP
WHERE purpose = 'job_fact_extraction';
