ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'
  CHECK (role IN ('member', 'operator'));

-- Accounts created before the public/member split belong to the existing
-- owner-operated workspace. New accounts keep the member default.
UPDATE users SET role = 'operator';
