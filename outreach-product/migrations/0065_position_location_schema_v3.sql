UPDATE job_position_variants
SET locations_json = COALESCE(
  (
    SELECT json_group_array(
      json_object(
        'addressComponents', json('[]'),
        'evidence', json_extract(location.value, '$.evidence'),
        'parentGeographies', json('[]'),
        'role', 'unknown',
        'scope', 'unknown',
        'semanticKind', 'unknown',
        'value', json_extract(location.value, '$.value'),
        'workplaceType', 'unknown'
      )
    )
    FROM json_each(job_position_variants.locations_json) location
  ),
  '[]'
)
WHERE job_id IN (
  SELECT job_id
  FROM job_position_analyses
  WHERE schema_version = 2
);

UPDATE job_position_analyses
SET schema_version = 3
WHERE schema_version = 2;
