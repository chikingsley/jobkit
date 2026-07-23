UPDATE job_position_analyses
SET schema_version = 2
WHERE schema_version = 3
  AND NOT EXISTS (
    SELECT 1
    FROM agent_task_runs task
    WHERE task.task_type = 'job.position_analysis'
      AND task.prompt_version = 'job-position-analysis-v3'
      AND task.source_task_id = job_position_analyses.job_id
      AND task.source_hash = job_position_analyses.source_hash
      AND task.status = 'completed'
  );
