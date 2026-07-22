UPDATE user_profiles
SET profile_json = json_set(
      profile_json,
      '$.workExperience',
      COALESCE(
        (
          SELECT json_group_array(
            json_set(
              json(entry.value),
              '$.messageAttribution',
              'describe',
              '$.messageHighlights',
              COALESCE(json_extract(entry.value, '$.highlights'), json('[]'))
            )
          )
          FROM json_each(profile_json, '$.workExperience') entry
        ),
        json('[]')
      )
    ),
    schema_version = 5
WHERE schema_version = 4;
