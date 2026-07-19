CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'preparing','draft','calibrating','ready','running','paused','completed',
      'canceled'
    )
  ),
  daily_pace INTEGER NOT NULL CHECK (daily_pace > 0),
  stop_after_human_replies INTEGER NOT NULL CHECK (
    stop_after_human_replies > 0
  ),
  posted_target_percent INTEGER NOT NULL CHECK (
    posted_target_percent BETWEEN 0 AND 100
  ),
  first_five_required INTEGER NOT NULL DEFAULT 1 CHECK (
    first_five_required IN (0,1)
  ),
  first_five_completed_at TEXT,
  human_reply_count INTEGER NOT NULL DEFAULT 0 CHECK (human_reply_count >= 0),
  policy_snapshot_json TEXT NOT NULL CHECK (json_valid(policy_snapshot_json)),
  pause_reason TEXT NOT NULL DEFAULT '',
  next_run_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_campaigns_user_status
  ON campaigns(user_id,status,updated_at DESC);

CREATE TABLE campaign_markets (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL CHECK (length(country_code)=2),
  country_name TEXT NOT NULL,
  sweep_id TEXT REFERENCES country_sweeps(id) ON DELETE SET NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id,country_code)
);

CREATE INDEX idx_campaign_markets_country
  ON campaign_markets(country_code,campaign_id);

CREATE TABLE campaign_targets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL CHECK (length(country_code)=2),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('advertised','school')),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('job','organization')),
  subject_id TEXT NOT NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  route_id TEXT REFERENCES application_routes(id) ON DELETE SET NULL,
  contact_point_id TEXT REFERENCES organization_contact_points(id)
    ON DELETE SET NULL,
  contact_channel_id TEXT REFERENCES contact_channels(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (
    channel IN ('email','board_form','external_url','manual')
  ),
  route_strategy TEXT NOT NULL DEFAULT 'single' CHECK (
    route_strategy IN ('single','anesl_bundle')
  ),
  dedup_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'eligible' CHECK (
    status IN (
      'eligible','calibration','ready','claimed','drafted','approved','sent',
      'held','skipped','failed','replied'
    )
  ),
  hold_reason TEXT NOT NULL DEFAULT '',
  match_label TEXT NOT NULL DEFAULT '',
  match_score INTEGER,
  match_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(match_snapshot_json)
  ),
  admitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (subject_kind='job' AND job_id=subject_id AND organization_id IS NULL) OR
    (subject_kind='organization' AND organization_id=subject_id AND job_id IS NULL)
  ),
  UNIQUE(campaign_id,subject_kind,subject_id)
);

CREATE INDEX idx_campaign_targets_campaign_status
  ON campaign_targets(campaign_id,status,source_kind,admitted_at);
CREATE INDEX idx_campaign_targets_campaign_dedup
  ON campaign_targets(campaign_id,dedup_key,route_strategy);

CREATE TABLE campaign_runs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  daily_pace INTEGER NOT NULL CHECK (daily_pace > 0),
  posted_target_percent INTEGER NOT NULL CHECK (
    posted_target_percent BETWEEN 0 AND 100
  ),
  status TEXT NOT NULL CHECK (
    status IN ('planning','generating','delivering','completed','failed')
  ),
  planned_dispatch_count INTEGER NOT NULL DEFAULT 0 CHECK (
    planned_dispatch_count >= 0
  ),
  sent_dispatch_count INTEGER NOT NULL DEFAULT 0 CHECK (
    sent_dispatch_count >= 0
  ),
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(campaign_id,scheduled_for)
);

CREATE INDEX idx_campaign_runs_campaign
  ON campaign_runs(campaign_id,scheduled_for DESC);

CREATE TABLE campaign_dispatches (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES campaign_runs(id) ON DELETE SET NULL,
  dedup_key TEXT NOT NULL,
  route_strategy TEXT NOT NULL CHECK (
    route_strategy IN ('single','anesl_bundle')
  ),
  channel TEXT NOT NULL CHECK (
    channel IN ('email','board_form','external_url','manual')
  ),
  recipient TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (
    status IN (
      'calibration','queued','drafting','review','ready','claimed','sending',
      'sent','failed','uncertain','replied','canceled'
    )
  ),
  scheduled_for TEXT,
  application_attempt_id TEXT REFERENCES application_attempts(id)
    ON DELETE SET NULL,
  application_bundle_id TEXT REFERENCES application_bundles(id)
    ON DELETE SET NULL,
  document_packet_id TEXT REFERENCES user_document_packets(id)
    ON DELETE SET NULL,
  document_packet_name TEXT NOT NULL DEFAULT '',
  document_packet_slug TEXT NOT NULL DEFAULT '',
  document_packet_manifest_json TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(document_packet_manifest_json)
  ),
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id,dedup_key)
);

