CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  organization_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'unknown' CHECK (
    role IN ('board_intermediary','recruiter','employer','unknown')
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active','stale','invalid')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE contact_channels (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('email','phone')),
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active','stale','invalid')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind,normalized_value)
);

CREATE INDEX idx_contact_channels_contact_status
  ON contact_channels(contact_id,status,kind);

ALTER TABLE application_routes ADD COLUMN contact_channel_id TEXT
  REFERENCES contact_channels(id) ON DELETE SET NULL;

CREATE INDEX idx_application_routes_contact_channel
  ON application_routes(contact_channel_id,status,updated_at DESC);

WITH email_routes AS (
  SELECT
    lower(trim(destination)) normalized_email,
    MIN(created_at) created_at,
    MAX(updated_at) updated_at
  FROM application_routes
  WHERE kind='email' AND trim(destination)<>''
  GROUP BY lower(trim(destination))
)
INSERT INTO contacts (
  id,display_name,organization_name,role,status,created_at,updated_at
)
SELECT
  'contact:email:' || lower(hex(normalized_email)),
  '',
  '',
  CASE normalized_email
    WHEN 'hr@anesl.com' THEN 'board_intermediary'
    ELSE 'unknown'
  END,
  'active',
  created_at,
  updated_at
FROM email_routes;

WITH email_routes AS (
  SELECT
    lower(trim(destination)) normalized_email,
    MIN(created_at) created_at,
    MAX(updated_at) updated_at
  FROM application_routes
  WHERE kind='email' AND trim(destination)<>''
  GROUP BY lower(trim(destination))
)
INSERT INTO contact_channels (
  id,contact_id,kind,value,normalized_value,status,created_at,updated_at
)
SELECT
  'contact-channel:email:' || lower(hex(normalized_email)),
  'contact:email:' || lower(hex(normalized_email)),
  'email',
  normalized_email,
  normalized_email,
  'active',
  created_at,
  updated_at
FROM email_routes;

UPDATE application_routes
SET contact_channel_id=(
  SELECT cc.id
  FROM contact_channels cc
  WHERE cc.kind='email'
    AND cc.normalized_value=lower(trim(application_routes.destination))
)
WHERE kind='email' AND trim(destination)<>'';

UPDATE contacts
SET
  display_name=COALESCE((
    SELECT CASE
      WHEN COUNT(DISTINCT NULLIF(trim(j.contact_name),''))=1
      THEN MAX(NULLIF(trim(j.contact_name),''))
      ELSE ''
    END
    FROM contact_channels cc
    JOIN application_routes ar ON ar.contact_channel_id=cc.id
    JOIN jobs j ON j.id=ar.job_id
    WHERE cc.contact_id=contacts.id
  ),''),
  organization_name=COALESCE((
    SELECT CASE
      WHEN COUNT(DISTINCT NULLIF(trim(j.company),''))=1
      THEN MAX(NULLIF(trim(j.company),''))
      ELSE ''
    END
    FROM contact_channels cc
    JOIN application_routes ar ON ar.contact_channel_id=cc.id
    JOIN jobs j ON j.id=ar.job_id
    WHERE cc.contact_id=contacts.id
  ),'');
