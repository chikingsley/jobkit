UPDATE user_profiles
SET profile_json = json_set(
      profile_json,
      '$.subjectQualifications',
      COALESCE(
        (
          SELECT json_group_array(DISTINCT trim(json_extract(entry.value, '$.field')))
          FROM json_each(profile_json, '$.education') entry
          WHERE trim(COALESCE(json_extract(entry.value, '$.field'), '')) <> ''
        ),
        json('[]')
      )
    ),
    schema_version = 4
WHERE schema_version = 3;