CREATE INDEX idx_campaign_dispatches_due
  ON campaign_dispatches(campaign_id,status,scheduled_for,created_at);

CREATE TABLE campaign_dispatch_targets (
  dispatch_id TEXT NOT NULL REFERENCES campaign_dispatches(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES campaign_targets(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 4),
  PRIMARY KEY (dispatch_id,target_id),
  UNIQUE(dispatch_id,ordinal),
  UNIQUE(target_id)
);

CREATE TABLE campaign_messages (
  id TEXT PRIMARY KEY,
  dispatch_id TEXT NOT NULL REFERENCES campaign_dispatches(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  message TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  revision_instruction TEXT NOT NULL DEFAULT '',
  revision_source TEXT NOT NULL CHECK (
    revision_source IN ('generated','ai_revision','manual_edit','undo')
  ),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft','approved','superseded','sent')
  ),
  model_id TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  UNIQUE(dispatch_id,version)
);

CREATE INDEX idx_campaign_messages_current
  ON campaign_messages(dispatch_id,status,version DESC);

CREATE TABLE campaign_dispatch_attachments (
  dispatch_id TEXT NOT NULL REFERENCES campaign_dispatches(id)
    ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  source_document_id TEXT NOT NULL REFERENCES user_documents(id)
    ON DELETE RESTRICT,
  category TEXT NOT NULL,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  r2_version TEXT NOT NULL,
  etag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(dispatch_id,position),
  UNIQUE(dispatch_id,source_document_id)
);

CREATE INDEX idx_campaign_dispatch_attachments_document
  ON campaign_dispatch_attachments(source_document_id);

CREATE TABLE campaign_guidance (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source_dispatch_id TEXT REFERENCES campaign_dispatches(id) ON DELETE SET NULL,
  instruction TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('message','campaign','future')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (
    status IN ('proposed','accepted','rejected')
  ),
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE INDEX idx_campaign_guidance_campaign
  ON campaign_guidance(campaign_id,status,created_at);

CREATE TABLE outbound_recipient_claims (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedup_key TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('application_attempt','campaign_dispatch')
  ),
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed','sent','released')),
  lease_expires_at TEXT,
  claimed_at TEXT NOT NULL,
  sent_at TEXT,
  released_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,dedup_key),
  UNIQUE(source_kind,source_id)
);

CREATE INDEX idx_outbound_recipient_claims_source
  ON outbound_recipient_claims(source_kind,source_id,status);

INSERT OR IGNORE INTO outbound_recipient_claims (
  id,user_id,dedup_key,source_kind,source_id,status,claimed_at,sent_at,
  updated_at
)
SELECT
  lower(hex(randomblob(16))),uj.user_id,
  CASE
    WHEN ar.contact_channel_id IS NOT NULL
      THEN 'contact:' || ar.contact_channel_id
    ELSE 'email:' || lower(trim(a.recipient))
  END,
  'application_attempt',a.id,
  CASE WHEN a.status='sent' THEN 'sent' ELSE 'claimed' END,
  COALESCE(a.claimed_at,a.approved_at,a.created_at),a.sent_at,a.updated_at
FROM application_attempts a
JOIN user_jobs uj ON uj.id=a.user_job_id
JOIN application_routes ar ON ar.id=a.route_id
WHERE a.status IN ('approved','claimed','drafted','sending','sent','uncertain')
ORDER BY CASE a.status WHEN 'sent' THEN 0 ELSE 1 END,a.created_at;

CREATE TABLE campaign_email_attempts (
  id TEXT PRIMARY KEY,
  dispatch_id TEXT NOT NULL UNIQUE REFERENCES campaign_dispatches(id)
    ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (
    status IN ('approved','claimed','drafted','sending','sent','failed','uncertain')
  ),
  gmail_draft_id TEXT NOT NULL DEFAULT '',
  gmail_draft_message_id TEXT NOT NULL DEFAULT '',
  gmail_message_id TEXT NOT NULL DEFAULT '',
  gmail_thread_id TEXT NOT NULL DEFAULT '',
  error_stage TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  approved_at TEXT NOT NULL,
  claimed_at TEXT,
  drafted_at TEXT,
  sending_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_campaign_email_attempts_status
  ON campaign_email_attempts(status,updated_at);

CREATE TABLE campaign_delivery_authorizations (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  authorized_scope TEXT NOT NULL DEFAULT 'none' CHECK (
    authorized_scope IN ('none','campaigns')
  ),
  authorized_at TEXT,
  authorized_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE campaign_reply_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  dispatch_id TEXT REFERENCES campaign_dispatches(id) ON DELETE SET NULL,
  gmail_thread_id TEXT NOT NULL DEFAULT '',
  gmail_message_id TEXT NOT NULL DEFAULT '',
  classification TEXT NOT NULL CHECK (
    classification IN ('human','automated','vacation','bounce')
  ),
  counts_toward_pause INTEGER NOT NULL CHECK (counts_toward_pause IN (0,1)),
  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(evidence_json)),
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(campaign_id,gmail_message_id)
);

