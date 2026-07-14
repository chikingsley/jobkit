ALTER TABLE user_profiles
ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE user_preferences
ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
