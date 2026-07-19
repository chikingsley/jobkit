UPDATE user_preferences
SET
  preferences_json=json_set(
    preferences_json,
    '$.roles',
    json_object(
      'early_childhood','accept',
      'english_language','prefer',
      'homeroom','accept',
      'leadership','exclude',
      'student_support','exclude',
      'subject_specialist','exclude',
      'other','avoid'
    )
  ),
  schema_version=3
WHERE schema_version=2;
