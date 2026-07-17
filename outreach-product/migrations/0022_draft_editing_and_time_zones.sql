ALTER TABLE application_drafts
ADD COLUMN revision_source TEXT NOT NULL DEFAULT 'generated'
CHECK (revision_source IN ('generated','ai_revision','manual_edit','undo'));

UPDATE application_drafts
SET revision_source = 'ai_revision'
WHERE revision_instruction <> '';

CREATE TABLE user_time_zones (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  time_zone TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