CREATE INDEX idx_campaign_reply_events_campaign
  ON campaign_reply_events(campaign_id,received_at DESC);

ALTER TABLE application_thread_messages
ADD COLUMN classification TEXT NOT NULL DEFAULT 'human' CHECK (
  classification IN ('human','automated','vacation','bounce')
);

CREATE TABLE campaign_target_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES campaign_targets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_campaign_target_events_v2_target
  ON campaign_target_events(target_id,created_at DESC);
CREATE INDEX idx_campaign_target_events_v2_campaign
  ON campaign_target_events(campaign_id,created_at DESC);

INSERT INTO campaigns (
  id,user_id,name,status,daily_pace,stop_after_human_replies,
  posted_target_percent,first_five_required,policy_snapshot_json,pause_reason,
  created_at,started_at,completed_at,updated_at
)
SELECT
  id,user_id,country_name || ' campaign',
  CASE status
    WHEN 'planned' THEN 'draft'
    WHEN 'running' THEN 'running'
    WHEN 'paused' THEN 'paused'
    WHEN 'completed' THEN 'completed'
    ELSE 'canceled'
  END,
  MAX(1,COALESCE(json_extract(policy_snapshot_json,'$.email.dailyLimit'),1)),
  3,
  80,
  1,
  policy_snapshot_json,
  '',
  created_at,started_at,completed_at,updated_at
FROM country_campaigns
WHERE execution_mode<>'research_only';

INSERT INTO campaign_markets (
  campaign_id,country_code,country_name,sweep_id,added_at
)
SELECT id,country_code,country_name,sweep_id,created_at
FROM country_campaigns
WHERE execution_mode<>'research_only';

INSERT INTO campaign_targets (
  id,campaign_id,country_code,source_kind,subject_kind,subject_id,job_id,
  organization_id,route_id,contact_point_id,contact_channel_id,channel,
  route_strategy,dedup_key,status,hold_reason,admitted_at,updated_at
)
SELECT
  t.id,t.campaign_id,c.country_code,
  CASE WHEN t.job_id IS NOT NULL THEN 'advertised' ELSE 'school' END,
  CASE WHEN t.job_id IS NOT NULL THEN 'job' ELSE 'organization' END,
  COALESCE(t.job_id,t.organization_id),t.job_id,t.organization_id,t.route_id,
  t.contact_point_id,ar.contact_channel_id,t.channel,
  CASE WHEN lower(j.board)='anesl' THEN 'anesl_bundle' ELSE 'single' END,
  CASE
    WHEN ar.contact_channel_id IS NOT NULL THEN 'contact:' || ar.contact_channel_id
    WHEN t.contact_point_id IS NOT NULL THEN 'school-contact:' || t.contact_point_id
    WHEN t.job_id IS NOT NULL THEN 'job:' || t.job_id
    ELSE 'organization:' || t.organization_id
  END,
  CASE t.status
    WHEN 'pending' THEN 'eligible'
    WHEN 'review' THEN 'calibration'
    WHEN 'approved' THEN 'ready'
    WHEN 'sent' THEN 'sent'
    WHEN 'held' THEN 'held'
    WHEN 'skipped' THEN 'skipped'
    WHEN 'failed' THEN 'failed'
    WHEN 'replied' THEN 'replied'
    ELSE 'eligible'
  END,
  t.hold_reason,t.created_at,t.updated_at
FROM country_campaign_targets t
JOIN country_campaigns c ON c.id=t.campaign_id
LEFT JOIN application_routes ar ON ar.id=t.route_id
LEFT JOIN jobs j ON j.id=t.job_id
WHERE c.execution_mode<>'research_only';

INSERT INTO campaign_target_events (
  id,campaign_id,target_id,user_id,previous_status,next_status,reason,created_at
)
SELECT
  e.id,e.campaign_id,e.target_id,e.user_id,
  CASE e.previous_status
    WHEN 'pending' THEN 'eligible'
    WHEN 'review' THEN 'calibration'
    WHEN 'approved' THEN 'ready'
    ELSE e.previous_status
  END,
  CASE e.next_status
    WHEN 'pending' THEN 'eligible'
    WHEN 'review' THEN 'calibration'
    WHEN 'approved' THEN 'ready'
    ELSE e.next_status
  END,
  e.reason,e.created_at
FROM country_campaign_target_events e
JOIN campaigns c ON c.id=e.campaign_id;

DROP TABLE country_campaign_target_events;
DROP TABLE country_campaign_targets;
DROP TABLE country_campaigns;
