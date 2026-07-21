ALTER TABLE profile_imports
ADD COLUMN proposal_schema_version INTEGER NOT NULL DEFAULT 1;

UPDATE profile_imports
SET
  proposal_json = json_set(
    proposal_json,
    '$.subjectQualifications',
    json('[]')
  ),
  proposal_schema_version = 2
WHERE proposal_json IS NOT NULL
  AND proposal_schema_version = 1;
