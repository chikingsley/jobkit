CREATE TABLE user_profiles (
  id TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_preferences (
  id TEXT PRIMARY KEY,
  preferences_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_documents (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
