CREATE TABLE user_automation_policies_next (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_mode TEXT NOT NULL DEFAULT 'review'
    CHECK (email_mode IN ('off','review','auto')),
  email_daily_limit INTEGER NOT NULL DEFAULT 20
    CHECK (email_daily_limit BETWEEN 1 AND 100),
  board_form_mode TEXT NOT NULL DEFAULT 'review'
    CHECK (board_form_mode IN ('off','review','auto')),
  board_form_daily_limit INTEGER NOT NULL DEFAULT 10
    CHECK (board_form_daily_limit BETWEEN 1 AND 100),
  allowed_boards_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(allowed_boards_json)),
  excluded_market_segments_json TEXT NOT NULL DEFAULT '["language_center","training_center"]'
    CHECK (json_valid(excluded_market_segments_json)),
  minimum_fit TEXT NOT NULL DEFAULT 'strong'
    CHECK (minimum_fit IN ('likely','strong')),
  require_known_compensation INTEGER NOT NULL DEFAULT 0
    CHECK (require_known_compensation IN (0,1)),
  route_freshness_days INTEGER NOT NULL DEFAULT 30
    CHECK (route_freshness_days BETWEEN 1 AND 90),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO user_automation_policies_next (
  user_id,
  email_mode,
  email_daily_limit,
  board_form_mode,
  board_form_daily_limit,
  allowed_boards_json,
  minimum_fit,
  require_known_compensation,
  created_at,
  updated_at
)
SELECT
  user_id,
  CASE mode WHEN 'auto' THEN 'auto' WHEN 'off' THEN 'off' ELSE 'review' END,
  daily_application_limit,
  CASE mode WHEN 'auto' THEN 'auto' WHEN 'off' THEN 'off' ELSE 'review' END,
  daily_application_limit,
  allowed_boards_json,
  minimum_fit,
  require_known_compensation,
  created_at,
  updated_at
FROM user_automation_policies;

DROP TABLE user_automation_policies;
ALTER TABLE user_automation_policies_next RENAME TO user_automation_policies;

ALTER TABLE jobs ADD COLUMN message_route TEXT NOT NULL DEFAULT 'advertised_position'
  CHECK (message_route IN ('advertised_position','multi_position','school_outreach'));

CREATE TABLE country_sweeps (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL CHECK (length(country_code)=2),
  country_name TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','claimed','running','completed','failed','canceled')),
  requested_scope_json TEXT NOT NULL CHECK (json_valid(requested_scope_json)),
  coverage_summary_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(coverage_summary_json)),
  error_detail TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_country_sweeps_country_status
  ON country_sweeps(country_code,status,requested_at DESC);
CREATE INDEX idx_country_sweeps_requester
  ON country_sweeps(requested_by_user_id,requested_at DESC);

CREATE TABLE country_sweep_tasks (
  id TEXT PRIMARY KEY,
  sweep_id TEXT NOT NULL REFERENCES country_sweeps(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('discovery','verification','coverage_audit')),
  scope_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','claimed','completed','failed')),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
  worker_id TEXT,
  claimed_at TEXT,
  lease_expires_at TEXT,
  completed_at TEXT,
  error_detail TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(sweep_id,phase,scope_key)
);

CREATE INDEX idx_country_sweep_tasks_claim
  ON country_sweep_tasks(status,phase,created_at);

CREATE TABLE country_sweep_runner_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_country_sweep_runner_tokens_user
  ON country_sweep_runner_tokens(user_id,created_at DESC);

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL CHECK (length(country_code)=2),
  country_name TEXT NOT NULL,
  name TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  canonical_domain TEXT NOT NULL DEFAULT '',
  market_segment TEXT NOT NULL DEFAULT 'school' CHECK (
    market_segment IN (
      'international_school','kindergarten','language_center','private_school',
      'public_school','school','training_center','university'
    )
  ),
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified','active','stale','closed','invalid')),
  outreach_eligibility TEXT NOT NULL DEFAULT 'review'
    CHECK (outreach_eligibility IN ('eligible','review','excluded')),
  evidence_url TEXT NOT NULL DEFAULT '',
  source_sweep_id TEXT REFERENCES country_sweeps(id) ON DELETE SET NULL,
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_organizations_country_status
  ON organizations(country_code,status,outreach_eligibility,name);
CREATE UNIQUE INDEX idx_organizations_country_identity
  ON organizations(country_code,identity_key);
CREATE UNIQUE INDEX idx_organizations_country_domain
  ON organizations(country_code,canonical_domain)
  WHERE canonical_domain<>'';

CREATE TABLE organization_contact_points (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (
    kind IN ('email','phone','contact_form','careers_page','website')
  ),
  label TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified','active','stale','invalid')),
  evidence_url TEXT NOT NULL DEFAULT '',
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id,kind,value)
);

CREATE INDEX idx_organization_contacts_org_status
  ON organization_contact_points(organization_id,status,kind);

CREATE TABLE organization_opportunities (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  evidence_url TEXT NOT NULL DEFAULT '',
  linked_at TEXT NOT NULL,
  PRIMARY KEY (organization_id,job_id)
);

CREATE TABLE country_campaigns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL CHECK (length(country_code)=2),
  country_name TEXT NOT NULL,
  sweep_id TEXT REFERENCES country_sweeps(id) ON DELETE SET NULL,
  execution_mode TEXT NOT NULL CHECK (
    execution_mode IN ('research_only','review_each','use_automation')
  ),
  include_open_positions INTEGER NOT NULL CHECK (include_open_positions IN (0,1)),
  include_school_outreach INTEGER NOT NULL CHECK (include_school_outreach IN (0,1)),
  policy_snapshot_json TEXT NOT NULL CHECK (json_valid(policy_snapshot_json)),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','running','paused','completed','canceled')),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (include_open_positions=1 OR include_school_outreach=1)
);

CREATE INDEX idx_country_campaigns_user_country
  ON country_campaigns(user_id,country_code,created_at DESC);

CREATE TABLE country_campaign_targets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES country_campaigns(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  route_id TEXT REFERENCES application_routes(id) ON DELETE SET NULL,
  contact_point_id TEXT REFERENCES organization_contact_points(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','board_form','external_url','manual')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','review','approved','sent','held','skipped','failed','replied')),
  hold_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (job_id IS NOT NULL AND organization_id IS NULL) OR
    (job_id IS NULL AND organization_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_campaign_targets_job
  ON country_campaign_targets(campaign_id,job_id,channel)
  WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX idx_campaign_targets_organization
  ON country_campaign_targets(campaign_id,organization_id,channel)
  WHERE organization_id IS NOT NULL;
CREATE INDEX idx_campaign_targets_status
  ON country_campaign_targets(campaign_id,status,channel);
