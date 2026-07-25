-- Baseline schema captured from the verified production restore (168 tables,
-- 219 triggers). Replaces the 74 incremental migrations as the single starting
-- point; Drizzle generates every migration from here on.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL,
  image TEXT,
  created_at DATE NOT NULL,
  updated_at DATE NOT NULL
, role TEXT NOT NULL DEFAULT 'member'
  CHECK (role IN ('member', 'operator')));
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  expires_at DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at DATE NOT NULL,
  updated_at DATE NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE user_accounts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at DATE,
  refresh_token_expires_at DATE,
  scope TEXT,
  password TEXT,
  created_at DATE NOT NULL,
  updated_at DATE NOT NULL
);
CREATE TABLE auth_verifications (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at DATE NOT NULL,
  created_at DATE NOT NULL,
  updated_at DATE NOT NULL
);
CREATE TABLE "job_listings" (
  id TEXT PRIMARY KEY,
  board TEXT NOT NULL DEFAULT 'seriousteachers',
  title TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  salary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  apply_url TEXT NOT NULL,
  employer_id TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  compensation_display TEXT NOT NULL DEFAULT 'Salary not listed',
  compensation_amount_min INTEGER,
  compensation_amount_max INTEGER,
  compensation_currency TEXT,
  compensation_period TEXT CHECK (compensation_period IN ('hour','month','year')),
  compensation_qualifier TEXT CHECK (compensation_qualifier IN ('exact','range','up-to','from')),
  compensation_source TEXT NOT NULL DEFAULT 'unknown' CHECK (compensation_source IN ('listing-field','listing-description','curated-review','unknown')),
  compensation_confidence TEXT NOT NULL DEFAULT 'unknown' CHECK (compensation_confidence IN ('exact','inferred','conflict','unknown')),
  compensation_notes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(compensation_notes_json))
, opportunity_scope TEXT NOT NULL DEFAULT 'unknown'
  CHECK (opportunity_scope IN ('direct','multi_position','unknown')), market_segments_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(market_segments_json)), message_route TEXT NOT NULL DEFAULT 'advertised_position'
  CHECK (message_route IN ('advertised_position','multi_position','school_outreach')), contact_name TEXT NOT NULL DEFAULT '', source_reference TEXT NOT NULL DEFAULT '', inventory_source_id TEXT
  REFERENCES inventory_sources(id) ON DELETE SET NULL, inventory_status TEXT NOT NULL DEFAULT 'active'
  CHECK (inventory_status IN ('active','closed')), source_last_seen_at TEXT, source_content_hash TEXT NOT NULL DEFAULT '', inventory_run_id TEXT
  REFERENCES inventory_runs(id) ON DELETE SET NULL, source_posted_date TEXT, source_posted_date_raw TEXT NOT NULL
  DEFAULT '', source_posted_date_provenance TEXT NOT NULL
  DEFAULT 'unknown'
  CHECK (source_posted_date_provenance IN (
    'board-published','unresolved','unknown'
  )), source_expiry_date TEXT, source_expiry_date_raw TEXT NOT NULL
  DEFAULT '', source_expiry_date_provenance TEXT NOT NULL
  DEFAULT 'unknown'
  CHECK (source_expiry_date_provenance IN (
    'board-published','unresolved','unknown'
  )), material_hash TEXT NOT NULL DEFAULT '', material_hash_version INTEGER NOT NULL
  DEFAULT 0 CHECK (material_hash_version >= 0), material_version INTEGER NOT NULL
  DEFAULT 1 CHECK (material_version > 0), material_changed_at TEXT NOT NULL
  DEFAULT '', source_fields_json TEXT NOT NULL DEFAULT '');
CREATE TABLE "user_listing_states" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES "job_listings"(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','review','approved','submitting','applied','ignored','failed')),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,job_id)
);
CREATE TABLE "application_drafts" (
  id TEXT PRIMARY KEY,
  user_job_id TEXT NOT NULL REFERENCES "user_listing_states"(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  message TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  revision_instruction TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded','submitted')),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  submitted_at TEXT,
  model_provider TEXT,
  model_id TEXT, document_packet_id TEXT REFERENCES user_document_packets(id) ON DELETE SET NULL, document_packet_name TEXT NOT NULL DEFAULT '', document_packet_slug TEXT NOT NULL DEFAULT '', document_packet_manifest_json TEXT NOT NULL DEFAULT '[]'
CHECK (json_valid(document_packet_manifest_json)), message_foundation_id TEXT REFERENCES user_message_foundations(id), message_template_key TEXT, revision_source TEXT NOT NULL DEFAULT 'generated'
CHECK (revision_source IN ('generated','ai_revision','manual_edit','undo')), application_bundle_id TEXT
  REFERENCES application_bundles(id) ON DELETE SET NULL, required_opening TEXT NOT NULL DEFAULT 'Hello,',
  UNIQUE(user_job_id,version)
);
CREATE TABLE "job_events" (
  id TEXT PRIMARY KEY,
  user_job_id TEXT NOT NULL REFERENCES "user_listing_states"(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  draft_id TEXT REFERENCES "application_drafts"(id) ON DELETE SET NULL,
  detail TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL
);
CREATE TABLE "user_profiles" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
  updated_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 3
);
CREATE TABLE "user_preferences" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  preferences_json TEXT NOT NULL CHECK (json_valid(preferences_json)),
  updated_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 2
);
CREATE TABLE "user_documents" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
, r2_version TEXT NOT NULL DEFAULT '', etag TEXT NOT NULL DEFAULT '', archived_at TEXT);
CREATE TABLE profile_imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES "user_documents"(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('processing','ready','failed','applied')),
  source_text_key TEXT,
  proposal_json TEXT CHECK (proposal_json IS NULL OR json_valid(proposal_json)),
  model_provider TEXT,
  model_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT
, source_text_provider TEXT NOT NULL DEFAULT '', source_text_detail TEXT NOT NULL DEFAULT '', proposal_schema_version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE user_onboarding (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE job_match_facts (
  job_id TEXT PRIMARY KEY REFERENCES "job_listings"(id) ON DELETE CASCADE,
  facts_json TEXT NOT NULL CHECK (json_valid(facts_json)),
  schema_version INTEGER NOT NULL,
  model_provider TEXT,
  model_id TEXT,
  updated_at TEXT NOT NULL
, source_hash TEXT NOT NULL DEFAULT '');
CREATE TABLE job_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES "job_listings"(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('viewed','saved','dismissed','applied')),
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL
);
CREATE TABLE user_document_packets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL CHECK (slug IN ('english-teaching-core','visa-market')),
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,slug)
);
CREATE TABLE user_document_packet_items (
  packet_id TEXT NOT NULL REFERENCES user_document_packets(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES user_documents(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(packet_id,category),
  UNIQUE(packet_id,document_id),
  UNIQUE(packet_id,position)
);
CREATE TABLE application_draft_attachments (
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  source_document_id TEXT NOT NULL REFERENCES user_documents(id) ON DELETE RESTRICT,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_version TEXT NOT NULL,
  etag TEXT NOT NULL,
  created_at TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(draft_id,position),
  UNIQUE(draft_id,source_document_id)
);
CREATE TABLE user_qualification_claims (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_key TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  answer TEXT NOT NULL CHECK (answer IN ('yes','no')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,claim_key)
);
CREATE TABLE user_message_style_choices (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comparison_id TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('a','b','equal')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,comparison_id)
);
CREATE TABLE application_routes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES "job_listings"(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (
    kind IN ('email','board_form','external_url','login_gated_form','phone','manual')
  ),
  destination TEXT NOT NULL,
  contact_point_id TEXT,
  source_evidence TEXT NOT NULL DEFAULT '',
  last_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active','stale','closed','invalid')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, contact_channel_id TEXT
  REFERENCES contact_channels(id) ON DELETE SET NULL,
  UNIQUE(job_id,kind,destination)
);
CREATE TABLE application_attempts (
  id TEXT PRIMARY KEY,
  user_job_id TEXT NOT NULL REFERENCES "user_listing_states"(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE RESTRICT,
  route_id TEXT NOT NULL REFERENCES application_routes(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (channel IN ('email')),
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
  updated_at TEXT NOT NULL, send_requested_at TEXT, application_bundle_id TEXT
  REFERENCES application_bundles(id) ON DELETE SET NULL,
  UNIQUE(user_job_id,draft_id,route_id)
);
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
CREATE TABLE organization_opportunities (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES "job_listings"(id) ON DELETE CASCADE,
  evidence_url TEXT NOT NULL DEFAULT '',
  linked_at TEXT NOT NULL,
  PRIMARY KEY (organization_id,job_id)
);
CREATE TABLE application_thread_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  gmail_message_id TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound','outbound')),
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL, classification TEXT NOT NULL DEFAULT 'human' CHECK (
  classification IN ('human','automated','vacation','bounce')
),
  UNIQUE (user_id, gmail_message_id)
);
CREATE TABLE message_exemplars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'corpus',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  template_variant TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'none',
  outcome_grade INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE user_message_foundations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','archived')),
  voice_rules_json TEXT NOT NULL,
  templates_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  UNIQUE (user_id, version)
);
CREATE TABLE user_message_calibration_decisions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  foundation_id TEXT NOT NULL REFERENCES user_message_foundations(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES "job_listings"(id) ON DELETE CASCADE,
  route TEXT NOT NULL CHECK (
    route IN ('advertised_position','multi_position','school_outreach')
  ),
  rendered_message TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('yes','no')),
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'product',
  decided_at TEXT NOT NULL
);
CREATE TABLE gmail_pubsub_events (
  message_id TEXT PRIMARY KEY,
  email_address TEXT NOT NULL,
  history_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  messages_recorded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE "ai_model_settings" (
  purpose TEXT PRIMARY KEY CHECK (
    purpose IN ('application_message','profile_extraction','job_fact_extraction')
  ),
  model_provider TEXT NOT NULL CHECK (
    model_provider IN ('cerebras','llamacpp','mistral')
  ),
  model_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE user_time_zones (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  time_zone TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
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
CREATE TABLE job_position_analyses (
  job_id TEXT PRIMARY KEY REFERENCES "job_listings"(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('direct','multi_position','ambiguous')),
  review_notes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(review_notes_json)),
  schema_version INTEGER NOT NULL,
  model_provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE job_position_variants (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES "job_listings"(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  title TEXT NOT NULL,
  role_family TEXT NOT NULL CHECK (
    role_family IN (
      'early_childhood','english_language','homeroom','leadership',
      'student_support','subject_specialist','other'
    )
  ),
  subjects_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(subjects_json)),
  locations_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(locations_json)),
  audiences_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(audiences_json)),
  employment_types_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(employment_types_json)),
  requirements_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(requirements_json)),
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_json)),
  compensation_evidence_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(compensation_evidence_json)),
  certainty TEXT NOT NULL CHECK (certainty IN ('explicit','ambiguous')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id,ordinal)
);
CREATE TABLE application_bundles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('anesl_positions')),
  contact_channel_id TEXT NOT NULL REFERENCES contact_channels(id) ON DELETE RESTRICT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'review' CHECK (
    status IN ('review','approved','sent','failed','cancelled')
  ),
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE application_bundle_targets (
  bundle_id TEXT NOT NULL REFERENCES application_bundles(id) ON DELETE CASCADE,
  user_job_id TEXT NOT NULL REFERENCES "user_listing_states"(id) ON DELETE RESTRICT,
  route_id TEXT NOT NULL REFERENCES application_routes(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 4),
  source_reference TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(bundle_id,user_job_id),
  UNIQUE(bundle_id,ordinal)
);
CREATE TABLE application_bundle_test_sends (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES application_bundles(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES application_drafts(id) ON DELETE RESTRICT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (
    status IN ('approved','claimed','drafted','sending','sent','failed','uncertain')
  ),
  gmail_draft_id TEXT NOT NULL DEFAULT '',
  gmail_message_id TEXT NOT NULL DEFAULT '',
  gmail_thread_id TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, reply_received_at TEXT,
  UNIQUE(bundle_id,draft_id,recipient)
);
CREATE TABLE agent_runner_pairings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE agent_runners (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
  codex_version TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE agent_task_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  runner_id TEXT NOT NULL REFERENCES agent_runners(id) ON DELETE RESTRICT,
  task_type TEXT NOT NULL,
  source_task_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed')),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_detail TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL
, attempt_number INTEGER NOT NULL DEFAULT 1
  CHECK (attempt_number>0), lease_token TEXT NOT NULL DEFAULT 'historical'
  CHECK (trim(lease_token)<>''), error_code TEXT NOT NULL DEFAULT '');
CREATE TABLE agent_task_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','claimed','completed','failed','cancelled')),
  runner_id TEXT REFERENCES agent_runners(id) ON DELETE SET NULL,
  lease_expires_at TEXT,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
, attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0), max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts>0), lease_token TEXT, next_attempt_at TEXT, last_error_code TEXT NOT NULL DEFAULT '', retry_of_request_id TEXT
  REFERENCES agent_task_requests(id) ON DELETE SET NULL);
CREATE TABLE test_lab_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  corpus_version TEXT NOT NULL,
  case_id TEXT NOT NULL,
  case_kind TEXT NOT NULL CHECK (case_kind IN ('corpus','document')),
  capability TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (
    variant IN ('codex','jina','hybrid','deterministic','codex_vision','mistral_ocr')
  ),
  provider TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (
    status IN ('queued','running','completed','failed','cancelled')
  ),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  expected_json TEXT NOT NULL CHECK (json_valid(expected_json)),
  intermediate_json TEXT CHECK (
    intermediate_json IS NULL OR json_valid(intermediate_json)
  ),
  output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
  metrics_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
  provenance_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provenance_json)),
  agent_task_request_id TEXT REFERENCES agent_task_requests(id) ON DELETE SET NULL,
  error_detail TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE test_lab_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  left_run_id TEXT NOT NULL REFERENCES test_lab_runs(id) ON DELETE CASCADE,
  right_run_id TEXT NOT NULL REFERENCES test_lab_runs(id) ON DELETE CASCADE,
  preference TEXT NOT NULL CHECK (
    preference IN ('left','right','tie','both_bad')
  ),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(user_id,left_run_id,right_run_id)
);
CREATE TABLE agent_task_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_task_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  purpose TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id,object_key)
);
CREATE TABLE test_delivery_allowlist (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  ownership_basis TEXT NOT NULL CHECK (
    ownership_basis IN ('account_email','gmail_mailbox')
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id,email)
);
CREATE TABLE test_delivery_captures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  mime_sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachments_json)),
  created_at TEXT NOT NULL
);
CREATE TABLE test_delivery_events (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL REFERENCES test_delivery_captures(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('automated_reply','bounce','human_reply')
  ),
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
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
CREATE TABLE campaign_markets (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL CHECK (length(country_code)=2),
  country_name TEXT NOT NULL,
  sweep_id TEXT REFERENCES country_sweeps(id) ON DELETE SET NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id,country_code)
);
CREATE TABLE campaign_targets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL CHECK (length(country_code)=2),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('advertised','school')),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('job','organization')),
  subject_id TEXT NOT NULL,
  job_id TEXT REFERENCES "job_listings"(id) ON DELETE CASCADE,
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
CREATE TABLE "user_automation_policies" (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_mode TEXT NOT NULL DEFAULT 'review'
    CHECK (email_mode IN ('off','review','auto')),
  email_daily_limit INTEGER NOT NULL DEFAULT 20
    CHECK (email_daily_limit > 0),
  board_form_mode TEXT NOT NULL DEFAULT 'review'
    CHECK (board_form_mode IN ('off','review','auto')),
  board_form_daily_limit INTEGER NOT NULL DEFAULT 10
    CHECK (board_form_daily_limit > 0),
  allowed_boards_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(allowed_boards_json)),
  excluded_market_segments_json TEXT NOT NULL
    DEFAULT '["language_center","training_center"]'
    CHECK (json_valid(excluded_market_segments_json)),
  minimum_fit TEXT NOT NULL DEFAULT 'strong'
    CHECK (minimum_fit IN ('likely','strong')),
  require_known_compensation INTEGER NOT NULL DEFAULT 0
    CHECK (require_known_compensation IN (0,1)),
  route_freshness_days INTEGER NOT NULL DEFAULT 30
    CHECK (route_freshness_days > 0),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, follow_up_delays_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(follow_up_delays_json)));
CREATE TABLE inventory_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  completeness_policy TEXT NOT NULL CHECK (
    completeness_policy IN ('complete_snapshot','append_only')
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active','paused')
  ),
  refresh_interval_minutes INTEGER CHECK (refresh_interval_minutes > 0),
  next_refresh_at TEXT,
  last_started_at TEXT,
  last_completed_at TEXT,
  last_success_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE inventory_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES inventory_sources(id) ON DELETE RESTRICT,
  snapshot_key TEXT NOT NULL,
  started_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  runner_id TEXT REFERENCES agent_runners(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'ingesting','reconciling','completed','partial','failed','canceled'
    )
  ),
  source_total_count INTEGER NOT NULL CHECK (source_total_count >= 0),
  source_active_count INTEGER NOT NULL CHECK (source_active_count >= 0),
  source_closed_count INTEGER NOT NULL CHECK (source_closed_count >= 0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  upserted_count INTEGER NOT NULL DEFAULT 0 CHECK (upserted_count >= 0),
  unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
  closed_count INTEGER NOT NULL DEFAULT 0 CHECK (closed_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(checkpoint_json)),
  error_detail TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT, refresh_request_id TEXT
  REFERENCES inventory_refresh_requests(id) ON DELETE SET NULL,
  UNIQUE(source_id,snapshot_key)
);
CREATE TABLE inventory_run_batches (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES inventory_runs(id) ON DELETE CASCADE,
  batch_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  status TEXT NOT NULL CHECK (status IN ('processing','completed','failed')),
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(run_id,batch_key),
  UNIQUE(run_id,ordinal)
);
CREATE TABLE inventory_run_items (
  run_id TEXT NOT NULL REFERENCES inventory_runs(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES inventory_run_batches(id) ON DELETE CASCADE,
  source_job_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('upserted','unchanged','failed')),
  error_detail TEXT NOT NULL DEFAULT '',
  processed_at TEXT NOT NULL,
  PRIMARY KEY(run_id,source_job_id)
);
CREATE TABLE inventory_source_operators (
  source_id TEXT NOT NULL REFERENCES inventory_sources(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('operator')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(source_id,user_id)
);
CREATE TABLE inventory_refresh_requests (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES inventory_sources(id) ON DELETE RESTRICT,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  runner_id TEXT REFERENCES agent_runners(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('latest','full')),
  boards_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(boards_json)),
  request_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued','claimed','crawling','publishing','completed','failed','canceled')
  ),
  inventory_run_id TEXT REFERENCES inventory_runs(id) ON DELETE SET NULL,
  lease_expires_at TEXT,
  error_detail TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  claimed_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE organization_evidence (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_sweep_id TEXT REFERENCES country_sweeps(id) ON DELETE SET NULL,
  source_kind TEXT NOT NULL CHECK (
    source_kind IN ('country_sweep','historical_workbook')
  ),
  evidence_kind TEXT NOT NULL CHECK (
    evidence_kind IN ('organization_profile','outreach_target','vacancy')
  ),
  evidence_status TEXT NOT NULL CHECK (
    evidence_status IN ('active','expired','outreach','stale','unclear')
  ),
  roles TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  posting_context TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL,
  provenance_path TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  UNIQUE(organization_id,source_kind,source_url,roles)
);
CREATE TABLE outreach_followups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('application','campaign')),
  source_attempt_id TEXT NOT NULL,
  gmail_thread_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  delay_days INTEGER NOT NULL CHECK (delay_days > 0),
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (
    status IN (
      'scheduled','drafting','review','drafted','sending','sent','failed',
      'uncertain','canceled'
    )
  ),
  message TEXT NOT NULL DEFAULT '',
  change_summary TEXT NOT NULL DEFAULT '',
  model_id TEXT,
  agent_task_request_id TEXT REFERENCES agent_task_requests(id)
    ON DELETE SET NULL,
  gmail_draft_id TEXT NOT NULL DEFAULT '',
  gmail_draft_message_id TEXT NOT NULL DEFAULT '',
  gmail_message_id TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  drafted_at TEXT,
  sent_at TEXT,
  UNIQUE(user_id,gmail_thread_id,ordinal)
);
CREATE TABLE message_thread_outcomes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN (
      'interested','interview','offer','declined','withdrawn','bounced',
      'no_response'
    )
  ),
  note TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,gmail_thread_id)
);
CREATE TABLE test_lab_classification_adjudications (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  corpus_version TEXT NOT NULL,
  item_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  label TEXT NOT NULL CHECK (
    label IN ('english_teaching','subject_teaching','non_teaching','unclear')
  ),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id,corpus_version,item_id)
);
CREATE TABLE job_content_analyses (
  job_id TEXT PRIMARY KEY REFERENCES job_listings(id) ON DELETE CASCADE,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  schema_version INTEGER NOT NULL,
  model_provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE job_listing_versions (
  listing_id TEXT NOT NULL
    REFERENCES job_listings(id) ON DELETE RESTRICT,
  material_version INTEGER NOT NULL CHECK (material_version > 0),
  material_hash TEXT NOT NULL,
  material_hash_version INTEGER NOT NULL CHECK (material_hash_version >= 0),
  material_json TEXT CHECK (
    material_json IS NULL OR json_valid(material_json)
  ),
  source_posted_date TEXT,
  source_posted_date_raw TEXT NOT NULL DEFAULT '',
  source_posted_date_provenance TEXT NOT NULL DEFAULT 'unknown'
    CHECK (source_posted_date_provenance IN (
      'board-published','unresolved','unknown'
    )),
  source_expiry_date TEXT,
  source_expiry_date_raw TEXT NOT NULL DEFAULT '',
  source_expiry_date_provenance TEXT NOT NULL DEFAULT 'unknown'
    CHECK (source_expiry_date_provenance IN (
      'board-published','unresolved','unknown'
    )),
  inventory_run_id TEXT
    REFERENCES inventory_runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (listing_id,material_version)
);
CREATE TABLE source_publication_policy_versions (
  source_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  predecessor_version INTEGER,
  approval_state TEXT NOT NULL CHECK (
    approval_state IN ('pending','approved','rejected','revoked')
  ),
  publication_scope TEXT NOT NULL CHECK (
    publication_scope IN (
      'blocked','metadata_only','fact_summary','licensed_full_text'
    )
  ),
  publication_enabled INTEGER NOT NULL CHECK (
    publication_enabled IN (0,1)
  ),
  allowed_fields_json TEXT NOT NULL CHECK (
    json_valid(allowed_fields_json)
    AND json_type(allowed_fields_json)='array'
  ),
  attribution_mode TEXT NOT NULL CHECK (
    attribution_mode IN ('none','source_name','source_link')
  ),
  max_verbatim_chars INTEGER NOT NULL CHECK (max_verbatim_chars >= 0),
  source_origin_url TEXT NOT NULL DEFAULT '',
  terms_url TEXT NOT NULL DEFAULT '',
  terms_checked_at TEXT,
  robots_url TEXT NOT NULL DEFAULT '',
  robots_checked_at TEXT,
  evidence_json TEXT NOT NULL CHECK (
    json_valid(evidence_json) AND json_type(evidence_json)='object'
  ),
  decision_note TEXT NOT NULL,
  policy_hash TEXT NOT NULL CHECK (length(policy_hash)=64),
  idempotency_key TEXT NOT NULL CHECK (trim(idempotency_key)<>''),
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_key,version),
  UNIQUE (source_key,idempotency_key),
  FOREIGN KEY (source_key,predecessor_version)
    REFERENCES source_publication_policy_versions(source_key,version)
    ON DELETE RESTRICT,
  CHECK (
    (version=1 AND predecessor_version IS NULL)
    OR (version>1 AND predecessor_version=version-1)
  ),
  CHECK (
    publication_enabled=0
    OR (approval_state='approved' AND publication_scope<>'blocked')
  ),
  CHECK (
    publication_scope<>'blocked'
    OR (
      publication_enabled=0
      AND json_array_length(allowed_fields_json)=0
      AND max_verbatim_chars=0
    )
  ),
  CHECK (
    publication_scope<>'metadata_only' OR max_verbatim_chars=0
  )
);
CREATE TABLE source_publication_policy_heads (
  source_key TEXT PRIMARY KEY,
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_key,current_version)
    REFERENCES source_publication_policy_versions(source_key,version)
    ON DELETE RESTRICT
);
CREATE TABLE canonical_locations (
  id TEXT PRIMARY KEY,
  resolution_state TEXT NOT NULL CHECK (
    resolution_state IN (
      'unresolved','ambiguous','resolved','invalid','superseded'
    )
  ),
  input_label TEXT NOT NULL,
  display_name TEXT NOT NULL,
  country_code TEXT CHECK (
    country_code IS NULL OR length(country_code)=2
  ),
  region TEXT NOT NULL DEFAULT '',
  locality TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  provider_place_id TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  bounds_json TEXT CHECK (
    bounds_json IS NULL
    OR (json_valid(bounds_json) AND json_type(bounds_json)='array')
  ),
  resolution_evidence_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(resolution_evidence_json)
    AND json_type(resolution_evidence_json)='object'
  ),
  superseded_by_location_id TEXT REFERENCES canonical_locations(id)
    ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    resolution_state<>'resolved'
    OR (
      trim(provider)<>''
      AND trim(provider_place_id)<>''
      AND country_code IS NOT NULL
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
    )
  ),
  CHECK (
    resolution_state<>'superseded'
    OR superseded_by_location_id IS NOT NULL
  ),
  CHECK (
    superseded_by_location_id IS NULL OR superseded_by_location_id<>id
  )
);
CREATE TABLE public_jobs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE public_job_aliases (
  public_job_id TEXT NOT NULL REFERENCES public_jobs(id) ON DELETE RESTRICT,
  slug TEXT COLLATE NOCASE NOT NULL CHECK (trim(slug)<>''),
  created_at TEXT NOT NULL,
  PRIMARY KEY (public_job_id,slug)
);
CREATE TABLE public_job_versions (
  public_job_id TEXT NOT NULL REFERENCES public_jobs(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  predecessor_version INTEGER,
  canonical_slug TEXT COLLATE NOCASE NOT NULL,
  title TEXT NOT NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
  organization_name TEXT NOT NULL,
  organization_resolution_state TEXT NOT NULL CHECK (
    organization_resolution_state IN ('unresolved','ambiguous','resolved')
  ),
  workplace_type TEXT NOT NULL CHECK (
    workplace_type IN ('onsite','hybrid','remote','unknown')
  ),
  date_posted TEXT,
  date_posted_provenance TEXT NOT NULL CHECK (
    date_posted_provenance IN (
      'employer-original','board-published','unresolved','unknown'
    )
  ),
  valid_through TEXT,
  valid_through_provenance TEXT NOT NULL CHECK (
    valid_through_provenance IN (
      'employer-original','board-published','unresolved','unknown'
    )
  ),
  employment_types_json TEXT NOT NULL CHECK (
    json_valid(employment_types_json)
    AND json_type(employment_types_json)='array'
  ),
  compensation_json TEXT NOT NULL CHECK (
    json_valid(compensation_json)
    AND json_type(compensation_json)='object'
  ),
  description_html TEXT NOT NULL,
  public_content_hash TEXT NOT NULL CHECK (length(public_content_hash)=64),
  public_content_hash_version INTEGER NOT NULL CHECK (
    public_content_hash_version > 0
  ),
  material_changed_at TEXT NOT NULL,
  content_schema_version INTEGER NOT NULL CHECK (content_schema_version > 0),
  producer_kind TEXT NOT NULL CHECK (
    producer_kind IN ('deterministic','codex','operator')
  ),
  producer_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (trim(idempotency_key)<>''),
  created_at TEXT NOT NULL,
  PRIMARY KEY (public_job_id,version),
  UNIQUE (public_job_id,idempotency_key),
  FOREIGN KEY (public_job_id,predecessor_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,canonical_slug)
    REFERENCES public_job_aliases(public_job_id,slug)
    ON DELETE RESTRICT,
  CHECK (
    (version=1 AND predecessor_version IS NULL)
    OR (version>1 AND predecessor_version=version-1)
  ),
  CHECK (
    (date_posted IS NULL AND date_posted_provenance IN ('unresolved','unknown'))
    OR (date_posted IS NOT NULL AND date_posted_provenance IN (
      'employer-original','board-published'
    ))
  ),
  CHECK (
    (valid_through IS NULL AND valid_through_provenance IN (
      'unresolved','unknown'
    ))
    OR (valid_through IS NOT NULL AND valid_through_provenance IN (
      'employer-original','board-published'
    ))
  ),
  CHECK (
    organization_resolution_state<>'resolved'
    OR (organization_id IS NOT NULL AND trim(organization_name)<>'')
  )
);
CREATE TABLE public_job_heads (
  public_job_id TEXT PRIMARY KEY,
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (public_job_id,current_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT
);
CREATE TABLE public_job_version_locations (
  public_job_id TEXT NOT NULL,
  public_job_version INTEGER NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  location_role TEXT NOT NULL CHECK (
    location_role IN ('worksite','applicant_area')
  ),
  location_id TEXT REFERENCES canonical_locations(id) ON DELETE RESTRICT,
  resolution_state TEXT NOT NULL CHECK (
    resolution_state IN ('unresolved','ambiguous','resolved')
  ),
  display_name TEXT NOT NULL,
  country_code TEXT CHECK (
    country_code IS NULL OR length(country_code)=2
  ),
  region TEXT NOT NULL DEFAULT '',
  locality TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  location_json TEXT NOT NULL CHECK (
    json_valid(location_json) AND json_type(location_json)='object'
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY (public_job_id,public_job_version,ordinal),
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT,
  CHECK (
    resolution_state<>'resolved'
    OR (location_id IS NOT NULL AND country_code IS NOT NULL)
  )
);
CREATE TABLE job_source_positions (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES job_listings(id) ON DELETE RESTRICT,
  source_key TEXT NOT NULL,
  position_key TEXT NOT NULL CHECK (trim(position_key)<>''),
  position_kind TEXT NOT NULL CHECK (
    position_kind IN ('direct','extracted')
  ),
  created_at TEXT NOT NULL,
  UNIQUE (listing_id,position_key),
  UNIQUE (id,listing_id),
  UNIQUE (id,source_key),
  CHECK (
    position_kind<>'direct' OR position_key='direct'
  )
);
CREATE TABLE job_source_position_mapping_versions (
  source_position_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  predecessor_version INTEGER,
  listing_id TEXT NOT NULL,
  listing_material_version INTEGER NOT NULL CHECK (
    listing_material_version > 0
  ),
  mapping_state TEXT NOT NULL CHECK (mapping_state IN ('mapped','unmapped')),
  public_job_id TEXT REFERENCES public_jobs(id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'initial','duplicate-merge','split','correction','source-removed',
      'rollback'
    )
  ),
  mapping_hash TEXT NOT NULL CHECK (length(mapping_hash)=64),
  idempotency_key TEXT NOT NULL CHECK (trim(idempotency_key)<>''),
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_position_id,version),
  UNIQUE (source_position_id,idempotency_key),
  FOREIGN KEY (source_position_id,predecessor_version)
    REFERENCES job_source_position_mapping_versions(source_position_id,version)
    ON DELETE RESTRICT,
  FOREIGN KEY (source_position_id,listing_id)
    REFERENCES job_source_positions(id,listing_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (listing_id,listing_material_version)
    REFERENCES job_listing_versions(listing_id,material_version)
    ON DELETE RESTRICT,
  CHECK (
    (version=1 AND predecessor_version IS NULL)
    OR (version>1 AND predecessor_version=version-1)
  ),
  CHECK (
    (mapping_state='mapped' AND public_job_id IS NOT NULL)
    OR (mapping_state='unmapped' AND public_job_id IS NULL)
  )
);
CREATE TABLE job_source_position_mapping_heads (
  source_position_id TEXT PRIMARY KEY,
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_position_id,current_version)
    REFERENCES job_source_position_mapping_versions(source_position_id,version)
    ON DELETE RESTRICT
);
CREATE TABLE public_job_eligibility_decisions (
  public_job_id TEXT NOT NULL REFERENCES public_jobs(id) ON DELETE RESTRICT,
  decision_version INTEGER NOT NULL CHECK (decision_version > 0),
  predecessor_version INTEGER,
  public_job_version INTEGER NOT NULL,
  publication_state TEXT NOT NULL CHECK (
    publication_state IN (
      'private','eligible','published','closed','suppressed','deleted','merged'
    )
  ),
  route_disposition TEXT NOT NULL CHECK (
    route_disposition IN ('private','serve','retain_noindex','redirect','gone')
  ),
  browse_eligible INTEGER NOT NULL CHECK (browse_eligible IN (0,1)),
  organic_index_eligible INTEGER NOT NULL CHECK (
    organic_index_eligible IN (0,1)
  ),
  job_posting_eligible INTEGER NOT NULL CHECK (
    job_posting_eligible IN (0,1)
  ),
  source_open_state TEXT NOT NULL CHECK (
    source_open_state IN ('open','closed','unknown')
  ),
  application_route_id TEXT REFERENCES application_routes(id)
    ON DELETE RESTRICT,
  application_route_state TEXT NOT NULL CHECK (
    application_route_state IN ('unresolved','valid','invalid')
  ),
  content_review_state TEXT NOT NULL CHECK (
    content_review_state IN ('unreviewed','approved','rejected')
  ),
  privacy_state TEXT NOT NULL CHECK (
    privacy_state IN ('pending','passed','failed')
  ),
  verified_at TEXT,
  redirect_public_job_id TEXT REFERENCES public_jobs(id) ON DELETE RESTRICT,
  reason_codes_json TEXT NOT NULL CHECK (
    json_valid(reason_codes_json)
    AND json_type(reason_codes_json)='array'
    AND json_array_length(reason_codes_json)>0
  ),
  decision_note TEXT NOT NULL,
  evaluator_kind TEXT NOT NULL CHECK (
    evaluator_kind IN ('system','codex','operator','migration')
  ),
  evaluator_version TEXT NOT NULL,
  decision_hash TEXT NOT NULL CHECK (length(decision_hash)=64),
  idempotency_key TEXT NOT NULL CHECK (trim(idempotency_key)<>''),
  decided_at TEXT NOT NULL,
  PRIMARY KEY (public_job_id,decision_version),
  UNIQUE (public_job_id,idempotency_key),
  FOREIGN KEY (public_job_id,predecessor_version)
    REFERENCES public_job_eligibility_decisions(public_job_id,decision_version)
    ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT,
  CHECK (
    (decision_version=1 AND predecessor_version IS NULL)
    OR (decision_version>1 AND predecessor_version=decision_version-1)
  ),
  CHECK (job_posting_eligible<=organic_index_eligible),
  CHECK (organic_index_eligible<=browse_eligible),
  CHECK (
    publication_state<>'published'
    OR (
      route_disposition='serve'
      AND browse_eligible=1
      AND source_open_state='open'
      AND application_route_id IS NOT NULL
      AND application_route_state='valid'
      AND content_review_state='approved'
      AND privacy_state='passed'
      AND verified_at IS NOT NULL
      AND redirect_public_job_id IS NULL
    )
  ),
  CHECK (
    publication_state<>'closed'
    OR (
      route_disposition IN ('retain_noindex','gone')
      AND browse_eligible=0
      AND organic_index_eligible=0
      AND job_posting_eligible=0
      AND redirect_public_job_id IS NULL
    )
  ),
  CHECK (
    publication_state<>'deleted'
    OR (
      route_disposition='gone'
      AND browse_eligible=0
      AND organic_index_eligible=0
      AND job_posting_eligible=0
      AND redirect_public_job_id IS NULL
    )
  ),
  CHECK (
    publication_state<>'merged'
    OR (
      route_disposition='redirect'
      AND browse_eligible=0
      AND organic_index_eligible=0
      AND job_posting_eligible=0
      AND redirect_public_job_id IS NOT NULL
      AND redirect_public_job_id<>public_job_id
    )
  ),
  CHECK (
    publication_state NOT IN ('private','eligible','suppressed')
    OR (
      route_disposition='private'
      AND browse_eligible=0
      AND organic_index_eligible=0
      AND job_posting_eligible=0
      AND redirect_public_job_id IS NULL
    )
  )
);
CREATE TABLE public_job_eligibility_heads (
  public_job_id TEXT PRIMARY KEY,
  current_decision_version INTEGER NOT NULL CHECK (
    current_decision_version > 0
  ),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (public_job_id,current_decision_version)
    REFERENCES public_job_eligibility_decisions(public_job_id,decision_version)
    ON DELETE RESTRICT
);
CREATE TABLE public_job_decision_sources (
  public_job_id TEXT NOT NULL,
  decision_version INTEGER NOT NULL,
  source_position_id TEXT NOT NULL,
  source_mapping_version INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  contribution_kind TEXT NOT NULL CHECK (
    contribution_kind IN ('identity_only','public_content')
  ),
  fields_used_json TEXT NOT NULL CHECK (
    json_valid(fields_used_json) AND json_type(fields_used_json)='array'
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY (
    public_job_id,decision_version,source_position_id,source_mapping_version
  ),
  FOREIGN KEY (public_job_id,decision_version)
    REFERENCES public_job_eligibility_decisions(public_job_id,decision_version)
    ON DELETE RESTRICT,
  FOREIGN KEY (source_position_id,source_mapping_version)
    REFERENCES job_source_position_mapping_versions(source_position_id,version)
    ON DELETE RESTRICT,
  FOREIGN KEY (source_position_id,source_key)
    REFERENCES job_source_positions(id,source_key)
    ON DELETE RESTRICT,
  FOREIGN KEY (source_key,policy_version)
    REFERENCES source_publication_policy_versions(source_key,version)
    ON DELETE RESTRICT,
  CHECK (
    (contribution_kind='identity_only' AND json_array_length(fields_used_json)=0)
    OR (
      contribution_kind='public_content'
      AND json_array_length(fields_used_json)>0
    )
  )
);
CREATE TABLE public_projection_runs (
  id TEXT PRIMARY KEY,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode='shadow'),
  request_key TEXT NOT NULL UNIQUE CHECK (trim(request_key)<>''),
  scope_json TEXT NOT NULL CHECK (
    json_valid(scope_json) AND json_type(scope_json)='object'
  ),
  contract_version INTEGER NOT NULL CHECK (contract_version>0),
  projector_version TEXT NOT NULL CHECK (trim(projector_version)<>''),
  policy_heads_hash TEXT NOT NULL CHECK (length(policy_heads_hash)=64),
  source_watermark_json TEXT NOT NULL CHECK (
    json_valid(source_watermark_json)
    AND json_type(source_watermark_json)='object'
  ),
  status TEXT NOT NULL CHECK (
    status IN (
      'queued','running','completed','completed_with_blocks','failed',
      'canceled'
    )
  ),
  listing_total INTEGER NOT NULL DEFAULT 0 CHECK (listing_total>=0),
  listing_completed INTEGER NOT NULL DEFAULT 0 CHECK (listing_completed>=0),
  listing_blocked INTEGER NOT NULL DEFAULT 0 CHECK (listing_blocked>=0),
  listing_failed INTEGER NOT NULL DEFAULT 0 CHECK (listing_failed>=0),
  listing_superseded INTEGER NOT NULL DEFAULT 0 CHECK (
    listing_superseded>=0
  ),
  position_total INTEGER NOT NULL DEFAULT 0 CHECK (position_total>=0),
  position_completed INTEGER NOT NULL DEFAULT 0 CHECK (position_completed>=0),
  position_blocked INTEGER NOT NULL DEFAULT 0 CHECK (position_blocked>=0),
  position_failed INTEGER NOT NULL DEFAULT 0 CHECK (position_failed>=0),
  position_superseded INTEGER NOT NULL DEFAULT 0 CHECK (
    position_superseded>=0
  ),
  selection_cursor TEXT NOT NULL DEFAULT '',
  selection_complete INTEGER NOT NULL DEFAULT 0 CHECK (
    selection_complete IN (0,1)
  ),
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL, advance_step_count INTEGER NOT NULL DEFAULT 0
    CHECK (advance_step_count>=0),
  CHECK (
    listing_completed+listing_blocked+listing_failed+listing_superseded
      <=listing_total
  ),
  CHECK (
    position_completed+position_blocked+position_failed+position_superseded
      <=position_total
  ),
  CHECK (
    status NOT IN ('completed','completed_with_blocks','failed','canceled')
    OR completed_at IS NOT NULL
  ),
  CHECK (status<>'running' OR started_at IS NOT NULL)
);
CREATE TABLE public_projection_listing_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  listing_id TEXT NOT NULL,
  material_version INTEGER NOT NULL CHECK (material_version>0),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  stage TEXT NOT NULL CHECK (
    stage IN ('selected','prerequisites','source_positions','completed')
  ),
  status TEXT NOT NULL CHECK (
    status IN (
      'queued','processing','waiting_analysis','blocked','completed','failed',
      'superseded'
    )
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts>0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(checkpoint_json) AND json_type(checkpoint_json)='object'
  ),
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id,listing_id,material_version),
  UNIQUE (id,run_id),
  FOREIGN KEY (listing_id,material_version)
    REFERENCES job_listing_versions(listing_id,material_version)
    ON DELETE RESTRICT,
  CHECK (attempt_count<=max_attempts),
  CHECK (
    (status='processing'
      AND lease_owner IS NOT NULL
      AND trim(lease_owner)<>''
      AND lease_token IS NOT NULL
      AND trim(lease_token)<>''
      AND lease_expires_at IS NOT NULL
      AND trim(lease_expires_at)<>''
      AND attempt_count>0)
    OR (status<>'processing'
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK (status<>'completed' OR stage='completed'),
  CHECK (
    status NOT IN ('blocked','completed','failed','superseded')
    OR completed_at IS NOT NULL
  ),
  CHECK (
    status NOT IN ('blocked','failed','superseded') OR trim(error_code)<>''
  )
);
CREATE TABLE public_projection_position_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  listing_item_id TEXT NOT NULL,
  source_position_id TEXT NOT NULL REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  stage TEXT NOT NULL CHECK (
    stage IN (
      'identity','canonical_resolution','content','eligibility','completed'
    )
  ),
  status TEXT NOT NULL CHECK (
    status IN (
      'queued','processing','waiting_analysis','blocked','completed','failed',
      'superseded'
    )
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts>0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  public_job_id TEXT REFERENCES public_jobs(id) ON DELETE RESTRICT,
  simulated_browse_eligible INTEGER NOT NULL DEFAULT 0 CHECK (
    simulated_browse_eligible IN (0,1)
  ),
  simulated_organic_eligible INTEGER NOT NULL DEFAULT 0 CHECK (
    simulated_organic_eligible IN (0,1)
  ),
  simulated_job_posting_eligible INTEGER NOT NULL DEFAULT 0 CHECK (
    simulated_job_posting_eligible IN (0,1)
  ),
  readiness_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(readiness_json) AND json_type(readiness_json)='object'
  ),
  reason_codes_json TEXT NOT NULL DEFAULT '["shadow_mode"]' CHECK (
    json_valid(reason_codes_json)
    AND json_type(reason_codes_json)='array'
    AND json_array_length(reason_codes_json)>0
  ),
  checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(checkpoint_json) AND json_type(checkpoint_json)='object'
  ),
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id,source_position_id),
  UNIQUE (id,run_id),
  FOREIGN KEY (listing_item_id,run_id)
    REFERENCES public_projection_listing_items(id,run_id)
    ON DELETE RESTRICT,
  CHECK (attempt_count<=max_attempts),
  CHECK (
    simulated_job_posting_eligible<=simulated_organic_eligible
  ),
  CHECK (simulated_organic_eligible<=simulated_browse_eligible),
  CHECK (
    (status='processing'
      AND lease_owner IS NOT NULL
      AND trim(lease_owner)<>''
      AND lease_token IS NOT NULL
      AND trim(lease_token)<>''
      AND lease_expires_at IS NOT NULL
      AND trim(lease_expires_at)<>''
      AND attempt_count>0)
    OR (status<>'processing'
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK (status<>'completed' OR stage='completed'),
  CHECK (
    status NOT IN ('blocked','completed','failed','superseded')
    OR completed_at IS NOT NULL
  ),
  CHECK (
    status NOT IN ('blocked','failed','superseded') OR trim(error_code)<>''
  )
);
CREATE TABLE public_projection_duplicate_candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  position_item_id TEXT NOT NULL,
  candidate_public_job_id TEXT NOT NULL,
  candidate_public_job_version INTEGER NOT NULL CHECK (
    candidate_public_job_version>0
  ),
  retrieval_algorithm_version TEXT NOT NULL CHECK (
    trim(retrieval_algorithm_version)<>''
  ),
  signals_json TEXT NOT NULL CHECK (
    json_valid(signals_json)
    AND json_type(signals_json)='array'
    AND json_array_length(signals_json)>0
  ),
  codex_recommendation TEXT CHECK (
    codex_recommendation IS NULL
    OR codex_recommendation IN ('same','different','unclear')
  ),
  agent_task_run_id TEXT REFERENCES agent_task_runs(id) ON DELETE RESTRICT,
  operator_decision TEXT NOT NULL DEFAULT 'pending' CHECK (
    operator_decision IN ('pending','same','different','deferred')
  ),
  operator_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  operator_decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (position_item_id,candidate_public_job_id),
  FOREIGN KEY (position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (candidate_public_job_id,candidate_public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT,
  CHECK (
    codex_recommendation IS NULL OR agent_task_run_id IS NOT NULL
  ),
  CHECK (
    (operator_decision='pending'
      AND operator_user_id IS NULL
      AND operator_decided_at IS NULL)
    OR (operator_decision<>'pending'
      AND operator_user_id IS NOT NULL
      AND operator_decided_at IS NOT NULL)
  )
);
CREATE TABLE public_job_identity_signals (
  public_job_id TEXT NOT NULL,
  public_job_version INTEGER NOT NULL CHECK (public_job_version>0),
  signal_kind TEXT NOT NULL CHECK (
    signal_kind IN (
      'canonical_identity_v1','material_clone_v1','source_reference_v1'
    )
  ),
  signal_hash TEXT NOT NULL CHECK (length(signal_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (
    public_job_id,public_job_version,signal_kind,signal_hash
  ),
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_duplicate_work (
  run_id TEXT PRIMARY KEY REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  retrieval_algorithm_version TEXT NOT NULL CHECK (
    retrieval_algorithm_version='public-duplicate-retrieval-v1'
  ),
  phase TEXT NOT NULL CHECK (
    phase IN ('members','existing_public','same_run','ready','sealed')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('queued','processing','sealed')
  ),
  expected_member_count INTEGER NOT NULL CHECK (expected_member_count>=0),
  member_count INTEGER NOT NULL DEFAULT 0 CHECK (member_count>=0),
  comparison_count INTEGER NOT NULL DEFAULT 0 CHECK (comparison_count>=0),
  member_cursor TEXT NOT NULL DEFAULT '',
  existing_public_cursor TEXT NOT NULL DEFAULT '',
  same_run_owner_cursor TEXT NOT NULL DEFAULT '',
  same_run_target_cursor TEXT NOT NULL DEFAULT '',
  member_digest TEXT NOT NULL CHECK (length(member_digest)=64),
  comparison_digest TEXT NOT NULL CHECK (length(comparison_digest)=64),
  lease_token TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (member_count<=expected_member_count),
  CHECK (
    (status='processing' AND lease_token IS NOT NULL
      AND trim(lease_token)<>'' AND lease_expires_at IS NOT NULL
      AND trim(lease_expires_at)<>'')
    OR (status<>'processing' AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK ((phase='sealed')=(status='sealed'))
);
CREATE TABLE public_projection_duplicate_assertions (
  expected_changes INTEGER NOT NULL CHECK (expected_changes>=0),
  actual_changes INTEGER NOT NULL,
  CHECK (actual_changes=expected_changes)
);
CREATE TABLE public_projection_duplicate_batch_members (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  position_item_id TEXT NOT NULL,
  source_position_id TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  listing_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  position_key TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  source_reference_signal_hash TEXT CHECK (
    source_reference_signal_hash IS NULL
    OR length(source_reference_signal_hash)=64
  ),
  material_signal_hash TEXT NOT NULL CHECK (
    length(material_signal_hash)=64
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,position_item_id),
  UNIQUE (run_id,ordinal),
  FOREIGN KEY (position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_duplicate_comparisons (
  id TEXT PRIMARY KEY CHECK (
    length(id)=72
    AND substr(id,1,8)='pdup_v1_'
    AND substr(id,9) NOT GLOB '*[^0-9a-f]*'
  ),
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  owner_position_item_id TEXT NOT NULL,
  owner_source_position_id TEXT NOT NULL,
  owner_input_hash TEXT NOT NULL CHECK (length(owner_input_hash)=64),
  target_kind TEXT NOT NULL CHECK (
    target_kind IN ('existing_public','same_run')
  ),
  target_public_job_id TEXT,
  target_public_job_version INTEGER CHECK (
    target_public_job_version IS NULL OR target_public_job_version>0
  ),
  target_redirect_root_id TEXT REFERENCES public_jobs(id)
    ON DELETE RESTRICT,
  target_position_item_id TEXT,
  target_source_position_id TEXT,
  target_input_hash TEXT CHECK (
    target_input_hash IS NULL OR length(target_input_hash)=64
  ),
  retrieval_algorithm_version TEXT NOT NULL CHECK (
    retrieval_algorithm_version='public-duplicate-retrieval-v1'
  ),
  matching_signals_json TEXT NOT NULL CHECK (
    json_valid(matching_signals_json)
    AND json_type(matching_signals_json)='array'
  ),
  conflicting_signals_json TEXT NOT NULL CHECK (
    json_valid(conflicting_signals_json)
    AND json_type(conflicting_signals_json)='array'
  ),
  relation TEXT NOT NULL CHECK (
    relation IN ('same','different','ambiguous')
  ),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'same_source_position','same_source_reference_position',
      'same_listing_distinct_position','conflicting_stable_identifier',
      'canonical_identity_only','duplicate_evidence_conflict'
    )
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL CHECK (updated_at=created_at),
  FOREIGN KEY (owner_position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (target_position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (target_public_job_id,target_public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT,
  CHECK (
    (
      target_kind='same_run'
      AND target_position_item_id IS NOT NULL
      AND target_source_position_id IS NOT NULL
      AND target_input_hash IS NOT NULL
      AND target_public_job_id IS NULL
      AND target_public_job_version IS NULL
      AND target_redirect_root_id IS NULL
      AND owner_position_item_id<target_position_item_id
      AND owner_source_position_id<>target_source_position_id
    )
    OR (
      target_kind='existing_public'
      AND target_position_item_id IS NULL
      AND target_source_position_id IS NULL
      AND target_input_hash IS NULL
      AND target_public_job_id IS NOT NULL
      AND target_public_job_version IS NOT NULL
      AND target_redirect_root_id IS NOT NULL
    )
  ),
  CHECK (
    (relation='same' AND reason_code IN (
      'same_source_position','same_source_reference_position'
    ))
    OR (relation='different' AND reason_code IN (
      'same_listing_distinct_position','conflicting_stable_identifier'
    ))
    OR (relation='ambiguous' AND reason_code IN (
      'canonical_identity_only','duplicate_evidence_conflict'
    ))
  )
);
CREATE TABLE public_projection_duplicate_batches (
  run_id TEXT PRIMARY KEY REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  retrieval_algorithm_version TEXT NOT NULL CHECK (
    retrieval_algorithm_version='public-duplicate-retrieval-v1'
  ),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  position_member_count INTEGER NOT NULL CHECK (position_member_count>=0),
  comparison_count INTEGER NOT NULL CHECK (comparison_count>=0),
  member_digest TEXT NOT NULL CHECK (length(member_digest)=64),
  comparison_digest TEXT NOT NULL CHECK (length(comparison_digest)=64),
  canonical_identity_state TEXT NOT NULL CHECK (
    canonical_identity_state='pending'
  ),
  created_at TEXT NOT NULL
);
CREATE TABLE transaction_assertions (
  must_equal_one INTEGER NOT NULL CHECK (must_equal_one=1)
);
CREATE TABLE work_outbox (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  available_at TEXT NOT NULL,
  published_at TEXT,
  publish_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    publish_attempt_count>=0
  ),
  created_at TEXT NOT NULL, work_item_id TEXT NOT NULL DEFAULT '',
  UNIQUE(topic,aggregate_id,id)
);
CREATE TABLE public_source_display_label_versions (
  source_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  predecessor_version INTEGER,
  display_label TEXT NOT NULL CHECK (trim(display_label)<>''),
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_key,version),
  FOREIGN KEY (source_key,predecessor_version)
    REFERENCES public_source_display_label_versions(source_key,version)
    ON DELETE RESTRICT,
  CHECK (
    (version=1 AND predecessor_version IS NULL)
    OR (version>1 AND predecessor_version=version-1)
  )
);
CREATE TABLE public_source_display_label_heads (
  source_key TEXT PRIMARY KEY,
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_key,current_version)
    REFERENCES public_source_display_label_versions(source_key,version)
    ON DELETE RESTRICT
);
CREATE TABLE source_publication_policy_label_versions (
  source_key TEXT NOT NULL,
  policy_version INTEGER NOT NULL CHECK (policy_version > 0),
  label_version INTEGER NOT NULL CHECK (label_version > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_key,policy_version),
  FOREIGN KEY (source_key,policy_version)
    REFERENCES source_publication_policy_versions(source_key,version)
    ON DELETE RESTRICT,
  FOREIGN KEY (source_key,label_version)
    REFERENCES public_source_display_label_versions(source_key,version)
    ON DELETE RESTRICT
);
CREATE TABLE public_job_catalog_versions (
  version TEXT PRIMARY KEY CHECK (trim(version)<>''),
  predecessor_version TEXT REFERENCES public_job_catalog_versions(version)
    ON DELETE RESTRICT,
  membership_hash TEXT NOT NULL CHECK (length(membership_hash)=64),
  member_count INTEGER NOT NULL CHECK (member_count >= 0),
  search_document_count INTEGER NOT NULL CHECK (search_document_count >= 0),
  search_content_hash TEXT NOT NULL CHECK (length(search_content_hash)=64),
  search_term_count INTEGER NOT NULL CHECK (search_term_count >= 0),
  location_facet_count INTEGER NOT NULL CHECK (location_facet_count >= 0),
  representation_updated_at TEXT NOT NULL,
  material_changed_at TEXT NOT NULL,
  search_index_version TEXT NOT NULL CHECK (trim(search_index_version)<>''),
  created_at TEXT NOT NULL, ordinal INTEGER,
  UNIQUE (search_index_version)
);
CREATE TABLE public_job_catalog_head_pointer (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1),
  current_version TEXT NOT NULL REFERENCES public_job_catalog_versions(version)
    ON DELETE RESTRICT,
  updated_at TEXT NOT NULL
);
CREATE TABLE public_job_catalog_seals (
  catalog_version TEXT PRIMARY KEY REFERENCES public_job_catalog_versions(version)
    ON DELETE RESTRICT,
  membership_hash TEXT NOT NULL CHECK (length(membership_hash)=64),
  member_count INTEGER NOT NULL CHECK (member_count >= 0),
  search_document_count INTEGER NOT NULL CHECK (search_document_count >= 0),
  search_content_hash TEXT NOT NULL CHECK (length(search_content_hash)=64),
  search_term_count INTEGER NOT NULL CHECK (search_term_count >= 0),
  location_facet_count INTEGER NOT NULL CHECK (location_facet_count >= 0),
  sealed_at TEXT NOT NULL
);
CREATE TABLE public_job_catalog_head_history (
  catalog_version TEXT PRIMARY KEY REFERENCES public_job_catalog_versions(version)
    ON DELETE RESTRICT,
  activated_at TEXT NOT NULL
);
CREATE TABLE "country_sweeps" (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL CHECK (length(country_code)=2),
  country_name TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN (
      'queued','running','completed','completed_with_gaps','failed','canceled'
    )
  ),
  requested_scope_json TEXT NOT NULL CHECK (json_valid(requested_scope_json)),
  coverage_summary_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(coverage_summary_json)
  ),
  error_detail TEXT NOT NULL DEFAULT '',
  task_total INTEGER NOT NULL DEFAULT 0 CHECK (task_total>=0),
  task_completed INTEGER NOT NULL DEFAULT 0 CHECK (task_completed>=0),
  task_failed INTEGER NOT NULL DEFAULT 0 CHECK (task_failed>=0),
  missing_scope_count INTEGER NOT NULL DEFAULT 0 CHECK (
    missing_scope_count>=0
  ),
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (task_completed+task_failed<=task_total)
);
CREATE TABLE "country_sweep_tasks" (
  id TEXT PRIMARY KEY,
  sweep_id TEXT NOT NULL REFERENCES "country_sweeps"(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (
    phase IN ('discovery','verification','coverage_audit')
  ),
  scope_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued','claimed','materializing','completed','failed')
  ),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
  worker_id TEXT,
  claimed_at TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  completed_at TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts>0),
  accepted_output_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(sweep_id,phase,scope_key),
  UNIQUE(id,sweep_id),
  CHECK (attempt_count<=max_attempts),
  CHECK (
    (
      status='claimed'
      AND worker_id IS NOT NULL
      AND trim(worker_id)<>''
      AND lease_token IS NOT NULL
      AND trim(lease_token)<>''
      AND lease_expires_at IS NOT NULL
      AND trim(lease_expires_at)<>''
      AND attempt_count>0
    )
    OR (
      status<>'claimed'
      AND worker_id IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
    )
  ),
  CHECK (status<>'materializing' OR accepted_output_id IS NOT NULL)
);
CREATE TABLE organization_source_employer_mappings (
  source_key TEXT NOT NULL CHECK (trim(source_key)<>''),
  employer_id TEXT NOT NULL CHECK (trim(employer_id)<>''),
  organization_id TEXT NOT NULL REFERENCES organizations(id)
    ON DELETE RESTRICT,
  accepted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_key,employer_id)
);
CREATE TABLE organization_domain_mappings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id)
    ON DELETE RESTRICT,
  mapping_kind TEXT NOT NULL CHECK (
    mapping_kind IN (
      'employer_host','employer_registrable_domain','hosted_ats_tenant'
    )
  ),
  normalized_host TEXT NOT NULL CHECK (
    trim(normalized_host)<>'' AND normalized_host=lower(normalized_host)
  ),
  registrable_domain TEXT NOT NULL CHECK (
    trim(registrable_domain)<>''
    AND registrable_domain=lower(registrable_domain)
  ),
  path_prefix TEXT NOT NULL DEFAULT '',
  public_suffix_list_version TEXT NOT NULL CHECK (
    public_suffix_list_version='tldts-7.4.8-icann'
  ),
  accepted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accepted_at TEXT NOT NULL,
  evidence_url TEXT NOT NULL CHECK (trim(evidence_url)<>''),
  created_at TEXT NOT NULL,
  UNIQUE (mapping_kind,normalized_host,path_prefix,organization_id),
  CHECK (
    (mapping_kind='employer_host' AND path_prefix='')
    OR (
      mapping_kind='employer_registrable_domain'
      AND path_prefix='' AND normalized_host=registrable_domain
    )
    OR (
      mapping_kind='hosted_ats_tenant'
      AND substr(path_prefix,1,1)='/' AND path_prefix<>'/'
    )
  )
);
CREATE TABLE organization_opportunity_acceptances (
  organization_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  accepted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id,job_id),
  FOREIGN KEY (organization_id,job_id)
    REFERENCES organization_opportunities(organization_id,job_id)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_organization_resolutions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  position_item_id TEXT NOT NULL,
  source_position_id TEXT NOT NULL,
  position_input_hash TEXT NOT NULL CHECK (length(position_input_hash)=64),
  duplicate_batch_input_hash TEXT NOT NULL CHECK (
    length(duplicate_batch_input_hash)=64
  ),
  listing_id TEXT NOT NULL,
  material_version INTEGER NOT NULL CHECK (material_version>0),
  material_hash TEXT NOT NULL CHECK (length(material_hash)=64),
  content_analysis_hash TEXT NOT NULL CHECK (
    length(content_analysis_hash)=64
  ),
  match_facts_analysis_hash TEXT NOT NULL CHECK (
    length(match_facts_analysis_hash)=64
  ),
  position_analysis_hash TEXT NOT NULL CHECK (
    length(position_analysis_hash)=64
  ),
  position_payload_hash TEXT NOT NULL CHECK (
    length(position_payload_hash)=64
  ),
  normalized_company_name TEXT NOT NULL,
  asserted_country_code TEXT CHECK (
    asserted_country_code IS NULL OR length(asserted_country_code)=2
  ),
  resolved_locality TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (
    state IN ('resolved','ambiguous','unresolved','blocked')
  ),
  selected_organization_id TEXT REFERENCES organizations(id)
    ON DELETE RESTRICT,
  selected_display_name TEXT NOT NULL DEFAULT '',
  resolver_version TEXT NOT NULL CHECK (
    resolver_version='organization-resolver-v1'
  ),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'organization_explicit_link','organization_source_employer_id',
      'organization_employer_domain','organization_name_country_locality',
      'organization_candidate_only','organization_evidence_conflict',
      'organization_intermediary_only','organization_invalid_candidate',
      'organization_no_candidate','organization_input_snapshot_changed',
      'organization_input_schema_invalid'
    )
  ),
  candidate_count INTEGER NOT NULL CHECK (candidate_count>=0),
  evidence_count INTEGER NOT NULL CHECK (evidence_count>=0),
  candidate_digest TEXT NOT NULL CHECK (length(candidate_digest)=64),
  evidence_digest TEXT NOT NULL CHECK (length(evidence_digest)=64),
  resolution_hash TEXT NOT NULL CHECK (length(resolution_hash)=64),
  claim_lease_token TEXT NOT NULL CHECK (trim(claim_lease_token)<>''),
  resolution_guard_token TEXT NOT NULL CHECK (
    trim(resolution_guard_token)<>''
  ),
  created_at TEXT NOT NULL,
  UNIQUE (position_item_id),
  UNIQUE (id,run_id),
  FOREIGN KEY (position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT,
  CHECK (
    (state='resolved'
      AND selected_organization_id IS NOT NULL
      AND trim(selected_display_name)<>'')
    OR (state<>'resolved'
      AND selected_organization_id IS NULL
      AND selected_display_name='')
  )
);
CREATE TABLE public_projection_organization_candidates (
  resolution_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  organization_id TEXT NOT NULL REFERENCES organizations(id)
    ON DELETE RESTRICT,
  evidence_tier INTEGER NOT NULL CHECK (evidence_tier BETWEEN 1 AND 4),
  organization_status TEXT NOT NULL CHECK (
    organization_status IN ('unverified','active','stale','closed','invalid')
  ),
  normalized_name TEXT NOT NULL,
  country_code TEXT NOT NULL CHECK (length(country_code)=2),
  normalized_locality TEXT NOT NULL,
  normalized_domain TEXT NOT NULL,
  selected INTEGER NOT NULL CHECK (selected IN (0,1)),
  candidate_hash TEXT NOT NULL CHECK (length(candidate_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (resolution_id,ordinal),
  UNIQUE (resolution_id,organization_id),
  FOREIGN KEY (resolution_id,run_id)
    REFERENCES public_projection_organization_resolutions(id,run_id)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_organization_evidence (
  resolution_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
  evidence_tier INTEGER NOT NULL CHECK (evidence_tier BETWEEN 1 AND 4),
  evidence_kind TEXT NOT NULL CHECK (
    evidence_kind IN (
      'explicit_opportunity_link','source_employer_id','employer_domain',
      'name_country_locality','name_country_candidate',
      'organization_status','organization_record'
    )
  ),
  polarity TEXT NOT NULL CHECK (
    polarity IN ('positive','conflicting','candidate')
  ),
  source_key TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (resolution_id,ordinal),
  FOREIGN KEY (resolution_id,run_id)
    REFERENCES public_projection_organization_resolutions(id,run_id)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_location_resolutions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  position_item_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  position_input_hash TEXT NOT NULL CHECK (length(position_input_hash)=64),
  literal_label TEXT NOT NULL,
  literal_evidence TEXT NOT NULL,
  normalized_label TEXT NOT NULL,
  semantic_kind TEXT NOT NULL CHECK (
    semantic_kind IN (
      'country','region','city','postal_code','address','unknown'
    )
  ),
  location_role TEXT NOT NULL CHECK (
    location_role IN ('worksite','applicant_area','unknown')
  ),
  scope TEXT NOT NULL CHECK (
    scope IN (
      'address','locality','region','countrywide','worldwide','unknown'
    )
  ),
  workplace_type TEXT NOT NULL CHECK (
    workplace_type IN ('onsite','hybrid','remote','unknown')
  ),
  asserted_country_code TEXT CHECK (
    asserted_country_code IS NULL OR length(asserted_country_code)=2
  ),
  state TEXT NOT NULL CHECK (
    state IN ('resolved','ambiguous','unresolved','blocked')
  ),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'location_exact_provider_match','location_countrywide_match',
      'location_multiple_viable_candidates','location_country_conflict',
      'location_parent_conflict','location_no_viable_candidate',
      'location_invalid_assertion','remote_applicant_area_unbounded',
      'location_provider_auth','location_provider_rate_limit',
      'location_provider_timeout','location_provider_transport',
      'location_provider_schema','location_permanent_storage_required',
      'location_assertion_limit_exceeded'
    )
  ),
  provider TEXT NOT NULL DEFAULT '',
  selected_provider_place_id TEXT NOT NULL DEFAULT '',
  proposed_canonical_location_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  country_code TEXT CHECK (country_code IS NULL OR length(country_code)=2),
  region TEXT NOT NULL DEFAULT '',
  locality TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  bounds_json TEXT CHECK (
    bounds_json IS NULL
    OR (
      json_valid(bounds_json) AND json_type(bounds_json)='array'
      AND json_array_length(bounds_json)=4
      AND json_type(bounds_json,'$[0]') IN ('integer','real')
      AND json_type(bounds_json,'$[1]') IN ('integer','real')
      AND json_type(bounds_json,'$[2]') IN ('integer','real')
      AND json_type(bounds_json,'$[3]') IN ('integer','real')
      AND CAST(json_extract(bounds_json,'$[0]') AS REAL) BETWEEN -180 AND 180
      AND CAST(json_extract(bounds_json,'$[1]') AS REAL) BETWEEN -90 AND 90
      AND CAST(json_extract(bounds_json,'$[2]') AS REAL) BETWEEN -180 AND 180
      AND CAST(json_extract(bounds_json,'$[3]') AS REAL) BETWEEN -90 AND 90
      AND CAST(json_extract(bounds_json,'$[0]') AS REAL)<=
        CAST(json_extract(bounds_json,'$[2]') AS REAL)
      AND CAST(json_extract(bounds_json,'$[1]') AS REAL)<=
        CAST(json_extract(bounds_json,'$[3]') AS REAL)
    )
  ),
  feature_type TEXT NOT NULL DEFAULT '',
  coordinate_kind TEXT NOT NULL DEFAULT '',
  resolver_version TEXT NOT NULL CHECK (
    resolver_version='mapbox-location-resolver-v1-us'
  ),
  request_hash TEXT CHECK (request_hash IS NULL OR length(request_hash)=64),
  response_hash TEXT CHECK (
    response_hash IS NULL OR length(response_hash)=64
  ),
  candidate_count INTEGER NOT NULL CHECK (candidate_count>=0),
  viable_candidate_count INTEGER NOT NULL CHECK (
    viable_candidate_count>=0 AND viable_candidate_count<=candidate_count
  ),
  candidate_digest TEXT NOT NULL CHECK (length(candidate_digest)=64),
  evidence_digest TEXT NOT NULL CHECK (length(evidence_digest)=64),
  resolution_hash TEXT NOT NULL CHECK (length(resolution_hash)=64),
  claim_lease_token TEXT NOT NULL CHECK (trim(claim_lease_token)<>''),
  resolution_guard_token TEXT NOT NULL CHECK (
    trim(resolution_guard_token)<>''
  ),
  queried_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (run_id,position_item_id,ordinal),
  UNIQUE (id,run_id),
  FOREIGN KEY (position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT,
  CHECK (
    (state='resolved'
      AND provider='mapbox-geocoding-v6'
      AND trim(selected_provider_place_id)<>''
      AND trim(proposed_canonical_location_id)<>''
      AND trim(display_name)<>''
      AND country_code IS NOT NULL
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND request_hash IS NOT NULL
      AND response_hash IS NOT NULL
      AND queried_at IS NOT NULL)
    OR state<>'resolved'
  )
);
CREATE TABLE public_projection_location_provider_evidence (
  resolution_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider='mapbox-geocoding-v6'),
  permanent INTEGER NOT NULL CHECK (permanent=1),
  request_json TEXT NOT NULL CHECK (
    json_valid(request_json) AND json_type(request_json)='object'
    AND length(CAST(request_json AS BLOB))<=1000000
  ),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  response_json TEXT NOT NULL CHECK (
    json_valid(response_json) AND json_type(response_json)='object'
    AND length(CAST(response_json AS BLOB))<=1000000
  ),
  response_hash TEXT NOT NULL CHECK (length(response_hash)=64),
  ordered_candidate_ids_json TEXT NOT NULL CHECK (
    json_valid(ordered_candidate_ids_json)
    AND json_type(ordered_candidate_ids_json)='array'
  ),
  queried_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (resolution_id,run_id)
    REFERENCES public_projection_location_resolutions(id,run_id)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_location_candidates (
  resolution_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  provider_place_id TEXT NOT NULL CHECK (trim(provider_place_id)<>''),
  feature_type TEXT NOT NULL CHECK (
    feature_type IN (
      'country','region','postcode','district','place','locality',
      'neighborhood','street','address'
    )
  ),
  preferred_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  country_code TEXT CHECK (country_code IS NULL OR length(country_code)=2),
  region TEXT NOT NULL,
  locality TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  bounds_json TEXT CHECK (
    bounds_json IS NULL
    OR (
      json_valid(bounds_json) AND json_type(bounds_json)='array'
      AND json_array_length(bounds_json)=4
      AND json_type(bounds_json,'$[0]') IN ('integer','real')
      AND json_type(bounds_json,'$[1]') IN ('integer','real')
      AND json_type(bounds_json,'$[2]') IN ('integer','real')
      AND json_type(bounds_json,'$[3]') IN ('integer','real')
      AND CAST(json_extract(bounds_json,'$[0]') AS REAL) BETWEEN -180 AND 180
      AND CAST(json_extract(bounds_json,'$[1]') AS REAL) BETWEEN -90 AND 90
      AND CAST(json_extract(bounds_json,'$[2]') AS REAL) BETWEEN -180 AND 180
      AND CAST(json_extract(bounds_json,'$[3]') AS REAL) BETWEEN -90 AND 90
      AND CAST(json_extract(bounds_json,'$[0]') AS REAL)<=
        CAST(json_extract(bounds_json,'$[2]') AS REAL)
      AND CAST(json_extract(bounds_json,'$[1]') AS REAL)<=
        CAST(json_extract(bounds_json,'$[3]') AS REAL)
    )
  ),
  coordinate_accuracy TEXT NOT NULL,
  context_json TEXT NOT NULL CHECK (
    json_valid(context_json) AND json_type(context_json)='object'
  ),
  match_code_json TEXT NOT NULL CHECK (
    json_valid(match_code_json) AND json_type(match_code_json)='object'
  ),
  provider_order INTEGER NOT NULL CHECK (provider_order>=0),
  viable INTEGER NOT NULL CHECK (viable IN (0,1)),
  candidate_hash TEXT NOT NULL CHECK (length(candidate_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (resolution_id,ordinal),
  UNIQUE (resolution_id,provider_place_id),
  FOREIGN KEY (resolution_id,run_id)
    REFERENCES public_projection_location_resolutions(id,run_id)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_location_evidence (
  resolution_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  evidence_kind TEXT NOT NULL CHECK (
    evidence_kind IN (
      'source_assertion','provider_candidate','country_context',
      'parent_context','address_match_code'
    )
  ),
  source_reference TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (resolution_id,ordinal),
  FOREIGN KEY (resolution_id,run_id)
    REFERENCES public_projection_location_resolutions(id,run_id)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_canonical_identity_signals (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  position_item_id TEXT NOT NULL,
  organization_resolution_id TEXT NOT NULL,
  organization_resolution_hash TEXT NOT NULL CHECK (
    length(organization_resolution_hash)=64
  ),
  location_set_hash TEXT NOT NULL CHECK (length(location_set_hash)=64),
  role_family TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  normalized_subjects_json TEXT NOT NULL CHECK (
    json_valid(normalized_subjects_json)
    AND json_type(normalized_subjects_json)='array'
  ),
  location_ids_json TEXT NOT NULL CHECK (
    json_valid(location_ids_json) AND json_type(location_ids_json)='array'
  ),
  state TEXT NOT NULL CHECK (state IN ('resolved','blocked')),
  signal_hash TEXT CHECK (signal_hash IS NULL OR length(signal_hash)=64),
  signal_payload_hash TEXT NOT NULL CHECK (length(signal_payload_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,position_item_id),
  FOREIGN KEY (position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_resolution_id,run_id)
    REFERENCES public_projection_organization_resolutions(id,run_id)
    ON DELETE RESTRICT,
  CHECK (
    (state='resolved' AND signal_hash IS NOT NULL)
    OR (state='blocked' AND signal_hash IS NULL)
  )
);
CREATE TABLE public_projection_resolution_seals (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  position_item_id TEXT NOT NULL,
  source_position_id TEXT NOT NULL,
  position_input_hash TEXT NOT NULL CHECK (length(position_input_hash)=64),
  duplicate_batch_input_hash TEXT NOT NULL CHECK (
    length(duplicate_batch_input_hash)=64
  ),
  organization_resolution_id TEXT NOT NULL,
  organization_resolution_hash TEXT NOT NULL CHECK (
    length(organization_resolution_hash)=64
  ),
  location_count INTEGER NOT NULL CHECK (location_count>=1),
  location_set_hash TEXT NOT NULL CHECK (length(location_set_hash)=64),
  canonical_signal_hash TEXT CHECK (
    canonical_signal_hash IS NULL OR length(canonical_signal_hash)=64
  ),
  state TEXT NOT NULL CHECK (
    state IN ('resolved','ambiguous','unresolved','blocked')
  ),
  reason_code TEXT NOT NULL,
  seal_hash TEXT NOT NULL CHECK (length(seal_hash)=64),
  claim_lease_token TEXT NOT NULL CHECK (trim(claim_lease_token)<>''),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,position_item_id),
  FOREIGN KEY (position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_resolution_id,run_id)
    REFERENCES public_projection_organization_resolutions(id,run_id)
    ON DELETE RESTRICT,
  CHECK (
    (state='resolved' AND canonical_signal_hash IS NOT NULL)
    OR (state<>'resolved' AND canonical_signal_hash IS NULL)
  )
);
CREATE TABLE country_sweep_outputs (
  id TEXT PRIMARY KEY,
  sweep_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  agent_run_id TEXT NOT NULL REFERENCES agent_task_runs(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number>0),
  schema_version INTEGER NOT NULL CHECK (schema_version>0),
  status TEXT NOT NULL CHECK (
    status IN (
      'uploading','accepted','materializing','materialized','failed','abandoned'
    )
  ),
  next_chunk_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (next_chunk_ordinal>=0),
  rolling_sha256 TEXT NOT NULL CHECK (length(rolling_sha256)=64),
  manifest_sha256 TEXT CHECK (
    manifest_sha256 IS NULL OR length(manifest_sha256)=64
  ),
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count>=0),
  total_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes>=0),
  organization_count INTEGER NOT NULL DEFAULT 0 CHECK (organization_count>=0),
  contact_count INTEGER NOT NULL DEFAULT 0 CHECK (contact_count>=0),
  scope_count INTEGER NOT NULL DEFAULT 0 CHECK (scope_count>=0),
  coverage_summary_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(coverage_summary_json)
    AND json_type(coverage_summary_json)='object'
    AND length(CAST(coverage_summary_json AS BLOB))<=1000000
  ),
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  materialized_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id,attempt_number),
  UNIQUE(agent_run_id),
  FOREIGN KEY(task_id,sweep_id)
    REFERENCES country_sweep_tasks(id,sweep_id) ON DELETE RESTRICT
);
CREATE TABLE country_sweep_output_chunks (
  id TEXT PRIMARY KEY,
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  kind TEXT NOT NULL CHECK (kind IN ('organizations','contacts','scopes')),
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK (length(sha256)=64),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 1000000),
  record_count INTEGER NOT NULL CHECK (record_count BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  UNIQUE(output_id,ordinal)
);
CREATE TABLE country_sweep_materialization_items (
  id TEXT PRIMARY KEY,
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'organizations_chunk','contacts_chunk','scopes_chunk',
      'campaign_fanout','verification_fanout','phase_finalize'
    )
  ),
  chunk_id TEXT REFERENCES country_sweep_output_chunks(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence>=0),
  status TEXT NOT NULL CHECK (
    status IN ('queued','processing','completed','failed')
  ),
  cursor_primary TEXT NOT NULL DEFAULT '',
  cursor_secondary TEXT NOT NULL DEFAULT '',
  expected_count INTEGER NOT NULL DEFAULT 0 CHECK (expected_count>=0),
  processed_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_count>=0),
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count>=0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts>0),
  lease_owner TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  error_detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(output_id,kind,sequence),
  CHECK (attempt_count<=max_attempts),
  CHECK (processed_count<=expected_count OR expected_count=0),
  CHECK (
    (
      status='processing'
      AND lease_owner IS NOT NULL
      AND trim(lease_owner)<>''
      AND lease_token IS NOT NULL
      AND trim(lease_token)<>''
      AND lease_expires_at IS NOT NULL
      AND trim(lease_expires_at)<>''
      AND attempt_count>0
    )
    OR (
      status<>'processing'
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
    )
  ),
  CHECK (
    (kind LIKE '%_chunk' AND chunk_id IS NOT NULL)
    OR (kind NOT LIKE '%_chunk' AND chunk_id IS NULL)
  )
);
CREATE TABLE country_sweep_output_cleanup (
  output_id TEXT PRIMARY KEY
    REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','completed')
  ),
  deleted_object_count INTEGER NOT NULL DEFAULT 0 CHECK (
    deleted_object_count>=0
  ),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (
    (status='pending' AND completed_at IS NULL)
    OR (status='completed' AND completed_at IS NOT NULL)
  )
);
CREATE TABLE country_sweep_output_organizations (
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  chunk_id TEXT NOT NULL REFERENCES country_sweep_output_chunks(id) ON DELETE RESTRICT,
  identity_key TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  PRIMARY KEY(output_id,identity_key)
);
CREATE TABLE country_sweep_output_contacts (
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  chunk_id TEXT NOT NULL REFERENCES country_sweep_output_chunks(id) ON DELETE RESTRICT,
  contact_key TEXT NOT NULL,
  contact_point_id TEXT NOT NULL
    REFERENCES organization_contact_points(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  PRIMARY KEY(output_id,contact_key)
);
CREATE TABLE country_sweep_output_scopes (
  output_id TEXT NOT NULL REFERENCES country_sweep_outputs(id) ON DELETE RESTRICT,
  chunk_id TEXT NOT NULL REFERENCES country_sweep_output_chunks(id) ON DELETE RESTRICT,
  scope_key TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES country_sweep_tasks(id) ON DELETE RESTRICT,
  PRIMARY KEY(output_id,scope_key)
);
CREATE TABLE public_projection_duplicate_operator_decisions (
  id TEXT PRIMARY KEY CHECK (
    length(id)=73
    AND substr(id,1,9)='pfdec_v1_'
    AND substr(id,10) NOT GLOB '*[^0-9a-f]*'
  ),
  left_member_key TEXT NOT NULL CHECK (trim(left_member_key)<>''),
  right_member_key TEXT NOT NULL CHECK (trim(right_member_key)<>''),
  decision TEXT NOT NULL CHECK (
    decision IN ('same','different','deferred')
  ),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'operator_confirmed_same','operator_confirmed_different',
      'operator_deferred'
    )
  ),
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash)=64),
  supersedes_decision_id TEXT REFERENCES
    public_projection_duplicate_operator_decisions(id) ON DELETE RESTRICT,
  operator_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at TEXT NOT NULL,
  decision_hash TEXT NOT NULL UNIQUE CHECK (length(decision_hash)=64),
  created_at TEXT NOT NULL,
  CHECK (left_member_key<right_member_key),
  CHECK (
    (decision='same' AND reason_code='operator_confirmed_same')
    OR (decision='different'
      AND reason_code='operator_confirmed_different')
    OR (decision='deferred' AND reason_code='operator_deferred')
  )
);
CREATE TABLE public_projection_final_duplicate_relations (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  id TEXT NOT NULL CHECK (
    length(id)=73
    AND substr(id,1,9)='pfrel_v1_'
    AND substr(id,10) NOT GLOB '*[^0-9a-f]*'
  ),
  left_member_key TEXT NOT NULL CHECK (trim(left_member_key)<>''),
  left_member_kind TEXT NOT NULL CHECK (
    left_member_kind IN ('shadow','public')
  ),
  left_source_position_id TEXT REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  left_input_hash TEXT CHECK (
    left_input_hash IS NULL OR length(left_input_hash)=64
  ),
  left_public_job_id TEXT REFERENCES public_jobs(id) ON DELETE RESTRICT,
  left_public_job_version INTEGER CHECK (
    left_public_job_version IS NULL OR left_public_job_version>0
  ),
  left_eligibility_decision_version INTEGER CHECK (
    left_eligibility_decision_version IS NULL
    OR left_eligibility_decision_version>0
  ),
  right_member_key TEXT NOT NULL CHECK (trim(right_member_key)<>''),
  right_member_kind TEXT NOT NULL CHECK (
    right_member_kind IN ('shadow','public')
  ),
  right_source_position_id TEXT REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  right_input_hash TEXT CHECK (
    right_input_hash IS NULL OR length(right_input_hash)=64
  ),
  right_public_job_id TEXT REFERENCES public_jobs(id) ON DELETE RESTRICT,
  right_public_job_version INTEGER CHECK (
    right_public_job_version IS NULL OR right_public_job_version>0
  ),
  right_eligibility_decision_version INTEGER CHECK (
    right_eligibility_decision_version IS NULL
    OR right_eligibility_decision_version>0
  ),
  d2_comparison_id TEXT REFERENCES public_projection_duplicate_comparisons(id)
    ON DELETE RESTRICT,
  matching_signals_json TEXT NOT NULL CHECK (
    json_valid(matching_signals_json)
    AND json_type(matching_signals_json)='array'
  ),
  conflicting_signals_json TEXT NOT NULL CHECK (
    json_valid(conflicting_signals_json)
    AND json_type(conflicting_signals_json)='array'
  ),
  operator_decision_id TEXT REFERENCES
    public_projection_duplicate_operator_decisions(id) ON DELETE RESTRICT,
  relation TEXT NOT NULL CHECK (
    relation IN ('same','different','ambiguous')
  ),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'same_source_position','same_source_reference_position',
      'same_employer_requisition','operator_confirmed_same',
      'same_listing_distinct_position','conflicting_stable_identifier',
      'conflicting_canonical_facts','operator_confirmed_different',
      'canonical_identity_only','duplicate_evidence_conflict',
      'operator_deferred'
    )
  ),
  finalization_algorithm_version TEXT NOT NULL CHECK (
    finalization_algorithm_version='public-duplicate-finalization-v1'
  ),
  relation_hash TEXT NOT NULL CHECK (length(relation_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,id),
  UNIQUE (run_id,left_member_key,right_member_key),
  FOREIGN KEY (left_public_job_id,left_public_job_version)
    REFERENCES public_job_versions(public_job_id,version) ON DELETE RESTRICT,
  FOREIGN KEY (left_public_job_id,left_eligibility_decision_version)
    REFERENCES public_job_eligibility_decisions(public_job_id,decision_version)
    ON DELETE RESTRICT,
  FOREIGN KEY (right_public_job_id,right_public_job_version)
    REFERENCES public_job_versions(public_job_id,version) ON DELETE RESTRICT,
  FOREIGN KEY (right_public_job_id,right_eligibility_decision_version)
    REFERENCES public_job_eligibility_decisions(public_job_id,decision_version)
    ON DELETE RESTRICT,
  CHECK (left_member_key<right_member_key),
  CHECK (
    (left_member_kind='shadow'
      AND left_source_position_id IS NOT NULL
      AND left_input_hash IS NOT NULL
      AND left_member_key='shadow:' || left_source_position_id || ':' ||
        left_input_hash
      AND left_public_job_id IS NULL
      AND left_public_job_version IS NULL
      AND left_eligibility_decision_version IS NULL)
    OR (left_member_kind='public'
      AND left_source_position_id IS NULL
      AND left_input_hash IS NULL
      AND left_public_job_id IS NOT NULL
      AND left_public_job_version IS NOT NULL
      AND left_eligibility_decision_version IS NOT NULL
      AND left_member_key='public:' || left_public_job_id || ':' ||
        left_public_job_version || ':' || left_eligibility_decision_version)
  ),
  CHECK (
    (right_member_kind='shadow'
      AND right_source_position_id IS NOT NULL
      AND right_input_hash IS NOT NULL
      AND right_member_key='shadow:' || right_source_position_id || ':' ||
        right_input_hash
      AND right_public_job_id IS NULL
      AND right_public_job_version IS NULL
      AND right_eligibility_decision_version IS NULL)
    OR (right_member_kind='public'
      AND right_source_position_id IS NULL
      AND right_input_hash IS NULL
      AND right_public_job_id IS NOT NULL
      AND right_public_job_version IS NOT NULL
      AND right_eligibility_decision_version IS NOT NULL
      AND right_member_key='public:' || right_public_job_id || ':' ||
        right_public_job_version || ':' || right_eligibility_decision_version)
  ),
  CHECK (
    (relation='same' AND reason_code IN (
      'same_source_position','same_source_reference_position',
      'same_employer_requisition','operator_confirmed_same'
    ))
    OR (relation='different' AND reason_code IN (
      'same_listing_distinct_position','conflicting_stable_identifier',
      'conflicting_canonical_facts','operator_confirmed_different'
    ))
    OR (relation='ambiguous' AND reason_code IN (
      'canonical_identity_only','duplicate_evidence_conflict',
      'operator_deferred'
    ))
  )
);
CREATE TABLE public_projection_allocation_components (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  id TEXT NOT NULL CHECK (
    length(id)=74
    AND substr(id,1,10)='palloc_v1_'
    AND substr(id,11) NOT GLOB '*[^0-9a-f]*'
  ),
  finalization_algorithm_version TEXT NOT NULL CHECK (
    finalization_algorithm_version='public-duplicate-finalization-v1'
  ),
  allocation_algorithm_version TEXT NOT NULL CHECK (
    allocation_algorithm_version='public-job-allocation-v1'
  ),
  member_count INTEGER NOT NULL CHECK (member_count>0),
  relation_count INTEGER NOT NULL CHECK (relation_count>=0),
  candidate_root_count INTEGER NOT NULL CHECK (candidate_root_count>=0),
  founding_source_position_id TEXT REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  proposed_public_job_id TEXT,
  winning_public_job_id TEXT REFERENCES public_jobs(id) ON DELETE RESTRICT,
  losing_root_count INTEGER NOT NULL CHECK (losing_root_count>=0),
  state TEXT NOT NULL CHECK (state IN ('promotable','blocked')),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'new_public_entity','existing_source_mapping',
      'existing_duplicate_winner','public_identity_ambiguous',
      'public_job_id_collision','promotion_component_too_large'
    )
  ),
  allocation_hash TEXT NOT NULL CHECK (length(allocation_hash)=64),
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,id),
  CHECK (
    (state='promotable' AND reason_code='new_public_entity'
      AND founding_source_position_id IS NOT NULL
      AND proposed_public_job_id IS NOT NULL
      AND winning_public_job_id IS NULL
      AND candidate_root_count=0 AND losing_root_count=0)
    OR (state='promotable'
      AND reason_code IN (
        'existing_source_mapping','existing_duplicate_winner'
      )
      AND proposed_public_job_id IS NULL
      AND winning_public_job_id IS NOT NULL
      AND candidate_root_count>=1
      AND losing_root_count=candidate_root_count-1)
    OR (state='blocked' AND reason_code='public_identity_ambiguous'
      AND proposed_public_job_id IS NULL
      AND winning_public_job_id IS NULL
      AND losing_root_count=candidate_root_count)
    OR (state='blocked' AND reason_code='public_job_id_collision'
      AND founding_source_position_id IS NOT NULL
      AND proposed_public_job_id IS NOT NULL
      AND winning_public_job_id IS NULL
      AND candidate_root_count=0 AND losing_root_count=0)
    OR (state='blocked' AND reason_code='promotion_component_too_large'
      AND member_count>25
      AND founding_source_position_id IS NOT NULL
      AND proposed_public_job_id IS NULL
      AND winning_public_job_id IS NULL
      AND losing_root_count=candidate_root_count)
  )
);
CREATE TABLE public_projection_allocation_members (
  run_id TEXT NOT NULL,
  allocation_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  member_key TEXT NOT NULL CHECK (trim(member_key)<>''),
  member_kind TEXT NOT NULL CHECK (member_kind IN ('shadow','public')),
  position_item_id TEXT,
  source_position_id TEXT REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  input_hash TEXT CHECK (input_hash IS NULL OR length(input_hash)=64),
  public_job_id TEXT REFERENCES public_jobs(id) ON DELETE RESTRICT,
  public_job_version INTEGER CHECK (
    public_job_version IS NULL OR public_job_version>0
  ),
  eligibility_decision_version INTEGER CHECK (
    eligibility_decision_version IS NULL OR eligibility_decision_version>0
  ),
  member_hash TEXT NOT NULL CHECK (length(member_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,allocation_id,ordinal),
  UNIQUE (run_id,allocation_id,member_key),
  FOREIGN KEY (run_id,allocation_id)
    REFERENCES public_projection_allocation_components(run_id,id)
    ON DELETE RESTRICT,
  FOREIGN KEY (position_item_id,run_id)
    REFERENCES public_projection_position_items(id,run_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version) ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,eligibility_decision_version)
    REFERENCES public_job_eligibility_decisions(public_job_id,decision_version)
    ON DELETE RESTRICT,
  CHECK (
    (member_kind='shadow' AND position_item_id IS NOT NULL
      AND source_position_id IS NOT NULL AND input_hash IS NOT NULL
      AND public_job_id IS NULL AND public_job_version IS NULL
      AND eligibility_decision_version IS NULL)
    OR (member_kind='public' AND position_item_id IS NULL
      AND source_position_id IS NULL AND input_hash IS NULL
      AND public_job_id IS NOT NULL AND public_job_version IS NOT NULL
      AND eligibility_decision_version IS NOT NULL)
  )
);
CREATE TABLE public_projection_allocation_roots (
  run_id TEXT NOT NULL,
  allocation_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  member_key TEXT NOT NULL CHECK (trim(member_key)<>''),
  public_job_id TEXT NOT NULL REFERENCES public_jobs(id) ON DELETE RESTRICT,
  public_job_version INTEGER NOT NULL CHECK (public_job_version>0),
  eligibility_decision_version INTEGER NOT NULL CHECK (
    eligibility_decision_version>0
  ),
  served_publicly INTEGER NOT NULL CHECK (served_publicly IN (0,1)),
  first_published_at TEXT,
  public_job_created_at TEXT NOT NULL,
  founding_source_position_id TEXT REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  selected INTEGER NOT NULL CHECK (selected IN (0,1)),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'existing_source_mapping','existing_duplicate_winner',
      'merged_into_existing_winner','public_identity_ambiguous',
      'promotion_component_too_large'
    )
  ),
  root_hash TEXT NOT NULL CHECK (length(root_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,allocation_id,ordinal),
  UNIQUE (run_id,allocation_id,member_key),
  UNIQUE (run_id,allocation_id,public_job_id),
  FOREIGN KEY (run_id,allocation_id)
    REFERENCES public_projection_allocation_components(run_id,id)
    ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version) ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,eligibility_decision_version)
    REFERENCES public_job_eligibility_decisions(public_job_id,decision_version)
    ON DELETE RESTRICT,
  CHECK (
    (served_publicly=0 AND first_published_at IS NULL)
    OR (served_publicly=1 AND first_published_at IS NOT NULL)
  ),
  CHECK (
    member_key='public:' || public_job_id || ':' || public_job_version || ':' ||
      eligibility_decision_version
  ),
  CHECK (
    (selected=1 AND reason_code IN (
      'existing_source_mapping','existing_duplicate_winner'
    ))
    OR (selected=0 AND reason_code IN (
      'merged_into_existing_winner','public_identity_ambiguous',
      'promotion_component_too_large'
    ))
  )
);
CREATE TABLE public_projection_allocation_relations (
  run_id TEXT NOT NULL,
  allocation_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  relation_id TEXT NOT NULL,
  relation_hash TEXT NOT NULL CHECK (length(relation_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,allocation_id,ordinal),
  UNIQUE (run_id,allocation_id,relation_id),
  FOREIGN KEY (run_id,allocation_id)
    REFERENCES public_projection_allocation_components(run_id,id)
    ON DELETE RESTRICT,
  FOREIGN KEY (run_id,relation_id)
    REFERENCES public_projection_final_duplicate_relations(run_id,id)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_final_canonical_live_inputs (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  public_job_id TEXT NOT NULL REFERENCES public_jobs(id) ON DELETE RESTRICT,
  public_job_version INTEGER NOT NULL CHECK (public_job_version>0),
  signal_kind TEXT NOT NULL CHECK (signal_kind='canonical_identity_v1'),
  signal_hash TEXT NOT NULL CHECK (length(signal_hash)=64),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (
    run_id,public_job_id,public_job_version,signal_kind,signal_hash
  ),
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version) ON DELETE RESTRICT
);
CREATE TABLE public_projection_final_source_mapping_inputs (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  source_position_id TEXT NOT NULL REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  mapping_version INTEGER NOT NULL CHECK (mapping_version>0),
  public_job_id TEXT NOT NULL REFERENCES public_jobs(id) ON DELETE RESTRICT,
  mapping_hash TEXT NOT NULL CHECK (length(mapping_hash)=64),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,source_position_id),
  FOREIGN KEY (source_position_id,mapping_version)
    REFERENCES job_source_position_mapping_versions(source_position_id,version)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_final_work (
  run_id TEXT PRIMARY KEY REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  input_digest TEXT NOT NULL CHECK (length(input_digest)=64),
  phase TEXT NOT NULL CHECK (phase IN (
    'resolution_inputs','mapping_inputs','canonical_requests',
    'canonical_matches','public_roots','relations','components',
    'allocation_digest','ready','sealed'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'queued','processing','sealed','failed','superseded'
  )),
  phase_cursor TEXT NOT NULL DEFAULT '',
  phase_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (phase_ordinal>=0),
  active_component_seed TEXT,
  resolution_count INTEGER NOT NULL DEFAULT 0 CHECK (resolution_count>=0),
  resolution_bytes INTEGER NOT NULL DEFAULT 0 CHECK (resolution_bytes>=0),
  resolution_digest TEXT CHECK (
    resolution_digest IS NULL OR length(resolution_digest)=64
  ),
  resolution_last_cursor TEXT NOT NULL DEFAULT '',
  mapping_count INTEGER NOT NULL DEFAULT 0 CHECK (mapping_count>=0),
  mapping_bytes INTEGER NOT NULL DEFAULT 0 CHECK (mapping_bytes>=0),
  mapping_digest TEXT CHECK (
    mapping_digest IS NULL OR length(mapping_digest)=64
  ),
  mapping_last_cursor TEXT NOT NULL DEFAULT '',
  source_mapping_count INTEGER NOT NULL DEFAULT 0 CHECK (
    source_mapping_count>=0
  ),
  source_mapping_digest TEXT CHECK (
    source_mapping_digest IS NULL OR length(source_mapping_digest)=64
  ),
  source_mapping_last_cursor TEXT NOT NULL DEFAULT '',
  canonical_request_count INTEGER NOT NULL DEFAULT 0 CHECK (
    canonical_request_count>=0
  ),
  canonical_request_bytes INTEGER NOT NULL DEFAULT 0 CHECK (
    canonical_request_bytes>=0
  ),
  canonical_request_digest TEXT CHECK (
    canonical_request_digest IS NULL OR length(canonical_request_digest)=64
  ),
  canonical_request_last_cursor TEXT NOT NULL DEFAULT '',
  canonical_match_count INTEGER NOT NULL DEFAULT 0 CHECK (
    canonical_match_count>=0
  ),
  canonical_match_bytes INTEGER NOT NULL DEFAULT 0 CHECK (
    canonical_match_bytes>=0
  ),
  canonical_match_digest TEXT CHECK (
    canonical_match_digest IS NULL OR length(canonical_match_digest)=64
  ),
  canonical_match_last_cursor TEXT NOT NULL DEFAULT '',
  public_root_count INTEGER NOT NULL DEFAULT 0 CHECK (public_root_count>=0),
  public_root_bytes INTEGER NOT NULL DEFAULT 0 CHECK (public_root_bytes>=0),
  public_root_digest TEXT CHECK (
    public_root_digest IS NULL OR length(public_root_digest)=64
  ),
  public_root_last_cursor TEXT NOT NULL DEFAULT '',
  relation_count INTEGER NOT NULL DEFAULT 0 CHECK (relation_count>=0),
  relation_bytes INTEGER NOT NULL DEFAULT 0 CHECK (relation_bytes>=0),
  relation_digest TEXT CHECK (
    relation_digest IS NULL OR length(relation_digest)=64
  ),
  relation_last_cursor TEXT NOT NULL DEFAULT '',
  component_count INTEGER NOT NULL DEFAULT 0 CHECK (component_count>=0),
  component_bytes INTEGER NOT NULL DEFAULT 0 CHECK (component_bytes>=0),
  component_digest TEXT CHECK (
    component_digest IS NULL OR length(component_digest)=64
  ),
  component_last_cursor TEXT NOT NULL DEFAULT '',
  allocation_bytes INTEGER NOT NULL DEFAULT 0 CHECK (allocation_bytes>=0),
  allocation_digest TEXT CHECK (
    allocation_digest IS NULL OR length(allocation_digest)=64
  ),
  lease_token TEXT,
  lease_expires_at TEXT,
  lease_epoch INTEGER NOT NULL DEFAULT 0 CHECK (lease_epoch>=0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  last_error_code TEXT,
  last_error_message TEXT,
  frozen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (status='processing' AND lease_token IS NOT NULL
      AND trim(lease_token)<>'' AND lease_expires_at IS NOT NULL
      AND trim(lease_expires_at)<>'')
    OR (status<>'processing' AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK ((phase='sealed')=(status='sealed'))
);
CREATE TABLE public_projection_final_work_resolution_inputs (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  position_item_id TEXT NOT NULL,
  source_position_id TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  checkpoint_json TEXT NOT NULL CHECK (
    json_valid(checkpoint_json) AND json_type(checkpoint_json)='object'
  ),
  resolution_state TEXT NOT NULL CHECK (
    resolution_state IN ('ambiguous','blocked','resolved','unresolved')
  ),
  resolution_reason_code TEXT NOT NULL,
  resolution_seal_hash TEXT NOT NULL CHECK (length(resolution_seal_hash)=64),
  canonical_signal_hash TEXT CHECK (
    canonical_signal_hash IS NULL OR length(canonical_signal_hash)=64
  ),
  member_key TEXT,
  member_hash TEXT CHECK (member_hash IS NULL OR length(member_hash)=64),
  row_hash TEXT NOT NULL CHECK (length(row_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,position_item_id),
  UNIQUE (run_id,ordinal),
  UNIQUE (run_id,source_position_id,input_hash)
);
CREATE TABLE public_projection_final_work_mapping_inputs (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  source_position_id TEXT NOT NULL,
  head_present INTEGER NOT NULL CHECK (head_present IN (0,1)),
  mapping_state TEXT NOT NULL CHECK (
    mapping_state IN ('absent','mapped','unmapped')
  ),
  mapping_version INTEGER CHECK (mapping_version IS NULL OR mapping_version>0),
  public_job_id TEXT,
  mapping_hash TEXT CHECK (mapping_hash IS NULL OR length(mapping_hash)=64),
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  row_hash TEXT NOT NULL CHECK (length(row_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,source_position_id),
  UNIQUE (run_id,ordinal),
  CHECK (
    (mapping_state='absent' AND head_present=0
      AND mapping_version IS NULL AND public_job_id IS NULL
      AND mapping_hash IS NULL)
    OR (mapping_state='mapped' AND head_present=1
      AND mapping_version IS NOT NULL AND public_job_id IS NOT NULL
      AND mapping_hash IS NOT NULL)
    OR (mapping_state='unmapped' AND head_present=1
      AND mapping_version IS NOT NULL AND public_job_id IS NULL
      AND mapping_hash IS NOT NULL)
  )
);
CREATE TABLE public_projection_final_work_canonical_requests (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  signal_hash TEXT NOT NULL CHECK (length(signal_hash)=64),
  match_count INTEGER NOT NULL DEFAULT 0 CHECK (match_count>=0),
  match_digest TEXT CHECK (match_digest IS NULL OR length(match_digest)=64),
  match_cursor TEXT NOT NULL DEFAULT '',
  match_complete INTEGER NOT NULL DEFAULT 0 CHECK (match_complete IN (0,1)),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,signal_hash),
  UNIQUE (run_id,ordinal),
  CHECK (match_complete=0 OR match_digest IS NOT NULL)
);
CREATE TABLE public_projection_final_work_canonical_matches (
  run_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  signal_hash TEXT NOT NULL,
  public_job_id TEXT NOT NULL,
  public_job_version INTEGER NOT NULL CHECK (public_job_version>0),
  signal_kind TEXT NOT NULL CHECK (signal_kind='canonical_identity_v1'),
  public_member_key TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  row_hash TEXT NOT NULL CHECK (length(row_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,signal_hash,public_job_id,public_job_version),
  UNIQUE (run_id,ordinal),
  FOREIGN KEY (run_id,signal_hash)
    REFERENCES public_projection_final_work_canonical_requests(run_id,signal_hash)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_final_work_canonical_members (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  public_member_key TEXT NOT NULL,
  signal_hash TEXT NOT NULL CHECK (length(signal_hash)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,public_member_key,signal_hash)
);
CREATE TABLE public_projection_final_work_public_roots (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  originating_public_job_id TEXT NOT NULL,
  redirect_root_id TEXT NOT NULL,
  public_member_key TEXT NOT NULL,
  redirect_path_json TEXT NOT NULL CHECK (
    json_valid(redirect_path_json) AND json_type(redirect_path_json)='array'
  ),
  public_job_version INTEGER NOT NULL CHECK (public_job_version>0),
  eligibility_decision_version INTEGER NOT NULL CHECK (
    eligibility_decision_version>0
  ),
  public_job_created_at TEXT NOT NULL,
  served_publicly INTEGER NOT NULL CHECK (served_publicly IN (0,1)),
  first_published_at TEXT,
  founding_source_position_id TEXT,
  allocation_hash TEXT CHECK (allocation_hash IS NULL OR length(allocation_hash)=64),
  content_head_hash TEXT NOT NULL CHECK (length(content_head_hash)=64),
  redirect_path_hash TEXT NOT NULL CHECK (length(redirect_path_hash)=64),
  history_hash TEXT NOT NULL CHECK (length(history_hash)=64),
  allocation_input_hash TEXT NOT NULL CHECK (length(allocation_input_hash)=64),
  row_hash TEXT NOT NULL CHECK (length(row_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,originating_public_job_id),
  UNIQUE (run_id,ordinal)
);
CREATE TABLE public_projection_final_work_relations (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  id TEXT NOT NULL,
  left_member_key TEXT NOT NULL,
  right_member_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json) AND json_type(payload_json)='object'
  ),
  operator_decision_id TEXT,
  operator_decision_hash TEXT CHECK (
    operator_decision_hash IS NULL OR length(operator_decision_hash)=64
  ),
  operator_terminal INTEGER NOT NULL CHECK (operator_terminal IN (0,1)),
  relation TEXT NOT NULL CHECK (relation IN ('same','different','ambiguous')),
  relation_hash TEXT NOT NULL CHECK (length(relation_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,id),
  UNIQUE (run_id,ordinal),
  UNIQUE (run_id,left_member_key,right_member_key),
  CHECK (left_member_key<right_member_key)
);
CREATE TABLE public_projection_final_component_work (
  run_id TEXT NOT NULL REFERENCES public_projection_final_work(run_id)
    ON DELETE RESTRICT,
  seed_member_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'expanding','members','roots','relations','updates','sealed'
  )),
  child_cursor TEXT NOT NULL DEFAULT '',
  member_count INTEGER NOT NULL DEFAULT 0 CHECK (member_count>=0),
  relation_count INTEGER NOT NULL DEFAULT 0 CHECK (relation_count>=0),
  root_count INTEGER NOT NULL DEFAULT 0 CHECK (root_count>=0),
  root_candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (
    root_candidate_count>=0
  ),
  root_expected_count INTEGER CHECK (
    root_expected_count IS NULL OR root_expected_count>=0
  ),
  root_summary_ready INTEGER NOT NULL DEFAULT 0 CHECK (
    root_summary_ready IN (0,1)
  ),
  oversized INTEGER NOT NULL DEFAULT 0 CHECK (oversized IN (0,1)),
  ambiguous INTEGER NOT NULL DEFAULT 0 CHECK (ambiguous IN (0,1)),
  source_mapped_winner INTEGER NOT NULL DEFAULT 0 CHECK (
    source_mapped_winner IN (0,1)
  ),
  member_digest TEXT CHECK (member_digest IS NULL OR length(member_digest)=64),
  member_last_cursor TEXT NOT NULL DEFAULT '',
  relation_digest TEXT CHECK (
    relation_digest IS NULL OR length(relation_digest)=64
  ),
  relation_last_cursor TEXT NOT NULL DEFAULT '',
  root_digest TEXT CHECK (root_digest IS NULL OR length(root_digest)=64),
  root_last_cursor TEXT NOT NULL DEFAULT '',
  update_last_cursor TEXT NOT NULL DEFAULT '',
  allocation_id TEXT,
  allocation_hash TEXT CHECK (allocation_hash IS NULL OR length(allocation_hash)=64),
  artifact_hash TEXT CHECK (artifact_hash IS NULL OR length(artifact_hash)=64),
  founding_source_position_id TEXT,
  proposed_public_job_id TEXT,
  winning_public_job_id TEXT,
  losing_root_count INTEGER CHECK (
    losing_root_count IS NULL OR losing_root_count>=0
  ),
  allocation_state TEXT CHECK (
    allocation_state IS NULL OR allocation_state IN ('promotable','blocked')
  ),
  reason_code TEXT,
  encoded_bytes INTEGER NOT NULL DEFAULT 0 CHECK (encoded_bytes>=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key)
);
CREATE TABLE public_projection_final_component_frontier (
  run_id TEXT NOT NULL,
  seed_member_key TEXT NOT NULL,
  member_key TEXT NOT NULL,
  expanded INTEGER NOT NULL DEFAULT 0 CHECK (expanded IN (0,1)),
  left_edge_cursor TEXT NOT NULL DEFAULT '',
  right_edge_cursor TEXT NOT NULL DEFAULT '',
  ordinal INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key,member_key),
  UNIQUE (run_id,member_key),
  FOREIGN KEY (run_id,seed_member_key)
    REFERENCES public_projection_final_component_work(run_id,seed_member_key)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_final_work_component_members (
  run_id TEXT NOT NULL,
  seed_member_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json) AND json_type(payload_json)='object'
  ),
  member_hash TEXT NOT NULL CHECK (length(member_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key,ordinal),
  UNIQUE (run_id,seed_member_key,member_hash),
  FOREIGN KEY (run_id,seed_member_key)
    REFERENCES public_projection_final_component_work(run_id,seed_member_key)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_final_work_component_roots (
  run_id TEXT NOT NULL,
  seed_member_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json) AND json_type(payload_json)='object'
  ),
  root_hash TEXT NOT NULL CHECK (length(root_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key,ordinal),
  FOREIGN KEY (run_id,seed_member_key)
    REFERENCES public_projection_final_component_work(run_id,seed_member_key)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_final_work_component_relations (
  run_id TEXT NOT NULL,
  seed_member_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  relation_id TEXT NOT NULL,
  relation_hash TEXT NOT NULL CHECK (length(relation_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key,ordinal),
  UNIQUE (run_id,seed_member_key,relation_id),
  FOREIGN KEY (run_id,seed_member_key)
    REFERENCES public_projection_final_component_work(run_id,seed_member_key)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_final_component_root_candidates (
  run_id TEXT NOT NULL,
  seed_member_key TEXT NOT NULL,
  member_key TEXT NOT NULL,
  originating_public_job_id TEXT NOT NULL,
  served_publicly INTEGER NOT NULL CHECK (served_publicly IN (0,1)),
  published_missing_rank INTEGER NOT NULL CHECK (
    published_missing_rank IN (0,1)
  ),
  first_published_sort TEXT NOT NULL,
  public_job_created_at TEXT NOT NULL,
  redirect_root_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key,member_key),
  FOREIGN KEY (run_id,seed_member_key)
    REFERENCES public_projection_final_component_work(run_id,seed_member_key)
    ON DELETE RESTRICT,
  FOREIGN KEY (run_id,originating_public_job_id)
    REFERENCES public_projection_final_work_public_roots(
      run_id,originating_public_job_id
    )
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_final_work_position_updates (
  run_id TEXT NOT NULL,
  seed_member_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal>=0),
  position_item_id TEXT NOT NULL,
  source_position_id TEXT NOT NULL,
  input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
  checkpoint_json TEXT NOT NULL CHECK (
    json_valid(checkpoint_json) AND json_type(checkpoint_json)='object'
  ),
  row_hash TEXT NOT NULL CHECK (length(row_hash)=64),
  encoded_bytes INTEGER NOT NULL CHECK (encoded_bytes>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,seed_member_key,ordinal),
  UNIQUE (run_id,position_item_id),
  FOREIGN KEY (run_id,seed_member_key)
    REFERENCES public_projection_final_component_work(run_id,seed_member_key)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_final_duplicate_seals (
  run_id TEXT PRIMARY KEY REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  duplicate_batch_input_hash TEXT NOT NULL CHECK (
    length(duplicate_batch_input_hash)=64
  ),
  resolution_digest TEXT NOT NULL CHECK (length(resolution_digest)=64),
  relation_digest TEXT NOT NULL CHECK (length(relation_digest)=64),
  allocation_digest TEXT NOT NULL CHECK (length(allocation_digest)=64),
  resolution_count INTEGER NOT NULL CHECK (resolution_count>=0),
  resolved_position_count INTEGER NOT NULL CHECK (
    resolved_position_count>=0
  ),
  blocked_resolution_count INTEGER NOT NULL CHECK (
    blocked_resolution_count>=0
  ),
  canonical_live_input_count INTEGER NOT NULL CHECK (
    canonical_live_input_count>=0
  ),
  canonical_live_input_digest TEXT NOT NULL CHECK (
    length(canonical_live_input_digest)=64
  ),
  source_mapping_input_count INTEGER NOT NULL CHECK (
    source_mapping_input_count>=0
  ),
  source_mapping_input_digest TEXT NOT NULL CHECK (
    length(source_mapping_input_digest)=64
  ),
  relation_count INTEGER NOT NULL CHECK (relation_count>=0),
  allocation_count INTEGER NOT NULL CHECK (allocation_count>=0),
  promotable_count INTEGER NOT NULL CHECK (promotable_count>=0),
  blocked_allocation_count INTEGER NOT NULL CHECK (
    blocked_allocation_count>=0
  ),
  finalization_algorithm_version TEXT NOT NULL CHECK (
    finalization_algorithm_version='public-duplicate-finalization-v1'
  ),
  allocation_algorithm_version TEXT NOT NULL CHECK (
    allocation_algorithm_version='public-job-allocation-v1'
  ),
  seal_hash TEXT NOT NULL CHECK (length(seal_hash)=64),
  created_at TEXT NOT NULL,
  CHECK (resolution_count=resolved_position_count+blocked_resolution_count),
  CHECK (allocation_count=promotable_count+blocked_allocation_count)
);
CREATE TABLE public_job_allocations (
  public_job_id TEXT PRIMARY KEY REFERENCES public_jobs(id)
    ON DELETE RESTRICT,
  allocation_algorithm_version TEXT NOT NULL CHECK (
    allocation_algorithm_version='public-job-allocation-v1'
  ),
  founding_source_position_id TEXT NOT NULL REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  allocation_hash TEXT NOT NULL CHECK (length(allocation_hash)=64),
  originating_run_id TEXT NOT NULL,
  originating_allocation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (originating_run_id,originating_allocation_id)
    REFERENCES public_projection_allocation_components(run_id,id)
    ON DELETE RESTRICT
);
CREATE TABLE public_projection_final_assertions (
  expected_changes INTEGER NOT NULL CHECK (expected_changes>=0),
  actual_changes INTEGER NOT NULL,
  CHECK (expected_changes=actual_changes)
);
CREATE TABLE public_projection_candidate_results (
  run_id TEXT NOT NULL REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  allocation_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared','blocked')),
  reason_code TEXT NOT NULL CHECK (trim(reason_code)<>''),
  public_job_id TEXT,
  source_position_id TEXT REFERENCES job_source_positions(id)
    ON DELETE RESTRICT,
  candidate_id TEXT UNIQUE,
  candidate_hash TEXT CHECK (
    candidate_hash IS NULL OR length(candidate_hash)=64
  ),
  candidate_json TEXT CHECK (
    candidate_json IS NULL
    OR (json_valid(candidate_json) AND json_type(candidate_json)='object')
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id,allocation_id),
  FOREIGN KEY (run_id,allocation_id)
    REFERENCES public_projection_allocation_components(run_id,id)
    ON DELETE RESTRICT,
  CHECK (
    (state='prepared'
      AND reason_code='candidate_prepared'
      AND public_job_id IS NOT NULL
      AND source_position_id IS NOT NULL
      AND candidate_id IS NOT NULL
      AND candidate_hash IS NOT NULL
      AND candidate_json IS NOT NULL)
    OR (state='blocked'
      AND public_job_id IS NULL
      AND candidate_id IS NULL
      AND candidate_hash IS NULL
      AND candidate_json IS NULL)
  )
);
CREATE TABLE public_projection_candidate_seals (
  run_id TEXT PRIMARY KEY REFERENCES public_projection_runs(id)
    ON DELETE RESTRICT,
  final_duplicate_seal_hash TEXT NOT NULL CHECK (
    length(final_duplicate_seal_hash)=64
  ),
  result_count INTEGER NOT NULL CHECK (result_count>=0),
  prepared_count INTEGER NOT NULL CHECK (prepared_count>=0),
  blocked_count INTEGER NOT NULL CHECK (blocked_count>=0),
  result_digest TEXT NOT NULL CHECK (length(result_digest)=64),
  created_at TEXT NOT NULL,
  CHECK (result_count=prepared_count+blocked_count)
);
CREATE TABLE public_projection_promotion_manifests (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  allocation_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  candidate_hash TEXT NOT NULL CHECK (length(candidate_hash)=64),
  candidate_seal_digest TEXT NOT NULL CHECK (
    length(candidate_seal_digest)=64
  ),
  predecessor_catalog_version TEXT NOT NULL REFERENCES
    public_job_catalog_versions(version) ON DELETE RESTRICT,
  activated_catalog_version TEXT NOT NULL REFERENCES
    public_job_catalog_versions(version) ON DELETE RESTRICT,
  public_job_id TEXT NOT NULL REFERENCES public_jobs(id) ON DELETE RESTRICT,
  public_job_version INTEGER NOT NULL CHECK (public_job_version>0),
  eligibility_decision_version INTEGER NOT NULL CHECK (
    eligibility_decision_version>0
  ),
  authorized_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  authorized_at TEXT NOT NULL,
  manifest_hash TEXT NOT NULL UNIQUE CHECK (length(manifest_hash)=64),
  completed_at TEXT NOT NULL,
  UNIQUE (run_id,allocation_id),
  UNIQUE (candidate_id),
  FOREIGN KEY (run_id,allocation_id)
    REFERENCES public_projection_candidate_results(run_id,allocation_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,eligibility_decision_version)
    REFERENCES public_job_eligibility_decisions(
      public_job_id,decision_version
    ) ON DELETE RESTRICT
);
CREATE TABLE google_indexing_events (
  id TEXT PRIMARY KEY,
  public_job_id TEXT NOT NULL REFERENCES public_jobs(id) ON DELETE RESTRICT,
  public_job_version INTEGER NOT NULL CHECK (public_job_version>0),
  canonical_path TEXT NOT NULL CHECK (
    canonical_path GLOB '/job/pjob_v1_*/*'
  ),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('URL_UPDATED','URL_DELETED')
  ),
  catalog_version TEXT NOT NULL,
  public_content_hash TEXT NOT NULL CHECK (length(public_content_hash)=64),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','processing','delivered','failed')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  next_attempt_at TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  response_json TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(response_json) AND json_type(response_json)='object'
  ),
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(catalog_version,public_job_id,event_type),
  CHECK (
    (status='delivered' AND delivered_at IS NOT NULL)
    OR (status<>'delivered' AND delivered_at IS NULL)
  )
);
CREATE TABLE campaign_delivery_authorization_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acting_user_id TEXT NOT NULL CHECK (trim(acting_user_id)<>''),
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  authorized_scope TEXT NOT NULL CHECK (authorized_scope IN ('campaigns')),
  reason TEXT NOT NULL CHECK (trim(reason)<>''),
  created_at TEXT NOT NULL
);
CREATE TABLE "gmail_mailbox_watches" (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL UNIQUE,
  history_id TEXT NOT NULL,
  expiration_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active','error','expired','revoked')
  ),
  renewal_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (
    renewal_failure_count>=0
  ),
  renewal_auth_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (
    renewal_auth_failure_count>=0
  ),
  next_renewal_attempt_at TEXT,
  last_synced_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE public_job_catalog_members (
  public_job_id TEXT NOT NULL,
  valid_from_ordinal INTEGER NOT NULL
    REFERENCES public_job_catalog_versions(ordinal) ON DELETE RESTRICT,
  valid_to_ordinal INTEGER
    REFERENCES public_job_catalog_versions(ordinal) ON DELETE RESTRICT,
  public_job_version INTEGER NOT NULL CHECK (public_job_version > 0),
  eligibility_decision_version INTEGER NOT NULL CHECK (
    eligibility_decision_version > 0
  ),
  item_json TEXT NOT NULL CHECK (
    json_valid(item_json) AND json_type(item_json)='object'
  ),
  detail_json TEXT NOT NULL CHECK (
    json_valid(detail_json) AND json_type(detail_json)='object'
  ),
  public_content_hash TEXT NOT NULL CHECK (length(public_content_hash)=64),
  eligibility_decision_hash TEXT NOT NULL CHECK (
    length(eligibility_decision_hash)=64
  ),
  location_facets_json TEXT NOT NULL CHECK (
    json_valid(location_facets_json) AND json_type(location_facets_json)='array'
  ),
  representation_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (public_job_id,valid_from_ordinal),
  CHECK (valid_to_ordinal IS NULL OR valid_to_ordinal>valid_from_ordinal),
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,eligibility_decision_version)
    REFERENCES public_job_eligibility_decisions(public_job_id,decision_version)
    ON DELETE RESTRICT
);
CREATE TABLE public_job_search_index (
  public_job_id TEXT NOT NULL,
  valid_from_ordinal INTEGER NOT NULL,
  public_job_version INTEGER NOT NULL CHECK (public_job_version > 0),
  search_document TEXT NOT NULL CHECK (trim(search_document)<>''),
  search_terms_json TEXT NOT NULL CHECK (
    json_valid(search_terms_json) AND json_type(search_terms_json)='array'
    AND json_array_length(search_terms_json)>0
  ),
  title_sort_key TEXT NOT NULL CHECK (trim(title_sort_key)<>''),
  effective_recency TEXT NOT NULL CHECK (trim(effective_recency)<>''),
  conservative_hourly_usd REAL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (public_job_id,valid_from_ordinal),
  FOREIGN KEY (public_job_id,valid_from_ordinal)
    REFERENCES public_job_catalog_members(public_job_id,valid_from_ordinal)
    ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT
);
CREATE TABLE public_job_search_terms (
  public_job_id TEXT NOT NULL,
  valid_from_ordinal INTEGER NOT NULL,
  public_job_version INTEGER NOT NULL CHECK (public_job_version > 0),
  term TEXT NOT NULL CHECK (trim(term)<>''),
  score INTEGER NOT NULL CHECK (score > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (public_job_id,valid_from_ordinal,term),
  FOREIGN KEY (public_job_id,valid_from_ordinal)
    REFERENCES public_job_search_index(public_job_id,valid_from_ordinal)
    ON DELETE RESTRICT
);
CREATE TABLE public_browse_job_locations (
  public_job_id TEXT NOT NULL,
  valid_from_ordinal INTEGER NOT NULL,
  public_job_version INTEGER NOT NULL CHECK (public_job_version > 0),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  location_role TEXT NOT NULL CHECK (
    location_role IN ('worksite','applicant_area')
  ),
  country_code TEXT NOT NULL CHECK (
    length(country_code)=2 AND country_code=upper(country_code)
  ),
  country_slug TEXT NOT NULL CHECK (trim(country_slug)<>''),
  city_slug TEXT,
  display_name TEXT NOT NULL CHECK (trim(display_name)<>''),
  created_at TEXT NOT NULL,
  PRIMARY KEY (public_job_id,valid_from_ordinal,ordinal),
  FOREIGN KEY (public_job_id,valid_from_ordinal)
    REFERENCES public_job_catalog_members(public_job_id,valid_from_ordinal)
    ON DELETE RESTRICT,
  CHECK (city_slug IS NULL OR trim(city_slug)<>'')
);
CREATE INDEX user_sessions_user_id_idx ON user_sessions(user_id);
CREATE INDEX user_accounts_user_id_idx ON user_accounts(user_id);
CREATE INDEX auth_verifications_identifier_idx ON auth_verifications(identifier);
CREATE INDEX idx_drafts_user_job_version
  ON application_drafts(user_job_id,version DESC);
CREATE INDEX idx_events_user_job_created
  ON job_events(user_job_id,created_at DESC);
CREATE INDEX idx_user_documents_user
  ON user_documents(user_id,category,created_at DESC);
CREATE INDEX idx_profile_imports_user_created
  ON profile_imports(user_id,created_at DESC);
CREATE INDEX idx_job_feedback_user_created
  ON job_feedback(user_id,created_at DESC);
CREATE INDEX idx_job_feedback_user_job
  ON job_feedback(user_id,job_id,created_at DESC);
CREATE UNIQUE INDEX idx_user_document_packets_one_default
  ON user_document_packets(user_id) WHERE is_default=1;
CREATE INDEX idx_user_document_packet_items_document
  ON user_document_packet_items(document_id);
CREATE INDEX idx_application_draft_attachments_document
  ON application_draft_attachments(source_document_id);
CREATE INDEX idx_application_routes_job_status
  ON application_routes(job_id,status,kind);
CREATE INDEX idx_application_attempts_user_job_status
  ON application_attempts(user_job_id,status,updated_at DESC);
CREATE INDEX idx_application_attempts_route
  ON application_attempts(route_id,created_at DESC);
CREATE INDEX idx_application_attempts_send_requests
  ON application_attempts(status,send_requested_at,updated_at);
CREATE INDEX idx_organizations_country_status
  ON organizations(country_code,status,outreach_eligibility,name);
CREATE UNIQUE INDEX idx_organizations_country_identity
  ON organizations(country_code,identity_key);
CREATE UNIQUE INDEX idx_organizations_country_domain
  ON organizations(country_code,canonical_domain)
  WHERE canonical_domain<>'';
CREATE INDEX idx_organization_contacts_org_status
  ON organization_contact_points(organization_id,status,kind);
CREATE INDEX idx_thread_messages_user_thread
  ON application_thread_messages(user_id, gmail_thread_id, sent_at);
CREATE INDEX idx_message_exemplars_user_grade
  ON message_exemplars(user_id, outcome_grade DESC, sent_at DESC);
CREATE UNIQUE INDEX idx_message_foundations_active_user
  ON user_message_foundations(user_id)
  WHERE status='active';
CREATE INDEX idx_message_calibration_user_foundation
  ON user_message_calibration_decisions(user_id,foundation_id,decided_at);
CREATE INDEX idx_gmail_pubsub_events_processed
  ON gmail_pubsub_events(processed_at DESC);
CREATE INDEX idx_contact_channels_contact_status
  ON contact_channels(contact_id,status,kind);
CREATE INDEX idx_application_routes_contact_channel
  ON application_routes(contact_channel_id,status,updated_at DESC);
CREATE INDEX idx_job_position_analyses_version
  ON job_position_analyses(schema_version,updated_at DESC);
CREATE INDEX idx_job_position_variants_job_role
  ON job_position_variants(job_id,role_family,ordinal);
CREATE INDEX idx_application_bundles_user_status
  ON application_bundles(user_id,status,updated_at DESC);
CREATE INDEX idx_application_bundle_targets_user_job
  ON application_bundle_targets(user_job_id,bundle_id);
CREATE INDEX idx_application_drafts_bundle_version
  ON application_drafts(application_bundle_id,version DESC)
  WHERE application_bundle_id IS NOT NULL;
CREATE UNIQUE INDEX idx_application_attempts_bundle_draft
  ON application_attempts(application_bundle_id,draft_id)
  WHERE application_bundle_id IS NOT NULL;
CREATE INDEX idx_application_bundle_test_sends_bundle
  ON application_bundle_test_sends(bundle_id,updated_at DESC);
CREATE INDEX idx_agent_runner_pairings_user
  ON agent_runner_pairings(user_id,created_at DESC);
CREATE INDEX idx_agent_runners_user
  ON agent_runners(user_id,created_at DESC);
CREATE INDEX idx_agent_task_runs_user_status
  ON agent_task_runs(user_id,status,started_at DESC);
CREATE INDEX idx_agent_task_runs_source
  ON agent_task_runs(task_type,source_task_id,started_at DESC);
CREATE UNIQUE INDEX idx_agent_task_runs_active_source
  ON agent_task_runs(user_id,task_type,source_task_id)
  WHERE status='running';
CREATE UNIQUE INDEX idx_agent_task_requests_active_subject
  ON agent_task_requests(user_id,task_type,subject_type,subject_id)
  WHERE status IN ('queued','claimed');
CREATE INDEX idx_agent_task_requests_claim
  ON agent_task_requests(user_id,task_type,status,created_at);
CREATE INDEX idx_agent_task_requests_runner
  ON agent_task_requests(runner_id,status,lease_expires_at);
CREATE INDEX idx_test_lab_runs_user_created
  ON test_lab_runs(user_id,created_at DESC);
CREATE INDEX idx_test_lab_runs_case_variant
  ON test_lab_runs(user_id,case_id,variant,created_at DESC);
CREATE INDEX idx_test_lab_runs_status
  ON test_lab_runs(user_id,status,updated_at);
CREATE INDEX idx_agent_task_artifacts_run
  ON agent_task_artifacts(run_id,user_id);
CREATE INDEX idx_test_delivery_captures_user_created
  ON test_delivery_captures(user_id,created_at DESC);
CREATE INDEX idx_test_delivery_events_capture
  ON test_delivery_events(capture_id,created_at);
CREATE INDEX idx_campaigns_user_status
  ON campaigns(user_id,status,updated_at DESC);
CREATE INDEX idx_campaign_markets_country
  ON campaign_markets(country_code,campaign_id);
CREATE INDEX idx_campaign_targets_campaign_status
  ON campaign_targets(campaign_id,status,source_kind,admitted_at);
CREATE INDEX idx_campaign_targets_campaign_dedup
  ON campaign_targets(campaign_id,dedup_key,route_strategy);
CREATE INDEX idx_campaign_runs_campaign
  ON campaign_runs(campaign_id,scheduled_for DESC);
CREATE INDEX idx_campaign_dispatches_due
  ON campaign_dispatches(campaign_id,status,scheduled_for,created_at);
CREATE INDEX idx_campaign_messages_current
  ON campaign_messages(dispatch_id,status,version DESC);
CREATE INDEX idx_campaign_dispatch_attachments_document
  ON campaign_dispatch_attachments(source_document_id);
CREATE INDEX idx_campaign_guidance_campaign
  ON campaign_guidance(campaign_id,status,created_at);
CREATE INDEX idx_outbound_recipient_claims_source
  ON outbound_recipient_claims(source_kind,source_id,status);
CREATE INDEX idx_campaign_email_attempts_status
  ON campaign_email_attempts(status,updated_at);
CREATE INDEX idx_campaign_reply_events_campaign
  ON campaign_reply_events(campaign_id,received_at DESC);
CREATE INDEX idx_campaign_target_events_v2_target
  ON campaign_target_events(target_id,created_at DESC);
CREATE INDEX idx_campaign_target_events_v2_campaign
  ON campaign_target_events(campaign_id,created_at DESC);
CREATE INDEX idx_inventory_runs_source_status
  ON inventory_runs(source_id,status,started_at DESC);
CREATE INDEX idx_inventory_run_batches_run
  ON inventory_run_batches(run_id,ordinal);
CREATE INDEX idx_inventory_run_items_job
  ON inventory_run_items(job_id,processed_at DESC);
CREATE INDEX idx_inventory_run_items_batch
  ON inventory_run_items(batch_id,status,processed_at DESC);
CREATE INDEX idx_inventory_refresh_requests_claim
  ON inventory_refresh_requests(status,requested_at);
CREATE INDEX idx_inventory_refresh_requests_source
  ON inventory_refresh_requests(source_id,status,requested_at DESC);
CREATE UNIQUE INDEX idx_inventory_refresh_requests_active_key
  ON inventory_refresh_requests(request_key)
  WHERE status IN ('queued','claimed','crawling','publishing');
CREATE UNIQUE INDEX idx_inventory_runs_refresh_request
  ON inventory_runs(refresh_request_id)
  WHERE refresh_request_id IS NOT NULL;
CREATE INDEX idx_organization_evidence_org_observed
  ON organization_evidence(organization_id,observed_at DESC);
CREATE INDEX idx_organization_evidence_sweep
  ON organization_evidence(source_sweep_id,evidence_kind,evidence_status);
CREATE INDEX idx_outreach_followups_due
  ON outreach_followups(status,due_at,created_at);
CREATE INDEX idx_outreach_followups_thread
  ON outreach_followups(user_id,gmail_thread_id,ordinal);
CREATE INDEX idx_message_thread_outcomes_user
  ON message_thread_outcomes(user_id,outcome,updated_at DESC);
CREATE INDEX idx_test_lab_classification_adjudications_user_updated
  ON test_lab_classification_adjudications(user_id,updated_at DESC);
CREATE INDEX idx_user_listing_states_user_status_priority
  ON user_listing_states(user_id,status,priority DESC,updated_at DESC);
CREATE INDEX idx_user_listing_states_listing
  ON user_listing_states(job_id);
CREATE INDEX idx_job_listings_inventory_source_status
  ON job_listings(inventory_source_id,inventory_status,source_last_seen_at DESC);
CREATE INDEX idx_job_content_analyses_version
  ON job_content_analyses(schema_version,updated_at DESC);
CREATE UNIQUE INDEX idx_agent_task_runs_active_global_job_analysis
  ON agent_task_runs(task_type,source_task_id)
  WHERE status='running'
    AND task_type IN (
      'job.match_facts',
      'job.position_analysis',
      'job.content_analysis'
    );
CREATE INDEX idx_job_listing_versions_material_hash
  ON job_listing_versions(material_hash_version,material_hash);
CREATE INDEX idx_job_listings_source_posted_date
  ON job_listings(source_posted_date DESC);
CREATE UNIQUE INDEX idx_canonical_locations_provider_identity
  ON canonical_locations(provider,provider_place_id)
  WHERE provider<>'' AND provider_place_id<>'';
CREATE INDEX idx_public_job_versions_slug
  ON public_job_versions(canonical_slug);
CREATE INDEX idx_public_job_locations_resolved
  ON public_job_version_locations(
    public_job_id,public_job_version,location_role,resolution_state
  );
CREATE INDEX idx_source_position_mappings_public_job
  ON job_source_position_mapping_versions(public_job_id,mapping_state);
CREATE INDEX idx_public_decisions_state
  ON public_job_eligibility_decisions(publication_state,decided_at DESC);
CREATE INDEX idx_public_decision_sources_policy
  ON public_job_decision_sources(source_key,policy_version);
CREATE INDEX idx_public_projection_runs_status
  ON public_projection_runs(status,requested_at);
CREATE INDEX idx_public_projection_listing_claim
  ON public_projection_listing_items(status,stage,updated_at);
CREATE INDEX idx_public_projection_position_claim
  ON public_projection_position_items(status,stage,updated_at);
CREATE INDEX idx_public_projection_duplicates_review
  ON public_projection_duplicate_candidates(operator_decision,created_at);
CREATE INDEX idx_public_job_identity_signal_lookup
  ON public_job_identity_signals(signal_kind,signal_hash);
CREATE INDEX idx_projection_duplicate_member_listing
  ON public_projection_duplicate_batch_members(
    run_id,listing_id,position_item_id
  );
CREATE INDEX idx_projection_duplicate_member_source_reference
  ON public_projection_duplicate_batch_members(
    run_id,source_key,position_key,source_reference,position_item_id
  );
CREATE INDEX idx_projection_duplicate_member_material
  ON public_projection_duplicate_batch_members(
    run_id,material_signal_hash,position_key,position_item_id
  );
CREATE UNIQUE INDEX idx_projection_duplicate_same_run_target
  ON public_projection_duplicate_comparisons(
    run_id,owner_position_item_id,target_position_item_id
  )
  WHERE target_kind='same_run';
CREATE UNIQUE INDEX idx_projection_duplicate_public_target
  ON public_projection_duplicate_comparisons(
    run_id,owner_position_item_id,target_redirect_root_id,
    target_public_job_version
  )
  WHERE target_kind='existing_public';
CREATE INDEX idx_projection_duplicate_owner
  ON public_projection_duplicate_comparisons(
    run_id,owner_position_item_id,target_kind,id
  );
CREATE UNIQUE INDEX idx_agent_task_runs_source_attempt
  ON agent_task_runs(user_id,task_type,source_task_id,attempt_number);
CREATE INDEX idx_agent_task_requests_ready
  ON agent_task_requests(
    user_id,task_type,status,next_attempt_at,created_at
  );
CREATE INDEX idx_agent_task_requests_active_lease
  ON agent_task_requests(
    user_id,runner_id,status,lease_expires_at,lease_token
  );
CREATE INDEX idx_country_sweeps_country_status
  ON country_sweeps(country_code,status,requested_at DESC);
CREATE INDEX idx_country_sweeps_requester
  ON country_sweeps(requested_by_user_id,requested_at DESC);
CREATE INDEX idx_country_sweep_tasks_claim
  ON country_sweep_tasks(status,phase,created_at);
CREATE INDEX idx_country_sweep_tasks_active_lease
  ON country_sweep_tasks(sweep_id,worker_id,status,lease_expires_at,lease_token);
CREATE INDEX idx_org_source_employer_mapping_org
  ON organization_source_employer_mappings(organization_id,source_key);
CREATE INDEX idx_org_domain_mapping_lookup
  ON organization_domain_mappings(
    public_suffix_list_version,normalized_host,registrable_domain,mapping_kind
  );
CREATE INDEX idx_org_domain_mapping_org
  ON organization_domain_mappings(organization_id,mapping_kind);
CREATE INDEX idx_projection_org_resolution_run
  ON public_projection_organization_resolutions(run_id,position_item_id);
CREATE INDEX idx_projection_org_candidate_identity
  ON public_projection_organization_candidates(
    run_id,organization_id,evidence_tier,resolution_id
  );
CREATE INDEX idx_projection_location_resolution_run
  ON public_projection_location_resolutions(
    run_id,position_item_id,ordinal
  );
CREATE INDEX idx_projection_location_candidate_identity
  ON public_projection_location_candidates(
    provider_place_id,resolution_id
  );
CREATE INDEX idx_country_sweep_outputs_materialization
  ON country_sweep_outputs(status,accepted_at,id);
CREATE INDEX idx_country_sweep_output_chunks_output
  ON country_sweep_output_chunks(output_id,ordinal);
CREATE INDEX idx_country_materialization_claim
  ON country_sweep_materialization_items(output_id,status,sequence,id);
CREATE INDEX idx_country_materialization_lease
  ON country_sweep_materialization_items(status,lease_expires_at,id);
CREATE INDEX idx_country_sweep_output_cleanup_pending
  ON country_sweep_output_cleanup(status,updated_at,output_id);
CREATE INDEX idx_country_output_organizations_organization
  ON country_sweep_output_organizations(organization_id,output_id);
CREATE INDEX idx_country_output_contacts_organization
  ON country_sweep_output_contacts(organization_id,output_id);
CREATE INDEX idx_country_output_scopes_task
  ON country_sweep_output_scopes(task_id,output_id);
CREATE UNIQUE INDEX idx_projection_operator_decision_first
  ON public_projection_duplicate_operator_decisions(
    left_member_key,right_member_key
  ) WHERE supersedes_decision_id IS NULL;
CREATE UNIQUE INDEX idx_projection_operator_decision_successor
  ON public_projection_duplicate_operator_decisions(supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;
CREATE INDEX idx_projection_final_relation_left
  ON public_projection_final_duplicate_relations(run_id,left_member_key,id);
CREATE INDEX idx_projection_final_relation_right
  ON public_projection_final_duplicate_relations(run_id,right_member_key,id);
CREATE UNIQUE INDEX idx_projection_allocation_member_key
  ON public_projection_allocation_members(run_id,member_key);
CREATE INDEX idx_projection_final_resolution_relation_lookup
  ON public_projection_final_work_resolution_inputs(
    run_id,resolution_state,canonical_signal_hash,member_key,position_item_id
  );
CREATE INDEX idx_projection_final_resolution_source_page
  ON public_projection_final_work_resolution_inputs(
    run_id,source_position_id
  ) WHERE resolution_state='resolved';
CREATE INDEX idx_projection_final_member_snapshot_page
  ON public_projection_duplicate_batch_members(
    run_id,source_position_id,input_hash,position_item_id
  );
CREATE INDEX idx_projection_final_canonical_match_member_page
  ON public_projection_final_work_canonical_matches(
    run_id,public_member_key,signal_hash,public_job_id,public_job_version
  );
CREATE INDEX idx_projection_final_canonical_match_public_page
  ON public_projection_final_work_canonical_matches(
    run_id,public_job_id,public_job_version,signal_hash
  );
CREATE INDEX idx_projection_final_canonical_member_page
  ON public_projection_final_work_canonical_members(
    run_id,public_member_key,signal_hash
  );
CREATE INDEX idx_projection_final_public_root_member_page
  ON public_projection_final_work_public_roots(
    run_id,public_member_key,originating_public_job_id
  );
CREATE INDEX idx_projection_final_mapping_public_page
  ON public_projection_final_work_mapping_inputs(
    run_id,mapping_state,public_job_id
  );
CREATE INDEX idx_public_job_canonical_signal_page
  ON public_job_identity_signals(
    signal_kind,signal_hash,public_job_id,public_job_version
  );
CREATE INDEX idx_projection_final_d2_public_page
  ON public_projection_duplicate_comparisons(
    run_id,target_kind,target_public_job_id
  ) WHERE target_kind='existing_public';
CREATE INDEX idx_projection_final_component_root_winner
  ON public_projection_final_component_root_candidates(
    run_id,seed_member_key,served_publicly DESC,published_missing_rank,
    first_published_sort,public_job_created_at,redirect_root_id,member_key
  );
CREATE INDEX idx_projection_final_relations_left_page
  ON public_projection_final_work_relations(
    run_id,relation,left_member_key,right_member_key,id
  );
CREATE INDEX idx_projection_final_relations_right_page
  ON public_projection_final_work_relations(
    run_id,relation,right_member_key,left_member_key,id
  );
CREATE INDEX idx_projection_final_relations_run_id_page
  ON public_projection_final_work_relations(run_id,id);
CREATE INDEX idx_projection_final_relations_left_component_page
  ON public_projection_final_work_relations(run_id,left_member_key,id);
CREATE INDEX idx_projection_final_relations_right_component_page
  ON public_projection_final_work_relations(run_id,right_member_key,id);
CREATE INDEX idx_projection_candidate_results_state
  ON public_projection_candidate_results(run_id,state,allocation_id);
CREATE INDEX idx_google_indexing_events_claim
  ON google_indexing_events(status,next_attempt_at,created_at,id);
CREATE INDEX idx_campaign_delivery_authorization_events_user
  ON campaign_delivery_authorization_events(user_id,created_at DESC);
CREATE INDEX idx_gmail_mailbox_watches_expiration
  ON gmail_mailbox_watches(status,expiration_at);
CREATE UNIQUE INDEX idx_public_job_catalog_versions_ordinal
  ON public_job_catalog_versions(ordinal);
CREATE INDEX idx_public_job_catalog_members_open
  ON public_job_catalog_members(public_job_id)
  WHERE valid_to_ordinal IS NULL;
CREATE INDEX idx_public_job_catalog_members_closed
  ON public_job_catalog_members(valid_to_ordinal)
  WHERE valid_to_ordinal IS NOT NULL;
CREATE INDEX idx_public_job_catalog_members_from
  ON public_job_catalog_members(valid_from_ordinal);
CREATE INDEX idx_public_job_search_recent
  ON public_job_search_index(effective_recency DESC,public_job_id);
CREATE INDEX idx_public_job_search_hourly
  ON public_job_search_index(
    conservative_hourly_usd DESC,effective_recency DESC,public_job_id
  );
CREATE INDEX idx_public_job_search_title
  ON public_job_search_index(title_sort_key,public_job_id);
CREATE INDEX idx_public_job_search_terms_lookup
  ON public_job_search_terms(term,public_job_id,valid_from_ordinal);
CREATE INDEX idx_public_browse_locations_country
  ON public_browse_job_locations(
    country_code,location_role,public_job_id,valid_from_ordinal
  );
CREATE INDEX idx_public_browse_locations_city
  ON public_browse_job_locations(
    country_code,city_slug,location_role,public_job_id,valid_from_ordinal
  ) WHERE city_slug IS NOT NULL;
CREATE INDEX idx_public_browse_locations_country_slug
  ON public_browse_job_locations(country_slug,public_job_id,valid_from_ordinal);
CREATE TRIGGER trg_policy_version_insert_successor
BEFORE INSERT ON source_publication_policy_versions
WHEN NEW.version>1 AND NOT EXISTS (
  SELECT 1
  FROM source_publication_policy_versions existing
  WHERE existing.source_key=NEW.source_key
    AND existing.idempotency_key=NEW.idempotency_key
    AND existing.policy_hash=NEW.policy_hash
)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM source_publication_policy_heads head
    WHERE head.source_key=NEW.source_key
      AND head.current_version=NEW.predecessor_version
  ) THEN RAISE(ABORT,'policy version must extend the current head') END;
END;
CREATE TRIGGER trg_policy_version_idempotency_conflict
BEFORE INSERT ON source_publication_policy_versions
WHEN EXISTS (
  SELECT 1
  FROM source_publication_policy_versions existing
  WHERE existing.source_key=NEW.source_key
    AND existing.idempotency_key=NEW.idempotency_key
    AND existing.policy_hash<>NEW.policy_hash
)
BEGIN
  SELECT RAISE(ABORT,'policy idempotency key conflicts with existing hash');
END;
CREATE TRIGGER trg_policy_version_validate_fields
BEFORE INSERT ON source_publication_policy_versions
WHEN EXISTS (
  SELECT 1
  FROM json_each(NEW.allowed_fields_json) field
  WHERE field.type<>'text'
    OR field.value NOT IN (
      'title','organization_name','locations','date_posted','valid_through',
      'employment_types','compensation','description','source_name','source_url'
    )
)
BEGIN
  SELECT RAISE(ABORT,'policy contains an unsupported public field');
END;
CREATE TRIGGER trg_policy_version_update_immutable
BEFORE UPDATE ON source_publication_policy_versions
BEGIN
  SELECT RAISE(ABORT,'policy versions are immutable');
END;
CREATE TRIGGER trg_policy_version_delete_immutable
BEFORE DELETE ON source_publication_policy_versions
BEGIN
  SELECT RAISE(ABORT,'policy versions are immutable');
END;
CREATE TRIGGER trg_policy_head_insert_v1
BEFORE INSERT ON source_publication_policy_heads
WHEN NEW.current_version<>1
BEGIN
  SELECT RAISE(ABORT,'policy heads begin at version 1');
END;
CREATE TRIGGER trg_policy_head_advance
BEFORE UPDATE ON source_publication_policy_heads
BEGIN
  SELECT CASE WHEN NEW.source_key<>OLD.source_key
    THEN RAISE(ABORT,'policy head identity is immutable') END;
  SELECT CASE WHEN NEW.current_version<>OLD.current_version+1
    THEN RAISE(ABORT,'policy head must advance one version') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM source_publication_policy_versions version
    WHERE version.source_key=OLD.source_key
      AND version.version=NEW.current_version
      AND version.predecessor_version=OLD.current_version
  ) THEN RAISE(ABORT,'policy head successor is invalid') END;
END;
CREATE TRIGGER trg_policy_head_delete_immutable
BEFORE DELETE ON source_publication_policy_heads
BEGIN
  SELECT RAISE(ABORT,'policy heads cannot be deleted');
END;
CREATE TRIGGER trg_public_jobs_update_immutable
BEFORE UPDATE ON public_jobs
BEGIN
  SELECT RAISE(ABORT,'public job identities are immutable');
END;
CREATE TRIGGER trg_public_jobs_delete_immutable
BEFORE DELETE ON public_jobs
BEGIN
  SELECT RAISE(ABORT,'public job identities are immutable');
END;
CREATE TRIGGER trg_public_aliases_update_immutable
BEFORE UPDATE ON public_job_aliases
BEGIN
  SELECT RAISE(ABORT,'public job aliases are immutable');
END;
CREATE TRIGGER trg_public_aliases_delete_immutable
BEFORE DELETE ON public_job_aliases
BEGIN
  SELECT RAISE(ABORT,'public job aliases are immutable');
END;
CREATE TRIGGER trg_public_job_version_insert_successor
BEFORE INSERT ON public_job_versions
WHEN NEW.version>1 AND NOT EXISTS (
  SELECT 1
  FROM public_job_versions existing
  WHERE existing.public_job_id=NEW.public_job_id
    AND existing.idempotency_key=NEW.idempotency_key
    AND existing.public_content_hash=NEW.public_content_hash
)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM public_job_heads head
    WHERE head.public_job_id=NEW.public_job_id
      AND head.current_version=NEW.predecessor_version
  ) THEN RAISE(ABORT,'public job version must extend the current head') END;
END;
CREATE TRIGGER trg_public_job_version_idempotency_conflict
BEFORE INSERT ON public_job_versions
WHEN EXISTS (
  SELECT 1
  FROM public_job_versions existing
  WHERE existing.public_job_id=NEW.public_job_id
    AND existing.idempotency_key=NEW.idempotency_key
    AND existing.public_content_hash<>NEW.public_content_hash
)
BEGIN
  SELECT RAISE(ABORT,'content idempotency key conflicts with existing hash');
END;
CREATE TRIGGER trg_public_job_version_update_immutable
BEFORE UPDATE ON public_job_versions
BEGIN
  SELECT RAISE(ABORT,'public job versions are immutable');
END;
CREATE TRIGGER trg_public_job_version_delete_immutable
BEFORE DELETE ON public_job_versions
BEGIN
  SELECT RAISE(ABORT,'public job versions are immutable');
END;
CREATE TRIGGER trg_public_job_head_insert_v1
BEFORE INSERT ON public_job_heads
WHEN NEW.current_version<>1
BEGIN
  SELECT RAISE(ABORT,'public job heads begin at version 1');
END;
CREATE TRIGGER trg_public_job_head_advance
BEFORE UPDATE ON public_job_heads
BEGIN
  SELECT CASE WHEN NEW.public_job_id<>OLD.public_job_id
    THEN RAISE(ABORT,'public job head identity is immutable') END;
  SELECT CASE WHEN NEW.current_version<>OLD.current_version+1
    THEN RAISE(ABORT,'public job head must advance one version') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM public_job_versions version
    WHERE version.public_job_id=OLD.public_job_id
      AND version.version=NEW.current_version
      AND version.predecessor_version=OLD.current_version
  ) THEN RAISE(ABORT,'public job head successor is invalid') END;
END;
CREATE TRIGGER trg_public_job_head_delete_immutable
BEFORE DELETE ON public_job_heads
BEGIN
  SELECT RAISE(ABORT,'public job heads cannot be deleted');
END;
CREATE TRIGGER trg_public_job_location_update_immutable
BEFORE UPDATE ON public_job_version_locations
BEGIN
  SELECT RAISE(ABORT,'public job location snapshots are immutable');
END;
CREATE TRIGGER trg_public_job_location_insert_before_head
BEFORE INSERT ON public_job_version_locations
WHEN EXISTS (
  SELECT 1
  FROM public_job_heads head
  WHERE head.public_job_id=NEW.public_job_id
    AND head.current_version>=NEW.public_job_version
)
AND NOT EXISTS (
  SELECT 1
  FROM public_job_version_locations existing
  WHERE existing.public_job_id=NEW.public_job_id
    AND existing.public_job_version=NEW.public_job_version
    AND existing.ordinal=NEW.ordinal
    AND existing.location_role=NEW.location_role
    AND existing.location_id IS NEW.location_id
    AND existing.resolution_state=NEW.resolution_state
    AND existing.display_name=NEW.display_name
    AND existing.country_code IS NEW.country_code
    AND existing.region=NEW.region
    AND existing.locality=NEW.locality
    AND existing.postal_code=NEW.postal_code
    AND existing.location_json=NEW.location_json
)
BEGIN
  SELECT RAISE(ABORT,'location snapshots must precede the content head');
END;
CREATE TRIGGER trg_public_job_location_delete_immutable
BEFORE DELETE ON public_job_version_locations
BEGIN
  SELECT RAISE(ABORT,'public job location snapshots are immutable');
END;
CREATE TRIGGER trg_source_position_validate_board
BEFORE INSERT ON job_source_positions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM job_listings listing
    WHERE listing.id=NEW.listing_id AND listing.board=NEW.source_key
  ) THEN RAISE(ABORT,'source position must use the listing board') END;
END;
CREATE TRIGGER trg_source_position_update_immutable
BEFORE UPDATE ON job_source_positions
BEGIN
  SELECT RAISE(ABORT,'source positions are immutable');
END;
CREATE TRIGGER trg_source_position_delete_immutable
BEFORE DELETE ON job_source_positions
BEGIN
  SELECT RAISE(ABORT,'source positions are immutable');
END;
CREATE TRIGGER trg_source_mapping_insert_successor
BEFORE INSERT ON job_source_position_mapping_versions
WHEN NEW.version>1 AND NOT EXISTS (
  SELECT 1
  FROM job_source_position_mapping_versions existing
  WHERE existing.source_position_id=NEW.source_position_id
    AND existing.idempotency_key=NEW.idempotency_key
    AND existing.mapping_hash=NEW.mapping_hash
)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM job_source_position_mapping_heads head
    WHERE head.source_position_id=NEW.source_position_id
      AND head.current_version=NEW.predecessor_version
  ) THEN RAISE(ABORT,'source mapping must extend the current head') END;
END;
CREATE TRIGGER trg_source_mapping_idempotency_conflict
BEFORE INSERT ON job_source_position_mapping_versions
WHEN EXISTS (
  SELECT 1
  FROM job_source_position_mapping_versions existing
  WHERE existing.source_position_id=NEW.source_position_id
    AND existing.idempotency_key=NEW.idempotency_key
    AND existing.mapping_hash<>NEW.mapping_hash
)
BEGIN
  SELECT RAISE(ABORT,'mapping idempotency key conflicts with existing hash');
END;
CREATE TRIGGER trg_source_mapping_update_immutable
BEFORE UPDATE ON job_source_position_mapping_versions
BEGIN
  SELECT RAISE(ABORT,'source mapping versions are immutable');
END;
CREATE TRIGGER trg_source_mapping_delete_immutable
BEFORE DELETE ON job_source_position_mapping_versions
BEGIN
  SELECT RAISE(ABORT,'source mapping versions are immutable');
END;
CREATE TRIGGER trg_source_mapping_head_insert_v1
BEFORE INSERT ON job_source_position_mapping_heads
WHEN NEW.current_version<>1
BEGIN
  SELECT RAISE(ABORT,'source mapping heads begin at version 1');
END;
CREATE TRIGGER trg_source_mapping_head_advance
BEFORE UPDATE ON job_source_position_mapping_heads
BEGIN
  SELECT CASE WHEN NEW.source_position_id<>OLD.source_position_id
    THEN RAISE(ABORT,'source mapping head identity is immutable') END;
  SELECT CASE WHEN NEW.current_version<>OLD.current_version+1
    THEN RAISE(ABORT,'source mapping head must advance one version') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM job_source_position_mapping_versions version
    WHERE version.source_position_id=OLD.source_position_id
      AND version.version=NEW.current_version
      AND version.predecessor_version=OLD.current_version
  ) THEN RAISE(ABORT,'source mapping head successor is invalid') END;
END;
CREATE TRIGGER trg_source_mapping_head_delete_immutable
BEFORE DELETE ON job_source_position_mapping_heads
BEGIN
  SELECT RAISE(ABORT,'source mapping heads cannot be deleted');
END;
CREATE TRIGGER trg_public_decision_insert_successor
BEFORE INSERT ON public_job_eligibility_decisions
WHEN NEW.decision_version>1 AND NOT EXISTS (
  SELECT 1
  FROM public_job_eligibility_decisions existing
  WHERE existing.public_job_id=NEW.public_job_id
    AND existing.idempotency_key=NEW.idempotency_key
    AND existing.decision_hash=NEW.decision_hash
)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM public_job_eligibility_heads head
    WHERE head.public_job_id=NEW.public_job_id
      AND head.current_decision_version=NEW.predecessor_version
  ) THEN RAISE(ABORT,'eligibility decision must extend the current head') END;
END;
CREATE TRIGGER trg_public_decision_idempotency_conflict
BEFORE INSERT ON public_job_eligibility_decisions
WHEN EXISTS (
  SELECT 1
  FROM public_job_eligibility_decisions existing
  WHERE existing.public_job_id=NEW.public_job_id
    AND existing.idempotency_key=NEW.idempotency_key
    AND existing.decision_hash<>NEW.decision_hash
)
BEGIN
  SELECT RAISE(ABORT,'decision idempotency key conflicts with existing hash');
END;
CREATE TRIGGER trg_public_decision_prevent_merge_cycle
BEFORE INSERT ON public_job_eligibility_decisions
WHEN NEW.publication_state='merged'
BEGIN
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE redirects(public_job_id) AS (
      SELECT NEW.redirect_public_job_id
      UNION
      SELECT decision.redirect_public_job_id
      FROM redirects
      JOIN public_job_eligibility_heads head
        ON head.public_job_id=redirects.public_job_id
      JOIN public_job_eligibility_decisions decision
        ON decision.public_job_id=head.public_job_id
       AND decision.decision_version=head.current_decision_version
      WHERE decision.publication_state='merged'
        AND decision.redirect_public_job_id IS NOT NULL
    )
    SELECT 1 FROM redirects WHERE public_job_id=NEW.public_job_id
  ) THEN RAISE(ABORT,'public job merge cycle') END;
END;
CREATE TRIGGER trg_public_decision_update_immutable
BEFORE UPDATE ON public_job_eligibility_decisions
BEGIN
  SELECT RAISE(ABORT,'eligibility decisions are immutable');
END;
CREATE TRIGGER trg_public_decision_delete_immutable
BEFORE DELETE ON public_job_eligibility_decisions
BEGIN
  SELECT RAISE(ABORT,'eligibility decisions are immutable');
END;
CREATE TRIGGER trg_public_decision_head_insert_v1
BEFORE INSERT ON public_job_eligibility_heads
WHEN NEW.current_decision_version<>1
BEGIN
  SELECT RAISE(ABORT,'eligibility heads begin at version 1');
END;
CREATE TRIGGER trg_public_decision_head_advance
BEFORE UPDATE ON public_job_eligibility_heads
BEGIN
  SELECT CASE WHEN NEW.public_job_id<>OLD.public_job_id
    THEN RAISE(ABORT,'eligibility head identity is immutable') END;
  SELECT CASE WHEN
    NEW.current_decision_version<>OLD.current_decision_version+1
    THEN RAISE(ABORT,'eligibility head must advance one version') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM public_job_eligibility_decisions decision
    WHERE decision.public_job_id=OLD.public_job_id
      AND decision.decision_version=NEW.current_decision_version
      AND decision.predecessor_version=OLD.current_decision_version
  ) THEN RAISE(ABORT,'eligibility head successor is invalid') END;
  SELECT CASE WHEN EXISTS (
    WITH RECURSIVE redirects(public_job_id) AS (
      SELECT decision.redirect_public_job_id
      FROM public_job_eligibility_decisions decision
      WHERE decision.public_job_id=OLD.public_job_id
        AND decision.decision_version=NEW.current_decision_version
        AND decision.publication_state='merged'
      UNION
      SELECT target.redirect_public_job_id
      FROM redirects
      JOIN public_job_eligibility_heads target_head
        ON target_head.public_job_id=redirects.public_job_id
      JOIN public_job_eligibility_decisions target
        ON target.public_job_id=target_head.public_job_id
       AND target.decision_version=target_head.current_decision_version
      WHERE target.publication_state='merged'
        AND target.redirect_public_job_id IS NOT NULL
    )
    SELECT 1 FROM redirects WHERE public_job_id=OLD.public_job_id
  ) THEN RAISE(ABORT,'public job merge cycle') END;
END;
CREATE TRIGGER trg_public_decision_head_delete_immutable
BEFORE DELETE ON public_job_eligibility_heads
BEGIN
  SELECT RAISE(ABORT,'eligibility heads cannot be deleted');
END;
CREATE TRIGGER trg_public_decision_source_validate_mapping
BEFORE INSERT ON public_job_decision_sources
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM job_source_position_mapping_versions mapping
    WHERE mapping.source_position_id=NEW.source_position_id
      AND mapping.version=NEW.source_mapping_version
      AND mapping.mapping_state='mapped'
      AND mapping.public_job_id=NEW.public_job_id
  ) THEN RAISE(ABORT,'decision source mapping targets another public job') END;
END;
CREATE TRIGGER trg_public_decision_source_validate_fields
BEFORE INSERT ON public_job_decision_sources
WHEN EXISTS (
  SELECT 1
  FROM json_each(NEW.fields_used_json) field
  WHERE field.type<>'text'
    OR field.value NOT IN (
      'title','organization_name','locations','date_posted','valid_through',
      'employment_types','compensation','description','source_name','source_url'
    )
)
BEGIN
  SELECT RAISE(ABORT,'decision source contains an unsupported public field');
END;
CREATE TRIGGER trg_public_decision_source_insert_before_head
BEFORE INSERT ON public_job_decision_sources
WHEN EXISTS (
  SELECT 1
  FROM public_job_eligibility_heads head
  WHERE head.public_job_id=NEW.public_job_id
    AND head.current_decision_version>=NEW.decision_version
)
AND NOT EXISTS (
  SELECT 1
  FROM public_job_decision_sources existing
  WHERE existing.public_job_id=NEW.public_job_id
    AND existing.decision_version=NEW.decision_version
    AND existing.source_position_id=NEW.source_position_id
    AND existing.source_mapping_version=NEW.source_mapping_version
    AND existing.source_key=NEW.source_key
    AND existing.policy_version=NEW.policy_version
    AND existing.contribution_kind=NEW.contribution_kind
    AND existing.fields_used_json=NEW.fields_used_json
)
BEGIN
  SELECT RAISE(ABORT,'decision sources must precede the eligibility head');
END;
CREATE TRIGGER trg_public_decision_source_update_immutable
BEFORE UPDATE ON public_job_decision_sources
BEGIN
  SELECT RAISE(ABORT,'decision source snapshots are immutable');
END;
CREATE TRIGGER trg_public_decision_source_delete_immutable
BEFORE DELETE ON public_job_decision_sources
BEGIN
  SELECT RAISE(ABORT,'decision source snapshots are immutable');
END;
CREATE TRIGGER trg_public_projection_run_update_guard
BEFORE UPDATE ON public_projection_runs
BEGIN
  SELECT CASE WHEN
    OLD.status IN ('completed','completed_with_blocks','failed','canceled')
    AND (
      NEW.status IS NOT OLD.status
      OR NEW.listing_total IS NOT OLD.listing_total
      OR NEW.listing_completed IS NOT OLD.listing_completed
      OR NEW.listing_blocked IS NOT OLD.listing_blocked
      OR NEW.listing_failed IS NOT OLD.listing_failed
      OR NEW.listing_superseded IS NOT OLD.listing_superseded
      OR NEW.position_total IS NOT OLD.position_total
      OR NEW.position_completed IS NOT OLD.position_completed
      OR NEW.position_blocked IS NOT OLD.position_blocked
      OR NEW.position_failed IS NOT OLD.position_failed
      OR NEW.position_superseded IS NOT OLD.position_superseded
      OR NEW.selection_cursor IS NOT OLD.selection_cursor
      OR NEW.selection_complete IS NOT OLD.selection_complete
      OR NEW.error_code IS NOT OLD.error_code
      OR NEW.error_detail IS NOT OLD.error_detail
      OR NEW.started_at IS NOT OLD.started_at
      OR NEW.completed_at IS NOT OLD.completed_at
      OR NEW.updated_at IS NOT OLD.updated_at
    )
  THEN RAISE(ABORT,'terminal projection run is immutable') END;

  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.requested_by_user_id IS NOT OLD.requested_by_user_id
    OR NEW.mode IS NOT OLD.mode
    OR NEW.request_key IS NOT OLD.request_key
    OR NEW.scope_json IS NOT OLD.scope_json
    OR NEW.contract_version IS NOT OLD.contract_version
    OR NEW.projector_version IS NOT OLD.projector_version
    OR NEW.policy_heads_hash IS NOT OLD.policy_heads_hash
    OR NEW.source_watermark_json IS NOT OLD.source_watermark_json
    OR NEW.requested_at IS NOT OLD.requested_at
  THEN RAISE(ABORT,'projection run request snapshot is immutable') END;

  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('running','failed','canceled'))
    OR (OLD.status='running' AND NEW.status IN (
      'completed','completed_with_blocks','failed','canceled'
    ))
  ) THEN RAISE(ABORT,'invalid projection run status transition') END;

  SELECT CASE WHEN
    NEW.listing_total<OLD.listing_total
    OR NEW.listing_completed<OLD.listing_completed
    OR NEW.listing_blocked<OLD.listing_blocked
    OR NEW.listing_failed<OLD.listing_failed
    OR NEW.listing_superseded<OLD.listing_superseded
    OR NEW.position_total<OLD.position_total
    OR NEW.position_completed<OLD.position_completed
    OR NEW.position_blocked<OLD.position_blocked
    OR NEW.position_failed<OLD.position_failed
    OR NEW.position_superseded<OLD.position_superseded
    OR NEW.selection_complete<OLD.selection_complete
  THEN RAISE(ABORT,'projection run progress cannot move backward') END;
END;
CREATE TRIGGER trg_public_projection_position_validate_listing
BEFORE INSERT ON public_projection_position_items
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM public_projection_listing_items listing_item
    JOIN job_source_positions source_position
      ON source_position.id=NEW.source_position_id
     AND source_position.listing_id=listing_item.listing_id
    WHERE listing_item.id=NEW.listing_item_id
      AND listing_item.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'projection position must belong to listing item') END;
END;
CREATE TRIGGER trg_public_projection_position_update_guard
BEFORE UPDATE ON public_projection_position_items
BEGIN
  SELECT CASE WHEN
    OLD.status IN ('completed','superseded')
    AND (
      NEW.stage IS NOT OLD.stage
      OR NEW.status IS NOT OLD.status
      OR NEW.attempt_count IS NOT OLD.attempt_count
      OR NEW.lease_owner IS NOT OLD.lease_owner
      OR NEW.lease_token IS NOT OLD.lease_token
      OR NEW.lease_expires_at IS NOT OLD.lease_expires_at
      OR NEW.public_job_id IS NOT OLD.public_job_id
      OR NEW.simulated_browse_eligible IS NOT OLD.simulated_browse_eligible
      OR NEW.simulated_organic_eligible IS NOT OLD.simulated_organic_eligible
      OR NEW.simulated_job_posting_eligible
        IS NOT OLD.simulated_job_posting_eligible
      OR NEW.readiness_json IS NOT OLD.readiness_json
      OR NEW.reason_codes_json IS NOT OLD.reason_codes_json
      OR NEW.checkpoint_json IS NOT OLD.checkpoint_json
      OR NEW.error_code IS NOT OLD.error_code
      OR NEW.error_detail IS NOT OLD.error_detail
      OR NEW.started_at IS NOT OLD.started_at
      OR NEW.completed_at IS NOT OLD.completed_at
      OR NEW.updated_at IS NOT OLD.updated_at
    )
  THEN RAISE(ABORT,'terminal projection position is immutable') END;

  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.run_id IS NOT OLD.run_id
    OR NEW.listing_item_id IS NOT OLD.listing_item_id
    OR NEW.source_position_id IS NOT OLD.source_position_id
    OR NEW.input_hash IS NOT OLD.input_hash
    OR NEW.max_attempts IS NOT OLD.max_attempts
    OR NEW.created_at IS NOT OLD.created_at
    OR (OLD.public_job_id IS NOT NULL
      AND NEW.public_job_id IS NOT OLD.public_job_id)
  THEN RAISE(ABORT,'projection position input snapshot is immutable') END;

  SELECT CASE WHEN NEW.stage<>OLD.stage AND NOT (
    (OLD.stage='identity' AND NEW.stage='canonical_resolution')
    OR (OLD.stage='canonical_resolution' AND NEW.stage='content')
    OR (OLD.stage='content' AND NEW.stage='eligibility')
    OR (OLD.stage='eligibility' AND NEW.stage='completed')
  ) THEN RAISE(ABORT,'invalid projection position stage transition') END;

  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('processing','superseded'))
    OR (OLD.status='processing' AND NEW.status IN (
      'queued','waiting_analysis','blocked','completed','failed','superseded'
    ))
    OR (OLD.status='waiting_analysis' AND NEW.status IN (
      'queued','processing','blocked','failed','superseded'
    ))
    OR (OLD.status IN ('blocked','failed') AND NEW.status IN (
      'queued','superseded'
    ))
  ) THEN RAISE(ABORT,'invalid projection position status transition') END;

  SELECT CASE WHEN
    OLD.status<>'processing'
    AND NEW.status='processing'
    AND NEW.attempt_count<>OLD.attempt_count+1
  THEN RAISE(ABORT,'projection position claim must advance attempt') END;

  SELECT CASE WHEN NOT (
    OLD.status<>'processing' AND NEW.status='processing'
  ) AND NEW.attempt_count<>OLD.attempt_count
  THEN RAISE(ABORT,'projection position attempt changes require a claim') END;

  SELECT CASE WHEN
    OLD.status='processing'
    AND NEW.status='processing'
    AND (
      NEW.lease_owner IS NOT OLD.lease_owner
      OR NEW.lease_token IS NOT OLD.lease_token
    )
  THEN RAISE(ABORT,'projection position lease ownership is immutable') END;
END;
CREATE TRIGGER trg_public_projection_duplicate_update_guard
BEFORE UPDATE ON public_projection_duplicate_candidates
BEGIN
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.run_id IS NOT OLD.run_id
    OR NEW.position_item_id IS NOT OLD.position_item_id
    OR NEW.candidate_public_job_id IS NOT OLD.candidate_public_job_id
    OR NEW.candidate_public_job_version IS NOT OLD.candidate_public_job_version
    OR NEW.retrieval_algorithm_version IS NOT OLD.retrieval_algorithm_version
    OR NEW.signals_json IS NOT OLD.signals_json
    OR NEW.created_at IS NOT OLD.created_at
  THEN RAISE(ABORT,'duplicate candidate evidence is immutable') END;

  SELECT CASE WHEN
    OLD.agent_task_run_id IS NOT NULL
    AND NEW.agent_task_run_id IS NOT OLD.agent_task_run_id
  THEN RAISE(ABORT,'duplicate advice task is immutable') END;

  SELECT CASE WHEN
    OLD.codex_recommendation IS NOT NULL
    AND NEW.codex_recommendation IS NOT OLD.codex_recommendation
  THEN RAISE(ABORT,'duplicate advice is immutable') END;

  SELECT CASE WHEN
    OLD.operator_decision<>'pending'
    AND (
      NEW.operator_decision IS NOT OLD.operator_decision
      OR NEW.operator_user_id IS NOT OLD.operator_user_id
      OR NEW.operator_decided_at IS NOT OLD.operator_decided_at
    )
  THEN RAISE(ABORT,'duplicate operator decision is immutable') END;
END;
CREATE TRIGGER trg_public_projection_duplicate_delete_immutable
BEFORE DELETE ON public_projection_duplicate_candidates
BEGIN
  SELECT RAISE(ABORT,'duplicate candidate evidence is append-only');
END;
CREATE TRIGGER trg_public_job_identity_signal_update_immutable
BEFORE UPDATE ON public_job_identity_signals
BEGIN
  SELECT RAISE(ABORT,'public job identity signals are append-only');
END;
CREATE TRIGGER trg_public_job_identity_signal_delete_immutable
BEFORE DELETE ON public_job_identity_signals
BEGIN
  SELECT RAISE(ABORT,'public job identity signals are append-only');
END;
CREATE TRIGGER trg_job_listing_version_update_immutable
BEFORE UPDATE ON job_listing_versions
BEGIN
  SELECT RAISE(ABORT,'job listing versions are immutable');
END;
CREATE TRIGGER trg_job_listing_version_delete_immutable
BEFORE DELETE ON job_listing_versions
BEGIN
  SELECT RAISE(ABORT,'job listing versions are append-only');
END;
CREATE TRIGGER trg_projection_duplicate_assertion_consume
AFTER INSERT ON public_projection_duplicate_assertions
BEGIN
  DELETE FROM public_projection_duplicate_assertions
   WHERE rowid=NEW.rowid;
END;
CREATE TRIGGER trg_projection_duplicate_work_insert_validate
BEFORE INSERT ON public_projection_duplicate_work
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
     WHERE run.id=NEW.run_id AND run.mode='shadow'
       AND run.status='running' AND run.selection_complete=1
  ) THEN RAISE(ABORT,'duplicate work run is not stable') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_listing_items item
     WHERE item.run_id=NEW.run_id
       AND item.status IN ('queued','processing','waiting_analysis')
  ) OR EXISTS (
    SELECT 1 FROM public_projection_position_items item
     WHERE item.run_id=NEW.run_id AND item.stage='identity'
       AND item.status IN ('queued','processing','waiting_analysis')
  ) THEN RAISE(ABORT,'duplicate work identity boundary is active') END;

  SELECT CASE WHEN NEW.expected_member_count<>(
    SELECT COUNT(*) FROM public_projection_position_items item
     WHERE item.run_id=NEW.run_id
       AND item.stage='canonical_resolution' AND item.status='queued'
  ) THEN RAISE(ABORT,'duplicate work member count changed') END;
END;
CREATE TRIGGER trg_projection_duplicate_work_update_guard
BEFORE UPDATE ON public_projection_duplicate_work
BEGIN
  SELECT CASE WHEN
    NEW.run_id IS NOT OLD.run_id
    OR NEW.retrieval_algorithm_version IS NOT OLD.retrieval_algorithm_version
    OR NEW.expected_member_count IS NOT OLD.expected_member_count
    OR NEW.created_at IS NOT OLD.created_at
  THEN RAISE(ABORT,'duplicate work snapshot is immutable') END;

  SELECT CASE WHEN NEW.member_count<OLD.member_count
    OR NEW.comparison_count<OLD.comparison_count
  THEN RAISE(ABORT,'duplicate work progress cannot move backward') END;

  SELECT CASE WHEN OLD.phase='sealed' AND (
    NEW.phase IS NOT OLD.phase OR NEW.status IS NOT OLD.status
    OR NEW.member_count IS NOT OLD.member_count
    OR NEW.comparison_count IS NOT OLD.comparison_count
    OR NEW.member_cursor IS NOT OLD.member_cursor
    OR NEW.existing_public_cursor IS NOT OLD.existing_public_cursor
    OR NEW.same_run_owner_cursor IS NOT OLD.same_run_owner_cursor
    OR NEW.same_run_target_cursor IS NOT OLD.same_run_target_cursor
    OR NEW.member_digest IS NOT OLD.member_digest
    OR NEW.comparison_digest IS NOT OLD.comparison_digest
    OR NEW.lease_token IS NOT OLD.lease_token
    OR NEW.lease_expires_at IS NOT OLD.lease_expires_at
    OR NEW.updated_at IS NOT OLD.updated_at
  ) THEN RAISE(ABORT,'sealed duplicate work is immutable') END;
END;
CREATE TRIGGER trg_projection_duplicate_work_delete_guard
BEFORE DELETE ON public_projection_duplicate_work
WHEN EXISTS (
  SELECT 1 FROM public_projection_duplicate_batches batch
   WHERE batch.run_id=OLD.run_id
)
BEGIN
  SELECT RAISE(ABORT,'sealed duplicate work is append-only');
END;
CREATE TRIGGER trg_projection_duplicate_member_validate
BEFORE INSERT ON public_projection_duplicate_batch_members
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_duplicate_batches batch
     WHERE batch.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'duplicate batch members are sealed') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_work work
     WHERE work.run_id=NEW.run_id AND work.phase='members'
       AND work.status='processing'
  ) THEN RAISE(ABORT,'duplicate member work lease is unavailable') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM public_projection_position_items item
      JOIN public_projection_listing_items listing_item
        ON listing_item.id=item.listing_item_id
       AND listing_item.run_id=item.run_id
      JOIN job_source_positions source_position
        ON source_position.id=item.source_position_id
      JOIN job_listing_versions version
        ON version.listing_id=listing_item.listing_id
       AND version.material_version=listing_item.material_version
      JOIN job_listings listing ON listing.id=listing_item.listing_id
     WHERE item.id=NEW.position_item_id AND item.run_id=NEW.run_id
       AND item.source_position_id=NEW.source_position_id
       AND item.input_hash=NEW.input_hash
       AND item.stage='canonical_resolution' AND item.status='queued'
       AND item.public_job_id IS NULL
       AND json_extract(item.checkpoint_json,'$.identity.state')='derived'
       AND listing_item.stage='completed' AND listing_item.status='completed'
       AND listing_item.listing_id=NEW.listing_id
       AND listing_item.input_hash=version.material_hash
       AND listing.material_version=listing_item.material_version
       AND listing.material_hash=version.material_hash
       AND source_position.source_key=NEW.source_key
       AND source_position.position_key=NEW.position_key
  ) THEN RAISE(ABORT,'duplicate member snapshot changed') END;
END;
CREATE TRIGGER trg_projection_duplicate_member_update_immutable
BEFORE UPDATE ON public_projection_duplicate_batch_members
BEGIN
  SELECT RAISE(ABORT,'duplicate batch members are immutable');
END;
CREATE TRIGGER trg_projection_duplicate_member_delete_immutable
BEFORE DELETE ON public_projection_duplicate_batch_members
BEGIN
  SELECT RAISE(ABORT,'duplicate batch members are append-only');
END;
CREATE TRIGGER trg_projection_duplicate_owner_validate
BEFORE INSERT ON public_projection_duplicate_comparisons
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_duplicate_batches batch
     WHERE batch.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'duplicate comparisons are sealed') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_work work
     WHERE work.run_id=NEW.run_id AND work.status='processing'
       AND (
         (work.phase='existing_public' AND NEW.target_kind='existing_public')
         OR (work.phase='same_run' AND NEW.target_kind='same_run')
       )
  ) THEN RAISE(ABORT,'duplicate comparison work lease is unavailable') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_batch_members member
     JOIN public_projection_position_items item
       ON item.id=member.position_item_id AND item.run_id=member.run_id
     WHERE member.position_item_id=NEW.owner_position_item_id
       AND member.run_id=NEW.run_id
       AND member.source_position_id=NEW.owner_source_position_id
       AND member.input_hash=NEW.owner_input_hash
       AND item.stage='canonical_resolution' AND item.status='queued'
       AND item.public_job_id IS NULL
  ) THEN RAISE(ABORT,'duplicate comparison owner snapshot changed') END;
END;
CREATE TRIGGER trg_projection_duplicate_shadow_target_validate
BEFORE INSERT ON public_projection_duplicate_comparisons
WHEN NEW.target_kind='same_run'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_batch_members member
     JOIN public_projection_position_items item
       ON item.id=member.position_item_id AND item.run_id=member.run_id
     WHERE member.position_item_id=NEW.target_position_item_id
       AND member.run_id=NEW.run_id
       AND member.source_position_id=NEW.target_source_position_id
       AND member.input_hash=NEW.target_input_hash
       AND item.stage='canonical_resolution' AND item.status='queued'
       AND item.public_job_id IS NULL
  ) THEN RAISE(ABORT,'duplicate comparison target snapshot changed') END;
END;
CREATE TRIGGER trg_projection_duplicate_public_target_validate
BEFORE INSERT ON public_projection_duplicate_comparisons
WHEN NEW.target_kind='existing_public'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_job_heads head
     WHERE head.public_job_id=NEW.target_public_job_id
       AND head.current_version=NEW.target_public_job_version
  ) THEN RAISE(ABORT,'duplicate comparison public target is not current') END;

  SELECT CASE WHEN NEW.target_redirect_root_id IS NOT (
    WITH RECURSIVE redirect_chain(public_job_id,depth) AS (
      SELECT NEW.target_public_job_id,0
      UNION ALL
      SELECT decision.redirect_public_job_id,redirect_chain.depth+1
        FROM redirect_chain
        JOIN public_job_eligibility_heads head
          ON head.public_job_id=redirect_chain.public_job_id
        JOIN public_job_eligibility_decisions decision
          ON decision.public_job_id=head.public_job_id
         AND decision.decision_version=head.current_decision_version
       WHERE decision.publication_state='merged'
         AND decision.redirect_public_job_id IS NOT NULL
         AND redirect_chain.depth<100
    )
    SELECT redirect_chain.public_job_id FROM redirect_chain
     WHERE NOT EXISTS (
       SELECT 1 FROM public_job_eligibility_heads head
       JOIN public_job_eligibility_decisions decision
         ON decision.public_job_id=head.public_job_id
        AND decision.decision_version=head.current_decision_version
       WHERE head.public_job_id=redirect_chain.public_job_id
         AND decision.publication_state='merged'
         AND decision.redirect_public_job_id IS NOT NULL
     )
     ORDER BY redirect_chain.depth DESC LIMIT 1
  ) THEN RAISE(ABORT,'duplicate comparison public root is not terminal') END;
END;
CREATE TRIGGER trg_projection_duplicate_comparison_update_immutable
BEFORE UPDATE ON public_projection_duplicate_comparisons
BEGIN
  SELECT RAISE(ABORT,'duplicate comparisons are immutable');
END;
CREATE TRIGGER trg_projection_duplicate_comparison_delete_immutable
BEFORE DELETE ON public_projection_duplicate_comparisons
BEGIN
  SELECT RAISE(ABORT,'duplicate comparisons are append-only');
END;
CREATE TRIGGER trg_projection_duplicate_batch_validate
BEFORE INSERT ON public_projection_duplicate_batches
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
     JOIN public_projection_duplicate_work work ON work.run_id=run.id
     WHERE run.id=NEW.run_id AND run.mode='shadow'
       AND run.status='running' AND run.selection_complete=1
       AND work.phase='ready' AND work.status='processing'
       AND work.expected_member_count=NEW.position_member_count
       AND work.member_count=NEW.position_member_count
       AND work.comparison_count=NEW.comparison_count
       AND work.member_digest=NEW.member_digest
       AND work.comparison_digest=NEW.comparison_digest
  ) THEN RAISE(ABORT,'duplicate batch work is not ready') END;

  SELECT CASE WHEN NEW.position_member_count<>(
    SELECT COUNT(*) FROM public_projection_duplicate_batch_members member
     WHERE member.run_id=NEW.run_id
  ) OR NEW.position_member_count<>(
    SELECT COUNT(*) FROM public_projection_position_items item
     WHERE item.run_id=NEW.run_id
       AND item.stage='canonical_resolution' AND item.status='queued'
  ) THEN RAISE(ABORT,'duplicate batch position set is incomplete') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_duplicate_batch_members member
     JOIN public_projection_position_items item
       ON item.id=member.position_item_id AND item.run_id=member.run_id
     JOIN public_projection_listing_items listing_item
       ON listing_item.id=item.listing_item_id
      AND listing_item.run_id=item.run_id
     JOIN job_listing_versions version
       ON version.listing_id=listing_item.listing_id
      AND version.material_version=listing_item.material_version
     JOIN job_listings listing ON listing.id=listing_item.listing_id
     WHERE member.run_id=NEW.run_id
       AND (item.source_position_id<>member.source_position_id
         OR item.input_hash<>member.input_hash
         OR item.stage<>'canonical_resolution' OR item.status<>'queued'
         OR item.public_job_id IS NOT NULL
         OR json_extract(item.checkpoint_json,'$.identity.state')<>'derived'
         OR listing_item.stage<>'completed'
         OR listing_item.status<>'completed'
         OR listing_item.listing_id<>member.listing_id
         OR listing_item.input_hash<>version.material_hash
         OR listing.material_version<>listing_item.material_version
         OR listing.material_hash<>version.material_hash)
  ) THEN RAISE(ABORT,'duplicate batch member snapshot changed') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_position_items item
     WHERE item.run_id=NEW.run_id
       AND item.stage='canonical_resolution' AND item.status='queued'
       AND NOT EXISTS (
         SELECT 1 FROM public_projection_duplicate_batch_members member
          WHERE member.run_id=NEW.run_id
            AND member.position_item_id=item.id
       )
  ) THEN RAISE(ABORT,'duplicate batch position set omits a member') END;

  SELECT CASE WHEN NEW.comparison_count<>(
    SELECT COUNT(*) FROM public_projection_duplicate_comparisons comparison
     WHERE comparison.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'duplicate batch comparison set is incomplete') END;
END;
CREATE TRIGGER trg_projection_duplicate_batch_update_immutable
BEFORE UPDATE ON public_projection_duplicate_batches
BEGIN
  SELECT RAISE(ABORT,'duplicate batches are immutable');
END;
CREATE TRIGGER trg_projection_duplicate_batch_delete_immutable
BEFORE DELETE ON public_projection_duplicate_batches
BEGIN
  SELECT RAISE(ABORT,'duplicate batches are append-only');
END;
CREATE TRIGGER trg_projection_position_insert_after_duplicate_seal
BEFORE INSERT ON public_projection_position_items
WHEN EXISTS (
  SELECT 1 FROM public_projection_duplicate_batches batch
   WHERE batch.run_id=NEW.run_id
)
BEGIN
  SELECT RAISE(ABORT,'projection duplicate position set is sealed');
END;
CREATE TRIGGER trg_agent_task_request_insert_lease_guard
BEFORE INSERT ON agent_task_requests
BEGIN
  SELECT CASE WHEN NEW.attempt_count>NEW.max_attempts
    THEN RAISE(ABORT,'agent task request attempt budget exceeded') END;
  SELECT CASE WHEN NOT (
    (
      NEW.status='claimed'
      AND NEW.runner_id IS NOT NULL
      AND trim(NEW.runner_id)<>''
      AND NEW.lease_token IS NOT NULL
      AND trim(NEW.lease_token)<>''
      AND NEW.lease_expires_at IS NOT NULL
      AND trim(NEW.lease_expires_at)<>''
      AND NEW.attempt_count>0
    )
    OR (
      NEW.status<>'claimed'
      AND NEW.runner_id IS NULL
      AND NEW.lease_token IS NULL
      AND NEW.lease_expires_at IS NULL
    )
  ) THEN RAISE(ABORT,'invalid agent task request lease state') END;
END;
CREATE TRIGGER trg_agent_task_request_update_guard
BEFORE UPDATE ON agent_task_requests
BEGIN
  SELECT CASE WHEN
    OLD.status IN ('completed','failed','cancelled')
    THEN RAISE(ABORT,'terminal agent task request is immutable') END;
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.user_id IS NOT OLD.user_id
    OR NEW.task_type IS NOT OLD.task_type
    OR NEW.subject_type IS NOT OLD.subject_type
    OR NEW.subject_id IS NOT OLD.subject_id
    OR NEW.input_json IS NOT OLD.input_json
    OR NEW.retry_of_request_id IS NOT OLD.retry_of_request_id
    OR NEW.created_at IS NOT OLD.created_at
    THEN RAISE(ABORT,'agent task request input is immutable') END;
  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('claimed','cancelled','failed'))
    OR (OLD.status='claimed' AND NEW.status IN ('queued','completed','failed'))
  ) THEN RAISE(ABORT,'invalid agent task request status transition') END;
  SELECT CASE WHEN
    OLD.status='queued' AND NEW.status='claimed'
    AND NEW.attempt_count<>OLD.attempt_count+1
    THEN RAISE(ABORT,'agent task claim must advance attempt') END;
  SELECT CASE WHEN NOT (
    OLD.status='queued' AND NEW.status='claimed'
  ) AND NEW.attempt_count<>OLD.attempt_count
    THEN RAISE(ABORT,'agent task attempts change only on claim') END;
  SELECT CASE WHEN NEW.attempt_count>NEW.max_attempts
    THEN RAISE(ABORT,'agent task request attempt budget exceeded') END;
  SELECT CASE WHEN
    OLD.status='claimed' AND NEW.status='claimed'
    AND (
      NEW.runner_id IS NOT OLD.runner_id
      OR NEW.lease_token IS NOT OLD.lease_token
    )
    THEN RAISE(ABORT,'agent task lease ownership is immutable') END;
  SELECT CASE WHEN NOT (
    (
      NEW.status='claimed'
      AND NEW.runner_id IS NOT NULL
      AND trim(NEW.runner_id)<>''
      AND NEW.lease_token IS NOT NULL
      AND trim(NEW.lease_token)<>''
      AND NEW.lease_expires_at IS NOT NULL
      AND trim(NEW.lease_expires_at)<>''
      AND NEW.attempt_count>0
    )
    OR (
      NEW.status<>'claimed'
      AND NEW.runner_id IS NULL
      AND NEW.lease_token IS NULL
      AND NEW.lease_expires_at IS NULL
    )
  ) THEN RAISE(ABORT,'invalid agent task request lease state') END;
END;
CREATE TRIGGER trg_agent_task_run_insert_guard
BEFORE INSERT ON agent_task_runs
BEGIN
  SELECT CASE WHEN
    NEW.attempt_number<=0 OR trim(NEW.lease_token)=''
    THEN RAISE(ABORT,'invalid agent task run attempt lease') END;
END;
CREATE TRIGGER trg_agent_task_run_update_guard
BEFORE UPDATE ON agent_task_runs
BEGIN
  SELECT CASE WHEN OLD.status IN ('completed','failed')
    THEN RAISE(ABORT,'terminal agent task run is immutable') END;
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.user_id IS NOT OLD.user_id
    OR NEW.runner_id IS NOT OLD.runner_id
    OR NEW.task_type IS NOT OLD.task_type
    OR NEW.source_task_id IS NOT OLD.source_task_id
    OR NEW.prompt_version IS NOT OLD.prompt_version
    OR NEW.model IS NOT OLD.model
    OR NEW.reasoning_effort IS NOT OLD.reasoning_effort
    OR NEW.source_hash IS NOT OLD.source_hash
    OR NEW.prompt_hash IS NOT OLD.prompt_hash
    OR NEW.started_at IS NOT OLD.started_at
    OR NEW.attempt_number IS NOT OLD.attempt_number
    OR NEW.lease_token IS NOT OLD.lease_token
    THEN RAISE(ABORT,'agent task run attempt is immutable') END;
  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    OLD.status='running' AND NEW.status IN ('completed','failed')
  ) THEN RAISE(ABORT,'invalid agent task run status transition') END;
END;
CREATE TRIGGER trg_public_source_label_version_immutable_update
BEFORE UPDATE ON public_source_display_label_versions
BEGIN
  SELECT RAISE(ABORT,'public source display label versions are immutable');
END;
CREATE TRIGGER trg_public_source_label_version_immutable_delete
BEFORE DELETE ON public_source_display_label_versions
BEGIN
  SELECT RAISE(ABORT,'public source display label versions are immutable');
END;
CREATE TRIGGER trg_public_source_label_head_advance
BEFORE UPDATE ON public_source_display_label_heads
BEGIN
  SELECT CASE WHEN NEW.source_key<>OLD.source_key
    THEN RAISE(ABORT,'public source display label identity is immutable') END;
  SELECT CASE WHEN NEW.current_version<>OLD.current_version+1
    THEN RAISE(ABORT,'public source display label head must advance one version') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_source_display_label_versions version
    WHERE version.source_key=OLD.source_key
      AND version.version=NEW.current_version
      AND version.predecessor_version=OLD.current_version
  ) THEN RAISE(ABORT,'public source display label successor is invalid') END;
END;
CREATE TRIGGER trg_public_source_label_head_immutable_delete
BEFORE DELETE ON public_source_display_label_heads
BEGIN
  SELECT RAISE(ABORT,'public source display label heads cannot be deleted');
END;
CREATE TRIGGER trg_source_policy_label_bind_after_insert
AFTER INSERT ON source_publication_policy_versions
BEGIN
  INSERT INTO source_publication_policy_label_versions (
    source_key,policy_version,label_version,created_at
  )
  SELECT NEW.source_key,NEW.version,head.current_version,NEW.created_at
  FROM public_source_display_label_heads head
  WHERE head.source_key=NEW.source_key;
END;
CREATE TRIGGER trg_source_policy_label_immutable_update
BEFORE UPDATE ON source_publication_policy_label_versions
BEGIN
  SELECT RAISE(ABORT,'source policy display label bindings are immutable');
END;
CREATE TRIGGER trg_source_policy_label_immutable_delete
BEFORE DELETE ON source_publication_policy_label_versions
BEGIN
  SELECT RAISE(ABORT,'source policy display label bindings are immutable');
END;
CREATE TRIGGER trg_public_job_catalog_seal_immutable_update
BEFORE UPDATE ON public_job_catalog_seals
BEGIN
  SELECT RAISE(ABORT,'public job catalog seals are immutable');
END;
CREATE TRIGGER trg_public_job_catalog_seal_immutable_delete
BEFORE DELETE ON public_job_catalog_seals
BEGIN
  SELECT RAISE(ABORT,'public job catalog seals are immutable');
END;
CREATE TRIGGER trg_public_job_catalog_seal_before_activation
BEFORE INSERT ON public_job_catalog_seals
WHEN EXISTS (
  SELECT 1 FROM public_job_catalog_head_history history
  WHERE history.catalog_version=NEW.catalog_version
)
BEGIN
  SELECT RAISE(ABORT,'public job catalog seals must precede activation');
END;
CREATE TRIGGER trg_public_job_catalog_head_record_activation
AFTER UPDATE ON public_job_catalog_head_pointer
BEGIN
  INSERT INTO public_job_catalog_head_history (catalog_version,activated_at)
  VALUES (NEW.current_version,NEW.updated_at);
END;
CREATE TRIGGER trg_public_job_catalog_head_immutable_delete
BEFORE DELETE ON public_job_catalog_head_pointer
BEGIN
  SELECT RAISE(ABORT,'public job catalog head cannot be deleted');
END;
CREATE TRIGGER trg_public_job_catalog_history_immutable_update
BEFORE UPDATE ON public_job_catalog_head_history
BEGIN
  SELECT RAISE(ABORT,'public job catalog activation history is immutable');
END;
CREATE TRIGGER trg_public_job_catalog_history_immutable_delete
BEFORE DELETE ON public_job_catalog_head_history
BEGIN
  SELECT RAISE(ABORT,'public job catalog activation history is immutable');
END;
CREATE TRIGGER trg_country_sweep_update_guard
BEFORE UPDATE ON country_sweeps
BEGIN
  SELECT CASE WHEN OLD.status IN (
    'completed','completed_with_gaps','failed','canceled'
  ) THEN RAISE(ABORT,'terminal country sweep is immutable') END;
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.country_code IS NOT OLD.country_code
    OR NEW.country_name IS NOT OLD.country_name
    OR NEW.requested_by_user_id IS NOT OLD.requested_by_user_id
    OR NEW.requested_scope_json IS NOT OLD.requested_scope_json
    OR NEW.requested_at IS NOT OLD.requested_at
    THEN RAISE(ABORT,'country sweep request is immutable') END;
  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('running','failed','canceled'))
    OR (
      OLD.status='running'
      AND NEW.status IN (
        'completed','completed_with_gaps','failed','canceled'
      )
    )
  ) THEN RAISE(ABORT,'invalid country sweep status transition') END;
END;
CREATE TRIGGER trg_country_sweep_task_insert_guard
BEFORE INSERT ON country_sweep_tasks
BEGIN
  SELECT CASE WHEN NEW.attempt_count>NEW.max_attempts
    THEN RAISE(ABORT,'country task attempt budget exceeded') END;
  SELECT CASE WHEN NOT (
    (
      NEW.status='claimed'
      AND NEW.worker_id IS NOT NULL
      AND trim(NEW.worker_id)<>''
      AND NEW.lease_token IS NOT NULL
      AND trim(NEW.lease_token)<>''
      AND NEW.lease_expires_at IS NOT NULL
      AND trim(NEW.lease_expires_at)<>''
      AND NEW.attempt_count>0
    )
    OR (
      NEW.status<>'claimed'
      AND NEW.worker_id IS NULL
      AND NEW.lease_token IS NULL
      AND NEW.lease_expires_at IS NULL
    )
  ) THEN RAISE(ABORT,'invalid country task lease state') END;
END;
CREATE TRIGGER trg_country_sweep_task_update_guard
BEFORE UPDATE ON country_sweep_tasks
BEGIN
  SELECT CASE WHEN OLD.status IN ('completed','failed')
    THEN RAISE(ABORT,'terminal country task is immutable') END;
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.sweep_id IS NOT OLD.sweep_id
    OR NEW.phase IS NOT OLD.phase
    OR NEW.scope_key IS NOT OLD.scope_key
    OR NEW.input_json IS NOT OLD.input_json
    OR NEW.max_attempts IS NOT OLD.max_attempts
    OR NEW.created_at IS NOT OLD.created_at
    OR (
      NEW.input_hash IS NOT OLD.input_hash
      AND NOT (
        OLD.status='queued' AND NEW.status='queued'
        AND OLD.attempt_count=0 AND NEW.attempt_count=0
        AND OLD.input_hash=printf('%064d',0)
      )
    )
    THEN RAISE(ABORT,'country task input is immutable') END;
  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('claimed','failed'))
    OR (
      OLD.status='claimed'
      AND NEW.status IN ('queued','materializing','completed','failed')
    )
    OR (OLD.status='materializing' AND NEW.status IN ('completed','failed'))
  ) THEN RAISE(ABORT,'invalid country task status transition') END;
  SELECT CASE WHEN
    OLD.status='queued' AND NEW.status='claimed'
    AND NEW.attempt_count<>OLD.attempt_count+1
    THEN RAISE(ABORT,'country task claim must advance attempt') END;
  SELECT CASE WHEN NOT (
    OLD.status='queued' AND NEW.status='claimed'
  ) AND NEW.attempt_count<>OLD.attempt_count
    THEN RAISE(ABORT,'country task attempts change only on claim') END;
  SELECT CASE WHEN
    OLD.status='claimed' AND NEW.status='claimed'
    AND (
      NEW.worker_id IS NOT OLD.worker_id
      OR NEW.lease_token IS NOT OLD.lease_token
    )
    THEN RAISE(ABORT,'country task lease ownership is immutable') END;
  SELECT CASE WHEN NOT (
    (
      NEW.status='claimed'
      AND NEW.worker_id IS NOT NULL
      AND trim(NEW.worker_id)<>''
      AND NEW.lease_token IS NOT NULL
      AND trim(NEW.lease_token)<>''
      AND NEW.lease_expires_at IS NOT NULL
      AND trim(NEW.lease_expires_at)<>''
      AND NEW.attempt_count>0
    )
    OR (
      NEW.status<>'claimed'
      AND NEW.worker_id IS NULL
      AND NEW.lease_token IS NULL
      AND NEW.lease_expires_at IS NULL
    )
  ) THEN RAISE(ABORT,'invalid country task lease state') END;
END;
CREATE TRIGGER trg_org_source_employer_mapping_operator
BEFORE INSERT ON organization_source_employer_mappings
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users
     WHERE id=NEW.accepted_by_user_id AND role='operator'
  ) THEN RAISE(ABORT,'source employer mapping requires an operator') END;
END;
CREATE TRIGGER trg_org_domain_mapping_operator
BEFORE INSERT ON organization_domain_mappings
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users
     WHERE id=NEW.accepted_by_user_id AND role='operator'
  ) THEN RAISE(ABORT,'domain mapping requires an operator') END;
END;
CREATE TRIGGER trg_org_opportunity_acceptance_operator
BEFORE INSERT ON organization_opportunity_acceptances
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users
     WHERE id=NEW.accepted_by_user_id AND role='operator'
  ) THEN RAISE(ABORT,'opportunity acceptance requires an operator') END;
END;
CREATE TRIGGER trg_projection_org_resolution_validate
BEFORE INSERT ON public_projection_organization_resolutions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM public_projection_position_items item
      JOIN public_projection_duplicate_batch_members member
        ON member.run_id=item.run_id AND member.position_item_id=item.id
      JOIN public_projection_duplicate_batches batch
        ON batch.run_id=item.run_id
     WHERE item.id=NEW.position_item_id AND item.run_id=NEW.run_id
       AND item.source_position_id=NEW.source_position_id
       AND item.input_hash=NEW.position_input_hash
       AND item.stage='canonical_resolution' AND item.status='processing'
       AND item.lease_token=NEW.claim_lease_token
       AND json_extract(item.checkpoint_json,'$.resolutionGuard')=
         NEW.resolution_guard_token
       AND json_extract(item.checkpoint_json,'$.analysisHashes.content')=
         NEW.content_analysis_hash
       AND json_extract(item.checkpoint_json,'$.analysisHashes.matchFacts')=
         NEW.match_facts_analysis_hash
       AND json_extract(item.checkpoint_json,'$.analysisHashes.position')=
         NEW.position_analysis_hash
       AND json_extract(item.checkpoint_json,'$.materialHash')=
         NEW.material_hash
       AND json_extract(item.checkpoint_json,'$.materialVersion')=
         NEW.material_version
       AND json_extract(item.checkpoint_json,'$.positionPayloadHash')=
         NEW.position_payload_hash
       AND item.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
       AND member.source_position_id=NEW.source_position_id
       AND member.input_hash=NEW.position_input_hash
       AND batch.input_hash=NEW.duplicate_batch_input_hash
       AND batch.canonical_identity_state='pending'
  ) THEN RAISE(ABORT,'canonical resolution lease or D2 seal changed') END;
END;
CREATE TRIGGER trg_projection_location_resolution_validate
BEFORE INSERT ON public_projection_location_resolutions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_position_items item
     WHERE item.id=NEW.position_item_id AND item.run_id=NEW.run_id
       AND item.input_hash=NEW.position_input_hash
       AND item.stage='canonical_resolution' AND item.status='processing'
       AND item.lease_token=NEW.claim_lease_token
       AND json_extract(item.checkpoint_json,'$.resolutionGuard')=
         NEW.resolution_guard_token
       AND item.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  ) THEN RAISE(ABORT,'location resolution lease changed') END;
END;
CREATE TRIGGER trg_projection_resolution_child_after_seal
BEFORE INSERT ON public_projection_organization_candidates
WHEN EXISTS (
  SELECT 1 FROM public_projection_resolution_seals seal
   WHERE seal.run_id=NEW.run_id
     AND seal.organization_resolution_id=NEW.resolution_id
)
BEGIN
  SELECT RAISE(ABORT,'canonical resolution children are sealed');
END;
CREATE TRIGGER trg_projection_resolution_evidence_after_seal
BEFORE INSERT ON public_projection_organization_evidence
WHEN EXISTS (
  SELECT 1 FROM public_projection_resolution_seals seal
   WHERE seal.run_id=NEW.run_id
     AND seal.organization_resolution_id=NEW.resolution_id
)
BEGIN
  SELECT RAISE(ABORT,'canonical resolution evidence is sealed');
END;
CREATE TRIGGER trg_projection_location_child_after_seal
BEFORE INSERT ON public_projection_location_candidates
WHEN EXISTS (
  SELECT 1 FROM public_projection_location_resolutions location
  JOIN public_projection_resolution_seals seal
    ON seal.run_id=location.run_id
   AND seal.position_item_id=location.position_item_id
   WHERE location.id=NEW.resolution_id AND location.run_id=NEW.run_id
)
BEGIN
  SELECT RAISE(ABORT,'canonical location candidates are sealed');
END;
CREATE TRIGGER trg_projection_location_evidence_after_seal
BEFORE INSERT ON public_projection_location_evidence
WHEN EXISTS (
  SELECT 1 FROM public_projection_location_resolutions location
  JOIN public_projection_resolution_seals seal
    ON seal.run_id=location.run_id
   AND seal.position_item_id=location.position_item_id
   WHERE location.id=NEW.resolution_id AND location.run_id=NEW.run_id
)
BEGIN
  SELECT RAISE(ABORT,'canonical location evidence is sealed');
END;
CREATE TRIGGER trg_projection_provider_evidence_after_seal
BEFORE INSERT ON public_projection_location_provider_evidence
WHEN EXISTS (
  SELECT 1 FROM public_projection_location_resolutions location
  JOIN public_projection_resolution_seals seal
    ON seal.run_id=location.run_id
   AND seal.position_item_id=location.position_item_id
   WHERE location.id=NEW.resolution_id AND location.run_id=NEW.run_id
)
BEGIN
  SELECT RAISE(ABORT,'canonical provider evidence is sealed');
END;
CREATE TRIGGER trg_projection_canonical_signal_validate
BEFORE INSERT ON public_projection_canonical_identity_signals
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_organization_resolutions resolution
     WHERE resolution.id=NEW.organization_resolution_id
       AND resolution.run_id=NEW.run_id
       AND resolution.position_item_id=NEW.position_item_id
       AND resolution.resolution_hash=NEW.organization_resolution_hash
  ) THEN RAISE(ABORT,'canonical signal organization snapshot changed') END;
END;
CREATE TRIGGER trg_projection_resolution_seal_validate
BEFORE INSERT ON public_projection_resolution_seals
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM public_projection_position_items item
      JOIN public_projection_duplicate_batches batch
        ON batch.run_id=item.run_id
      JOIN public_projection_organization_resolutions organization
        ON organization.run_id=item.run_id
       AND organization.position_item_id=item.id
     WHERE item.id=NEW.position_item_id AND item.run_id=NEW.run_id
       AND item.source_position_id=NEW.source_position_id
       AND item.input_hash=NEW.position_input_hash
       AND item.stage='canonical_resolution' AND item.status='processing'
       AND item.lease_token=NEW.claim_lease_token
       AND item.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
       AND batch.input_hash=NEW.duplicate_batch_input_hash
       AND organization.id=NEW.organization_resolution_id
       AND organization.resolution_hash=NEW.organization_resolution_hash
       AND organization.claim_lease_token=NEW.claim_lease_token
  ) THEN RAISE(ABORT,'canonical resolution seal snapshot changed') END;

  SELECT CASE WHEN NEW.location_count<>(
    SELECT COUNT(*) FROM public_projection_location_resolutions location
     WHERE location.run_id=NEW.run_id
       AND location.position_item_id=NEW.position_item_id
  ) THEN RAISE(ABORT,'canonical location resolution set is incomplete') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_canonical_identity_signals signal
     WHERE signal.run_id=NEW.run_id
       AND signal.position_item_id=NEW.position_item_id
       AND (
         (NEW.state='resolved'
           AND signal.state='resolved'
           AND signal.signal_hash=NEW.canonical_signal_hash)
         OR (NEW.state<>'resolved'
           AND signal.state='blocked'
           AND signal.signal_hash IS NULL)
       )
  ) THEN RAISE(ABORT,'canonical identity signal seal changed') END;
END;
CREATE TRIGGER trg_projection_org_resolution_update_immutable
BEFORE UPDATE ON public_projection_organization_resolutions
BEGIN SELECT RAISE(ABORT,'organization resolutions are immutable'); END;
CREATE TRIGGER trg_projection_org_resolution_delete_immutable
BEFORE DELETE ON public_projection_organization_resolutions
BEGIN SELECT RAISE(ABORT,'organization resolutions are append-only'); END;
CREATE TRIGGER trg_projection_org_candidate_update_immutable
BEFORE UPDATE ON public_projection_organization_candidates
BEGIN SELECT RAISE(ABORT,'organization candidates are immutable'); END;
CREATE TRIGGER trg_projection_org_candidate_delete_immutable
BEFORE DELETE ON public_projection_organization_candidates
BEGIN SELECT RAISE(ABORT,'organization candidates are append-only'); END;
CREATE TRIGGER trg_projection_org_evidence_update_immutable
BEFORE UPDATE ON public_projection_organization_evidence
BEGIN SELECT RAISE(ABORT,'organization evidence is immutable'); END;
CREATE TRIGGER trg_projection_org_evidence_delete_immutable
BEFORE DELETE ON public_projection_organization_evidence
BEGIN SELECT RAISE(ABORT,'organization evidence is append-only'); END;
CREATE TRIGGER trg_projection_location_resolution_update_immutable
BEFORE UPDATE ON public_projection_location_resolutions
BEGIN SELECT RAISE(ABORT,'location resolutions are immutable'); END;
CREATE TRIGGER trg_projection_location_resolution_delete_immutable
BEFORE DELETE ON public_projection_location_resolutions
BEGIN SELECT RAISE(ABORT,'location resolutions are append-only'); END;
CREATE TRIGGER trg_projection_provider_evidence_update_immutable
BEFORE UPDATE ON public_projection_location_provider_evidence
BEGIN SELECT RAISE(ABORT,'provider evidence is immutable'); END;
CREATE TRIGGER trg_projection_provider_evidence_delete_immutable
BEFORE DELETE ON public_projection_location_provider_evidence
BEGIN SELECT RAISE(ABORT,'provider evidence is append-only'); END;
CREATE TRIGGER trg_projection_location_candidate_update_immutable
BEFORE UPDATE ON public_projection_location_candidates
BEGIN SELECT RAISE(ABORT,'location candidates are immutable'); END;
CREATE TRIGGER trg_projection_location_candidate_delete_immutable
BEFORE DELETE ON public_projection_location_candidates
BEGIN SELECT RAISE(ABORT,'location candidates are append-only'); END;
CREATE TRIGGER trg_projection_location_evidence_update_immutable
BEFORE UPDATE ON public_projection_location_evidence
BEGIN SELECT RAISE(ABORT,'location evidence is immutable'); END;
CREATE TRIGGER trg_projection_location_evidence_delete_immutable
BEFORE DELETE ON public_projection_location_evidence
BEGIN SELECT RAISE(ABORT,'location evidence is append-only'); END;
CREATE TRIGGER trg_projection_canonical_signal_update_immutable
BEFORE UPDATE ON public_projection_canonical_identity_signals
BEGIN SELECT RAISE(ABORT,'canonical identity signals are immutable'); END;
CREATE TRIGGER trg_projection_canonical_signal_delete_immutable
BEFORE DELETE ON public_projection_canonical_identity_signals
BEGIN SELECT RAISE(ABORT,'canonical identity signals are append-only'); END;
CREATE TRIGGER trg_projection_resolution_seal_update_immutable
BEFORE UPDATE ON public_projection_resolution_seals
BEGIN SELECT RAISE(ABORT,'canonical resolution seals are immutable'); END;
CREATE TRIGGER trg_projection_resolution_seal_delete_immutable
BEFORE DELETE ON public_projection_resolution_seals
BEGIN SELECT RAISE(ABORT,'canonical resolution seals are append-only'); END;
CREATE TRIGGER trg_org_source_employer_mapping_update_immutable
BEFORE UPDATE ON organization_source_employer_mappings
BEGIN SELECT RAISE(ABORT,'source employer mappings are immutable'); END;
CREATE TRIGGER trg_org_source_employer_mapping_delete_immutable
BEFORE DELETE ON organization_source_employer_mappings
BEGIN SELECT RAISE(ABORT,'source employer mappings are append-only'); END;
CREATE TRIGGER trg_org_domain_mapping_update_immutable
BEFORE UPDATE ON organization_domain_mappings
BEGIN SELECT RAISE(ABORT,'domain mappings are immutable'); END;
CREATE TRIGGER trg_org_domain_mapping_delete_immutable
BEFORE DELETE ON organization_domain_mappings
BEGIN SELECT RAISE(ABORT,'domain mappings are append-only'); END;
CREATE TRIGGER trg_org_opportunity_acceptance_update_immutable
BEFORE UPDATE ON organization_opportunity_acceptances
BEGIN SELECT RAISE(ABORT,'opportunity acceptances are immutable'); END;
CREATE TRIGGER trg_org_opportunity_acceptance_delete_immutable
BEFORE DELETE ON organization_opportunity_acceptances
BEGIN SELECT RAISE(ABORT,'opportunity acceptances are append-only'); END;
CREATE TRIGGER trg_country_output_update_guard
BEFORE UPDATE ON country_sweep_outputs
BEGIN
  SELECT CASE WHEN OLD.status IN ('materialized','failed','abandoned')
    THEN RAISE(ABORT,'terminal country output is immutable') END;
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.sweep_id IS NOT OLD.sweep_id
    OR NEW.task_id IS NOT OLD.task_id
    OR NEW.agent_run_id IS NOT OLD.agent_run_id
    OR NEW.attempt_number IS NOT OLD.attempt_number
    OR NEW.schema_version IS NOT OLD.schema_version
    OR NEW.created_at IS NOT OLD.created_at
    THEN RAISE(ABORT,'country output identity is immutable') END;
  SELECT CASE WHEN OLD.status<>'uploading' AND (
    NEW.next_chunk_ordinal IS NOT OLD.next_chunk_ordinal
    OR NEW.rolling_sha256 IS NOT OLD.rolling_sha256
    OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256
    OR NEW.chunk_count IS NOT OLD.chunk_count
    OR NEW.total_bytes IS NOT OLD.total_bytes
    OR NEW.organization_count IS NOT OLD.organization_count
    OR NEW.contact_count IS NOT OLD.contact_count
    OR NEW.scope_count IS NOT OLD.scope_count
    OR NEW.coverage_summary_json IS NOT OLD.coverage_summary_json
    OR NEW.accepted_at IS NOT OLD.accepted_at
  ) THEN RAISE(ABORT,'accepted country output manifest is immutable') END;
  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='uploading' AND NEW.status IN ('accepted','abandoned'))
    OR (OLD.status='accepted' AND NEW.status IN ('materializing','failed'))
    OR (OLD.status='materializing' AND NEW.status IN ('materialized','failed'))
  ) THEN RAISE(ABORT,'invalid country output status transition') END;
END;
CREATE TRIGGER trg_country_output_chunk_immutable
BEFORE UPDATE ON country_sweep_output_chunks
BEGIN
  SELECT RAISE(ABORT,'country output chunk is immutable');
END;
CREATE TRIGGER trg_country_output_chunk_insert_before_acceptance
BEFORE INSERT ON country_sweep_output_chunks
WHEN EXISTS (
  SELECT 1
  FROM country_sweep_outputs output
  WHERE output.id=NEW.output_id
    AND output.status<>'uploading'
)
BEGIN
  SELECT RAISE(ABORT,'accepted country output manifest is immutable');
END;
CREATE TRIGGER trg_country_output_chunk_no_delete
BEFORE DELETE ON country_sweep_output_chunks
BEGIN
  SELECT RAISE(ABORT,'country output chunk is immutable');
END;
CREATE TRIGGER trg_projection_final_component_root_candidate_phase
BEFORE INSERT ON public_projection_final_component_root_candidates
WHEN NOT EXISTS (
  SELECT 1 FROM public_projection_final_component_work component
   WHERE component.run_id=NEW.run_id
     AND component.seed_member_key=NEW.seed_member_key
     AND component.state IN ('members','relations')
     AND component.root_summary_ready=0
)
BEGIN SELECT RAISE(ABORT,'D3 component root candidates are closed'); END;
CREATE TRIGGER trg_projection_final_component_root_candidate_count
AFTER INSERT ON public_projection_final_component_root_candidates
BEGIN
  UPDATE public_projection_final_component_work
     SET root_candidate_count=root_candidate_count+1
   WHERE run_id=NEW.run_id AND seed_member_key=NEW.seed_member_key;
END;
CREATE TRIGGER trg_projection_final_assertion_consume
AFTER INSERT ON public_projection_final_assertions
BEGIN
  DELETE FROM public_projection_final_assertions WHERE rowid=NEW.rowid;
END;
CREATE TRIGGER trg_projection_operator_decision_validate
BEFORE INSERT ON public_projection_duplicate_operator_decisions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users
     WHERE id=NEW.operator_user_id AND role='operator'
  ) THEN RAISE(ABORT,'final duplicate decision requires an operator') END;

  SELECT CASE WHEN NEW.supersedes_decision_id IS NULL AND EXISTS (
    SELECT 1 FROM public_projection_duplicate_operator_decisions prior
     WHERE prior.left_member_key=NEW.left_member_key
       AND prior.right_member_key=NEW.right_member_key
  ) THEN RAISE(ABORT,'final duplicate decision requires its predecessor') END;

  SELECT CASE WHEN NEW.supersedes_decision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_operator_decisions prior
     WHERE prior.id=NEW.supersedes_decision_id
       AND prior.left_member_key=NEW.left_member_key
       AND prior.right_member_key=NEW.right_member_key
  ) THEN RAISE(ABORT,'final duplicate decision predecessor changed') END;

  SELECT CASE WHEN NEW.supersedes_decision_id IS NOT NULL AND (
    NEW.decision='deferred' OR NOT EXISTS (
      SELECT 1 FROM public_projection_duplicate_operator_decisions prior
       WHERE prior.id=NEW.supersedes_decision_id
         AND prior.decision='deferred'
    )
  ) THEN RAISE(ABORT,'final duplicate decision resolution is invalid') END;
END;
CREATE TRIGGER trg_projection_final_relation_validate
BEFORE INSERT ON public_projection_final_duplicate_relations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
    JOIN public_projection_duplicate_batches batch ON batch.run_id=run.id
     WHERE run.id=NEW.run_id AND run.mode='shadow'
       AND run.status='running' AND run.selection_complete=1
       AND batch.canonical_identity_state='pending'
  ) OR EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'final duplicate relation boundary is unavailable') END;

  SELECT CASE WHEN NEW.d2_comparison_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_comparisons comparison
     WHERE comparison.id=NEW.d2_comparison_id
       AND comparison.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'final duplicate D2 reference changed') END;

  SELECT CASE WHEN NEW.operator_decision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_operator_decisions decision
     WHERE decision.id=NEW.operator_decision_id
       AND decision.left_member_key=NEW.left_member_key
       AND decision.right_member_key=NEW.right_member_key
       AND (
         (decision.decision='same' AND NEW.relation='same'
           AND NEW.reason_code='operator_confirmed_same')
         OR (decision.decision='different' AND NEW.relation='different'
           AND NEW.reason_code='operator_confirmed_different')
         OR (decision.decision='deferred' AND NEW.relation='ambiguous'
           AND NEW.reason_code='operator_deferred')
       )
  ) THEN RAISE(ABORT,'final duplicate operator decision changed') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_final_work_relations work
     WHERE work.run_id=NEW.run_id AND work.id=NEW.id
       AND work.relation_hash=NEW.relation_hash
       AND work.operator_terminal=1
       AND (
         (
           work.operator_decision_id IS NULL
           AND NEW.operator_decision_id IS NULL
           AND (
             NEW.relation<>'ambiguous' OR NOT EXISTS (
               SELECT 1
                 FROM public_projection_duplicate_operator_decisions decision
                WHERE decision.left_member_key=NEW.left_member_key
                  AND decision.right_member_key=NEW.right_member_key
                  AND NOT EXISTS (
                    SELECT 1
                      FROM public_projection_duplicate_operator_decisions next
                     WHERE next.supersedes_decision_id=decision.id
                  )
             )
           )
         )
         OR (
           work.operator_decision_id=NEW.operator_decision_id
           AND work.operator_decision_hash=(
             SELECT decision.decision_hash
               FROM public_projection_duplicate_operator_decisions decision
              WHERE decision.id=NEW.operator_decision_id
           )
           AND NOT EXISTS (
             SELECT 1
               FROM public_projection_duplicate_operator_decisions next
              WHERE next.supersedes_decision_id=NEW.operator_decision_id
           )
         )
       )
  ) THEN RAISE(ABORT,'final duplicate relation work pin changed') END;

  SELECT CASE WHEN NEW.left_member_kind='shadow' AND NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_batch_members member
    JOIN public_projection_resolution_seals seal
      ON seal.run_id=member.run_id
     AND seal.position_item_id=member.position_item_id
     WHERE member.run_id=NEW.run_id
       AND member.source_position_id=NEW.left_source_position_id
       AND member.input_hash=NEW.left_input_hash
       AND seal.state='resolved'
  ) THEN RAISE(ABORT,'final duplicate left shadow member changed') END;

  SELECT CASE WHEN NEW.right_member_kind='shadow' AND NOT EXISTS (
    SELECT 1 FROM public_projection_duplicate_batch_members member
    JOIN public_projection_resolution_seals seal
      ON seal.run_id=member.run_id
     AND seal.position_item_id=member.position_item_id
     WHERE member.run_id=NEW.run_id
       AND member.source_position_id=NEW.right_source_position_id
       AND member.input_hash=NEW.right_input_hash
       AND seal.state='resolved'
  ) THEN RAISE(ABORT,'final duplicate right shadow member changed') END;

  SELECT CASE WHEN NEW.left_member_kind='public' AND NOT EXISTS (
    SELECT 1 FROM public_job_heads job_head
    JOIN public_job_eligibility_heads eligibility_head
      ON eligibility_head.public_job_id=job_head.public_job_id
     WHERE job_head.public_job_id=NEW.left_public_job_id
       AND job_head.current_version=NEW.left_public_job_version
       AND eligibility_head.current_decision_version=
         NEW.left_eligibility_decision_version
  ) THEN RAISE(ABORT,'final duplicate left public member changed') END;

  SELECT CASE WHEN NEW.right_member_kind='public' AND NOT EXISTS (
    SELECT 1 FROM public_job_heads job_head
    JOIN public_job_eligibility_heads eligibility_head
      ON eligibility_head.public_job_id=job_head.public_job_id
     WHERE job_head.public_job_id=NEW.right_public_job_id
       AND job_head.current_version=NEW.right_public_job_version
       AND eligibility_head.current_decision_version=
         NEW.right_eligibility_decision_version
  ) THEN RAISE(ABORT,'final duplicate right public member changed') END;
END;
CREATE TRIGGER trg_projection_allocation_component_validate
BEFORE INSERT ON public_projection_allocation_components
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
    JOIN public_projection_duplicate_batches batch ON batch.run_id=run.id
     WHERE run.id=NEW.run_id AND run.mode='shadow'
       AND run.status='running' AND run.selection_complete=1
       AND batch.canonical_identity_state='pending'
  ) OR EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'allocation component boundary is unavailable') END;
END;
CREATE TRIGGER trg_projection_allocation_member_validate
BEFORE INSERT ON public_projection_allocation_members
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'allocation member boundary is sealed') END;

  SELECT CASE WHEN NEW.member_kind='shadow' AND (
    NEW.member_key<>'shadow:' || NEW.source_position_id || ':' || NEW.input_hash
    OR NOT EXISTS (
      SELECT 1 FROM public_projection_duplicate_batch_members member
      JOIN public_projection_resolution_seals seal
        ON seal.run_id=member.run_id
       AND seal.position_item_id=member.position_item_id
       WHERE member.run_id=NEW.run_id
         AND member.position_item_id=NEW.position_item_id
         AND member.source_position_id=NEW.source_position_id
         AND member.input_hash=NEW.input_hash AND seal.state='resolved'
    )
  ) THEN RAISE(ABORT,'allocation shadow member changed') END;

  SELECT CASE WHEN NEW.member_kind='public' AND (
    NEW.member_key<>'public:' || NEW.public_job_id || ':' ||
      NEW.public_job_version || ':' || NEW.eligibility_decision_version
    OR NOT EXISTS (
      SELECT 1 FROM public_job_heads job_head
      JOIN public_job_eligibility_heads eligibility_head
        ON eligibility_head.public_job_id=job_head.public_job_id
       WHERE job_head.public_job_id=NEW.public_job_id
         AND job_head.current_version=NEW.public_job_version
         AND eligibility_head.current_decision_version=
           NEW.eligibility_decision_version
    )
  ) THEN RAISE(ABORT,'allocation public member changed') END;
END;
CREATE TRIGGER trg_projection_allocation_relation_validate
BEFORE INSERT ON public_projection_allocation_relations
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'allocation relation boundary is sealed') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_relations relation
     WHERE relation.run_id=NEW.run_id AND relation.id=NEW.relation_id
       AND relation.relation_hash=NEW.relation_hash
       AND (
         EXISTS (
           SELECT 1 FROM public_projection_allocation_members member
            WHERE member.run_id=NEW.run_id
              AND member.allocation_id=NEW.allocation_id
              AND member.member_key=relation.left_member_key
         )
         OR EXISTS (
           SELECT 1 FROM public_projection_allocation_members member
            WHERE member.run_id=NEW.run_id
              AND member.allocation_id=NEW.allocation_id
              AND member.member_key=relation.right_member_key
         )
       )
  ) THEN RAISE(ABORT,'allocation relation does not touch its component') END;
END;
CREATE TRIGGER trg_projection_allocation_root_validate
BEFORE INSERT ON public_projection_allocation_roots
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'allocation root boundary is sealed') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_job_heads job_head
    JOIN public_job_eligibility_heads eligibility_head
      ON eligibility_head.public_job_id=job_head.public_job_id
     WHERE job_head.public_job_id=NEW.public_job_id
       AND job_head.current_version=NEW.public_job_version
       AND eligibility_head.current_decision_version=
         NEW.eligibility_decision_version
  ) THEN RAISE(ABORT,'allocation public root changed') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_allocation_members member
     WHERE member.run_id=NEW.run_id
       AND member.allocation_id=NEW.allocation_id
       AND member.member_kind='public'
       AND member.member_key=NEW.member_key
  ) AND NOT EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_relations relation
     WHERE relation.run_id=NEW.run_id AND relation.relation<>'different'
       AND (
         (relation.left_member_key=NEW.member_key AND EXISTS (
           SELECT 1 FROM public_projection_allocation_members member
            WHERE member.run_id=NEW.run_id
              AND member.allocation_id=NEW.allocation_id
              AND member.member_key=relation.right_member_key
         ))
         OR (relation.right_member_key=NEW.member_key AND EXISTS (
           SELECT 1 FROM public_projection_allocation_members member
            WHERE member.run_id=NEW.run_id
              AND member.allocation_id=NEW.allocation_id
              AND member.member_key=relation.left_member_key
         ))
       )
  ) THEN RAISE(ABORT,'allocation root does not touch its component') END;
END;
CREATE TRIGGER trg_projection_final_canonical_live_input_validate
BEFORE INSERT ON public_projection_final_canonical_live_inputs
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
     WHERE run.id=NEW.run_id AND run.status='running' AND run.mode='shadow'
  ) THEN RAISE(ABORT,'canonical live input boundary is unavailable') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_job_identity_signals signal
    JOIN public_job_heads head ON head.public_job_id=signal.public_job_id
     WHERE signal.public_job_id=NEW.public_job_id
       AND signal.public_job_version=NEW.public_job_version
       AND signal.signal_kind=NEW.signal_kind
       AND signal.signal_hash=NEW.signal_hash
       AND head.current_version=NEW.public_job_version
  ) THEN RAISE(ABORT,'canonical live input snapshot changed') END;
END;
CREATE TRIGGER trg_projection_final_source_mapping_input_validate
BEFORE INSERT ON public_projection_final_source_mapping_inputs
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
     WHERE run.id=NEW.run_id AND run.status='running' AND run.mode='shadow'
  ) THEN RAISE(ABORT,'source mapping input boundary is unavailable') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM job_source_position_mapping_heads head
    JOIN job_source_position_mapping_versions mapping
      ON mapping.source_position_id=head.source_position_id
     AND mapping.version=head.current_version
     WHERE head.source_position_id=NEW.source_position_id
       AND head.current_version=NEW.mapping_version
       AND mapping.mapping_state='mapped'
       AND mapping.public_job_id=NEW.public_job_id
       AND mapping.mapping_hash=NEW.mapping_hash
  ) THEN RAISE(ABORT,'source mapping input snapshot changed') END;
END;
CREATE TRIGGER trg_projection_position_final_graph_transition
BEFORE UPDATE OF stage,status,checkpoint_json
  ON public_projection_position_items
WHEN OLD.stage='canonical_resolution' AND NEW.stage='content'
BEGIN
  SELECT CASE WHEN OLD.status<>'queued' OR NEW.status<>'queued'
    OR NOT EXISTS (
      SELECT 1 FROM public_projection_resolution_seals seal
      JOIN public_projection_allocation_members member
        ON member.run_id=seal.run_id
       AND member.position_item_id=seal.position_item_id
       AND member.member_kind='shadow'
      JOIN public_projection_allocation_components allocation
        ON allocation.run_id=member.run_id
       AND allocation.id=member.allocation_id
       WHERE seal.run_id=OLD.run_id AND seal.position_item_id=OLD.id
         AND seal.state='resolved'
         AND member.source_position_id=OLD.source_position_id
         AND member.input_hash=OLD.input_hash
         AND json_extract(NEW.checkpoint_json,
               '$.finalDuplicateGraph.allocationId')=allocation.id
         AND json_extract(NEW.checkpoint_json,
               '$.finalDuplicateGraph.allocationHash')=
             allocation.allocation_hash
         AND json_extract(NEW.checkpoint_json,
               '$.finalDuplicateGraph.state')=allocation.state
         AND json_extract(NEW.checkpoint_json,
               '$.finalDuplicateGraph.reasonCode')=allocation.reason_code
    )
  THEN RAISE(ABORT,'position final duplicate allocation changed') END;
END;
CREATE TRIGGER trg_projection_final_seal_validate
BEFORE INSERT ON public_projection_final_duplicate_seals
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_duplicate_seals seal
     WHERE seal.run_id=NEW.run_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public_projection_runs run
    JOIN public_projection_duplicate_batches batch ON batch.run_id=run.id
     WHERE run.id=NEW.run_id AND run.mode='shadow'
       AND run.status='running' AND run.selection_complete=1
       AND batch.canonical_identity_state='pending'
       AND batch.input_hash=NEW.duplicate_batch_input_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM public_projection_final_work work
     WHERE work.run_id=NEW.run_id AND work.phase='ready'
       AND work.status='queued'
       AND work.resolution_count=NEW.resolution_count
       AND work.resolution_digest=NEW.resolution_digest
       AND work.canonical_match_count=NEW.canonical_live_input_count
       AND work.canonical_match_digest=NEW.canonical_live_input_digest
       AND work.relation_count=NEW.relation_count
       AND work.relation_digest=NEW.relation_digest
       AND work.component_count=NEW.allocation_count
       AND work.component_digest=NEW.allocation_digest
       AND work.allocation_digest=NEW.allocation_digest
       AND work.source_mapping_count=NEW.source_mapping_input_count
       AND work.source_mapping_digest=NEW.source_mapping_input_digest
  ) THEN RAISE(ABORT,'final duplicate seal boundary changed') END;

  SELECT CASE WHEN NEW.resolution_count<>(
    SELECT COUNT(*) FROM public_projection_duplicate_batch_members member
    JOIN public_projection_resolution_seals seal
      ON seal.run_id=member.run_id
     AND seal.position_item_id=member.position_item_id
     WHERE member.run_id=NEW.run_id
  ) OR NEW.resolution_count<>(
    SELECT COUNT(*) FROM public_projection_duplicate_batch_members member
     WHERE member.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'final duplicate resolution set is incomplete') END;

  SELECT CASE WHEN NEW.resolved_position_count<>(
    SELECT COUNT(*) FROM public_projection_resolution_seals seal
     WHERE seal.run_id=NEW.run_id AND seal.state='resolved'
  ) OR NEW.blocked_resolution_count<>(
    SELECT COUNT(*) FROM public_projection_resolution_seals seal
     WHERE seal.run_id=NEW.run_id AND seal.state<>'resolved'
  ) THEN RAISE(ABORT,'final duplicate resolution counts changed') END;

  SELECT CASE WHEN NEW.relation_count<>(
    SELECT COUNT(*) FROM public_projection_final_duplicate_relations relation
     WHERE relation.run_id=NEW.run_id
  ) OR NEW.allocation_count<>(
    SELECT COUNT(*) FROM public_projection_allocation_components allocation
     WHERE allocation.run_id=NEW.run_id
  ) OR NEW.promotable_count<>(
    SELECT COUNT(*) FROM public_projection_allocation_components allocation
     WHERE allocation.run_id=NEW.run_id AND allocation.state='promotable'
  ) OR NEW.blocked_allocation_count<>(
    SELECT COUNT(*) FROM public_projection_allocation_components allocation
     WHERE allocation.run_id=NEW.run_id AND allocation.state='blocked'
  ) THEN RAISE(ABORT,'final duplicate artifact counts changed') END;

  SELECT CASE WHEN NEW.canonical_live_input_count<>(
    SELECT COUNT(*)
      FROM public_projection_final_canonical_live_inputs input
     WHERE input.run_id=NEW.run_id
  ) OR NEW.source_mapping_input_count<>(
    SELECT COUNT(*)
      FROM public_projection_final_source_mapping_inputs input
     WHERE input.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'final duplicate live input counts changed') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_work work
     WHERE work.run_id=NEW.run_id AND (
       work.resolution_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_resolution_inputs input
          WHERE input.run_id=work.run_id
       )
       OR work.mapping_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_mapping_inputs input
          WHERE input.run_id=work.run_id
       )
       OR work.source_mapping_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_mapping_inputs input
          WHERE input.run_id=work.run_id
            AND input.mapping_state='mapped' AND input.public_job_id IS NOT NULL
       )
       OR work.canonical_request_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_canonical_requests request
          WHERE request.run_id=work.run_id
       )
       OR EXISTS (
         SELECT 1
           FROM public_projection_final_work_canonical_requests request
          WHERE request.run_id=work.run_id
            AND (request.match_complete<>1 OR request.match_digest IS NULL)
       )
       OR work.canonical_match_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_canonical_matches input
          WHERE input.run_id=work.run_id
       )
       OR work.canonical_match_count<>(
         SELECT COALESCE(SUM(request.match_count),0)
           FROM public_projection_final_work_canonical_requests request
          WHERE request.run_id=work.run_id
       )
       OR work.public_root_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_public_roots input
          WHERE input.run_id=work.run_id
       )
       OR work.relation_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_relations relation
          WHERE relation.run_id=work.run_id
       )
       OR work.component_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_component_work component
          WHERE component.run_id=work.run_id AND component.state='sealed'
       )
       OR work.resolution_last_cursor<>COALESCE((
         SELECT json_object(
                  'inputHash',input.input_hash,
                  'positionItemId',input.position_item_id,
                  'sourcePositionId',input.source_position_id
                )
           FROM public_projection_final_work_resolution_inputs input
          WHERE input.run_id=work.run_id ORDER BY input.ordinal DESC LIMIT 1
       ),'')
       OR work.mapping_last_cursor<>COALESCE((
         SELECT input.source_position_id
           FROM public_projection_final_work_mapping_inputs input
          WHERE input.run_id=work.run_id ORDER BY input.ordinal DESC LIMIT 1
       ),'')
       OR work.source_mapping_last_cursor<>COALESCE((
         SELECT input.source_position_id
           FROM public_projection_final_work_mapping_inputs input
          WHERE input.run_id=work.run_id
            AND input.mapping_state='mapped' AND input.public_job_id IS NOT NULL
          ORDER BY input.ordinal DESC LIMIT 1
       ),'')
       OR work.canonical_request_last_cursor<>COALESCE((
         SELECT request.signal_hash
           FROM public_projection_final_work_canonical_requests request
          WHERE request.run_id=work.run_id ORDER BY request.ordinal DESC LIMIT 1
       ),'')
       OR work.canonical_match_last_cursor<>COALESCE((
         SELECT json_object(
                  'publicJobId',input.public_job_id,
                  'publicJobVersion',input.public_job_version,
                  'signalHash',input.signal_hash
                )
           FROM public_projection_final_work_canonical_matches input
          WHERE input.run_id=work.run_id ORDER BY input.ordinal DESC LIMIT 1
       ),'')
       OR work.public_root_last_cursor<>COALESCE((
         SELECT input.originating_public_job_id
           FROM public_projection_final_work_public_roots input
          WHERE input.run_id=work.run_id ORDER BY input.ordinal DESC LIMIT 1
       ),'')
       OR work.relation_last_cursor<>COALESCE((
         SELECT relation.id
           FROM public_projection_final_work_relations relation
          WHERE relation.run_id=work.run_id
          ORDER BY relation.ordinal DESC LIMIT 1
       ),'')
       OR work.component_last_cursor<>COALESCE((
         SELECT component.seed_member_key
           FROM public_projection_final_component_work component
          WHERE component.run_id=work.run_id AND component.state='sealed'
          ORDER BY component.seed_member_key DESC LIMIT 1
       ),'')
     )
  ) THEN RAISE(ABORT,'final duplicate normalized work is incomplete') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_final_component_work component
     WHERE component.run_id=NEW.run_id AND component.state='sealed' AND (
       component.allocation_id IS NULL
       OR component.allocation_hash IS NULL
       OR component.artifact_hash IS NULL
       OR component.member_digest IS NULL
       OR component.relation_digest IS NULL
       OR component.root_digest IS NULL
       OR component.root_summary_ready<>1
       OR component.root_expected_count IS NULL
       OR component.root_expected_count<>component.root_candidate_count
       OR component.root_count<>component.root_expected_count
       OR component.root_candidate_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_component_root_candidates candidate
          WHERE candidate.run_id=component.run_id
            AND candidate.seed_member_key=component.seed_member_key
       )
       OR component.member_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_component_members member
          WHERE member.run_id=component.run_id
            AND member.seed_member_key=component.seed_member_key
       )
       OR component.member_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_component_frontier frontier
          WHERE frontier.run_id=component.run_id
            AND frontier.seed_member_key=component.seed_member_key
       )
       OR component.root_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_component_roots root
          WHERE root.run_id=component.run_id
            AND root.seed_member_key=component.seed_member_key
       )
       OR component.relation_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_component_relations relation
          WHERE relation.run_id=component.run_id
            AND relation.seed_member_key=component.seed_member_key
       )
       OR component.relation_count<>(
         SELECT COUNT(*)
           FROM public_projection_final_work_relations relation
          WHERE relation.run_id=component.run_id
            AND (EXISTS (
              SELECT 1
                FROM public_projection_final_component_frontier frontier
               WHERE frontier.run_id=relation.run_id
                 AND frontier.seed_member_key=component.seed_member_key
                 AND frontier.member_key=relation.left_member_key
            ) OR EXISTS (
              SELECT 1
                FROM public_projection_final_component_frontier frontier
               WHERE frontier.run_id=relation.run_id
                 AND frontier.seed_member_key=component.seed_member_key
                 AND frontier.member_key=relation.right_member_key
            ))
       )
       OR component.member_last_cursor<>(
         SELECT COALESCE(MAX(CAST(
           json_extract(member.payload_json,'$.memberKey') AS TEXT
         )), '')
           FROM public_projection_final_work_component_members member
          WHERE member.run_id=component.run_id
            AND member.seed_member_key=component.seed_member_key
       )
       OR component.member_last_cursor<>(
         SELECT COALESCE(MAX(frontier.member_key),'')
           FROM public_projection_final_component_frontier frontier
          WHERE frontier.run_id=component.run_id
            AND frontier.seed_member_key=component.seed_member_key
       )
       OR component.relation_last_cursor<>(
         SELECT COALESCE(MAX(relation.relation_id),'')
           FROM public_projection_final_work_component_relations relation
          WHERE relation.run_id=component.run_id
            AND relation.seed_member_key=component.seed_member_key
       )
       OR component.relation_last_cursor<>(
         SELECT COALESCE(MAX(relation.id),'')
           FROM public_projection_final_work_relations relation
          WHERE relation.run_id=component.run_id
            AND (EXISTS (
              SELECT 1
                FROM public_projection_final_component_frontier frontier
               WHERE frontier.run_id=relation.run_id
                 AND frontier.seed_member_key=component.seed_member_key
                 AND frontier.member_key=relation.left_member_key
            ) OR EXISTS (
              SELECT 1
                FROM public_projection_final_component_frontier frontier
               WHERE frontier.run_id=relation.run_id
                 AND frontier.seed_member_key=component.seed_member_key
                 AND frontier.member_key=relation.right_member_key
            ))
       )
       OR component.root_last_cursor<>(
         SELECT COALESCE(MAX(CAST(
           json_extract(root.payload_json,'$.memberKey') AS TEXT
         )), '')
           FROM public_projection_final_work_component_roots root
          WHERE root.run_id=component.run_id
            AND root.seed_member_key=component.seed_member_key
       )
       OR component.update_last_cursor<>(
         SELECT COALESCE(MAX(input.member_key),'')
           FROM public_projection_final_work_position_updates update_row
           JOIN public_projection_final_work_resolution_inputs input
             ON input.run_id=update_row.run_id
            AND input.position_item_id=update_row.position_item_id
          WHERE update_row.run_id=component.run_id
            AND update_row.seed_member_key=component.seed_member_key
       )
     )
  ) OR NEW.resolved_position_count<>(
    SELECT COUNT(*)
      FROM public_projection_final_work_position_updates update_row
     WHERE update_row.run_id=NEW.run_id
  ) THEN RAISE(ABORT,'final duplicate normalized component is incomplete') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_allocation_components allocation
     WHERE allocation.run_id=NEW.run_id AND (
       allocation.member_count<>(
         SELECT COUNT(*) FROM public_projection_allocation_members member
          WHERE member.run_id=allocation.run_id
            AND member.allocation_id=allocation.id
       )
       OR allocation.relation_count<>(
         SELECT COUNT(*) FROM public_projection_allocation_relations relation
          WHERE relation.run_id=allocation.run_id
            AND relation.allocation_id=allocation.id
       )
       OR allocation.candidate_root_count<>(
         SELECT COUNT(*) FROM public_projection_allocation_roots root
          WHERE root.run_id=allocation.run_id
            AND root.allocation_id=allocation.id
       )
       OR allocation.losing_root_count<>(
         SELECT COUNT(*) FROM public_projection_allocation_roots root
          WHERE root.run_id=allocation.run_id
            AND root.allocation_id=allocation.id AND root.selected=0
       )
     )
  ) THEN RAISE(ABORT,'final duplicate component children changed') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_allocation_components allocation
     WHERE allocation.run_id=NEW.run_id AND (
       (allocation.winning_public_job_id IS NULL AND EXISTS (
         SELECT 1 FROM public_projection_allocation_roots root
          WHERE root.run_id=allocation.run_id
            AND root.allocation_id=allocation.id AND root.selected=1
       ))
       OR (allocation.winning_public_job_id IS NOT NULL AND (
         1<>(
           SELECT COUNT(*) FROM public_projection_allocation_roots root
            WHERE root.run_id=allocation.run_id
              AND root.allocation_id=allocation.id AND root.selected=1
         )
         OR NOT EXISTS (
           SELECT 1 FROM public_projection_allocation_roots root
            WHERE root.run_id=allocation.run_id
              AND root.allocation_id=allocation.id AND root.selected=1
              AND root.public_job_id=allocation.winning_public_job_id
         )
       ))
     )
  ) THEN RAISE(ABORT,'final duplicate selected root changed') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_projection_resolution_seals seal
     WHERE seal.run_id=NEW.run_id AND seal.state='resolved'
       AND NOT EXISTS (
         SELECT 1 FROM public_projection_position_items item
         JOIN public_projection_allocation_members member
           ON member.run_id=item.run_id AND member.position_item_id=item.id
         WHERE item.run_id=seal.run_id
           AND item.id=seal.position_item_id
           AND item.stage='content' AND item.status='queued'
       )
  ) THEN RAISE(ABORT,'resolved position did not reach content') END;
END;
CREATE TRIGGER trg_public_job_allocation_validate
BEFORE INSERT ON public_job_allocations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_projection_allocation_components allocation
     WHERE allocation.run_id=NEW.originating_run_id
       AND allocation.id=NEW.originating_allocation_id
       AND allocation.state='promotable'
       AND allocation.reason_code='new_public_entity'
       AND allocation.proposed_public_job_id=NEW.public_job_id
       AND allocation.founding_source_position_id=
         NEW.founding_source_position_id
       AND allocation.allocation_hash=NEW.allocation_hash
       AND allocation.allocation_algorithm_version=
         NEW.allocation_algorithm_version
  ) THEN RAISE(ABORT,'public job allocation evidence changed') END;
END;
CREATE TRIGGER trg_projection_operator_decision_immutable_update
BEFORE UPDATE ON public_projection_duplicate_operator_decisions
BEGIN SELECT RAISE(ABORT,'final duplicate decisions are immutable'); END;
CREATE TRIGGER trg_projection_operator_decision_immutable_delete
BEFORE DELETE ON public_projection_duplicate_operator_decisions
BEGIN SELECT RAISE(ABORT,'final duplicate decisions are append-only'); END;
CREATE TRIGGER trg_projection_final_relation_immutable_update
BEFORE UPDATE ON public_projection_final_duplicate_relations
BEGIN SELECT RAISE(ABORT,'final duplicate relations are immutable'); END;
CREATE TRIGGER trg_projection_final_relation_immutable_delete
BEFORE DELETE ON public_projection_final_duplicate_relations
BEGIN SELECT RAISE(ABORT,'final duplicate relations are append-only'); END;
CREATE TRIGGER trg_projection_allocation_component_immutable_update
BEFORE UPDATE ON public_projection_allocation_components
BEGIN SELECT RAISE(ABORT,'allocation components are immutable'); END;
CREATE TRIGGER trg_projection_allocation_component_immutable_delete
BEFORE DELETE ON public_projection_allocation_components
BEGIN SELECT RAISE(ABORT,'allocation components are append-only'); END;
CREATE TRIGGER trg_projection_allocation_member_immutable_update
BEFORE UPDATE ON public_projection_allocation_members
BEGIN SELECT RAISE(ABORT,'allocation members are immutable'); END;
CREATE TRIGGER trg_projection_allocation_member_immutable_delete
BEFORE DELETE ON public_projection_allocation_members
BEGIN SELECT RAISE(ABORT,'allocation members are append-only'); END;
CREATE TRIGGER trg_projection_allocation_root_immutable_update
BEFORE UPDATE ON public_projection_allocation_roots
BEGIN SELECT RAISE(ABORT,'allocation roots are immutable'); END;
CREATE TRIGGER trg_projection_allocation_root_immutable_delete
BEFORE DELETE ON public_projection_allocation_roots
BEGIN SELECT RAISE(ABORT,'allocation roots are append-only'); END;
CREATE TRIGGER trg_projection_allocation_relation_immutable_update
BEFORE UPDATE ON public_projection_allocation_relations
BEGIN SELECT RAISE(ABORT,'allocation relations are immutable'); END;
CREATE TRIGGER trg_projection_allocation_relation_immutable_delete
BEFORE DELETE ON public_projection_allocation_relations
BEGIN SELECT RAISE(ABORT,'allocation relations are append-only'); END;
CREATE TRIGGER trg_projection_final_seal_immutable_update
BEFORE UPDATE ON public_projection_final_duplicate_seals
BEGIN SELECT RAISE(ABORT,'final duplicate seals are immutable'); END;
CREATE TRIGGER trg_projection_final_seal_immutable_delete
BEFORE DELETE ON public_projection_final_duplicate_seals
BEGIN SELECT RAISE(ABORT,'final duplicate seals are append-only'); END;
CREATE TRIGGER trg_projection_final_canonical_live_input_immutable_update
BEFORE UPDATE ON public_projection_final_canonical_live_inputs
BEGIN SELECT RAISE(ABORT,'canonical live inputs are immutable'); END;
CREATE TRIGGER trg_projection_final_canonical_live_input_immutable_delete
BEFORE DELETE ON public_projection_final_canonical_live_inputs
BEGIN SELECT RAISE(ABORT,'canonical live inputs are append-only'); END;
CREATE TRIGGER trg_projection_final_source_mapping_input_immutable_update
BEFORE UPDATE ON public_projection_final_source_mapping_inputs
BEGIN SELECT RAISE(ABORT,'source mapping inputs are immutable'); END;
CREATE TRIGGER trg_projection_final_source_mapping_input_immutable_delete
BEFORE DELETE ON public_projection_final_source_mapping_inputs
BEGIN SELECT RAISE(ABORT,'source mapping inputs are append-only'); END;
CREATE TRIGGER trg_public_job_allocation_immutable_update
BEFORE UPDATE ON public_job_allocations
BEGIN SELECT RAISE(ABORT,'public job allocations are immutable'); END;
CREATE TRIGGER trg_public_job_allocation_immutable_delete
BEFORE DELETE ON public_job_allocations
BEGIN SELECT RAISE(ABORT,'public job allocations are append-only'); END;
CREATE TRIGGER trg_projection_final_work_resolution_input_immutable_update
BEFORE UPDATE ON public_projection_final_work_resolution_inputs
BEGIN SELECT RAISE(ABORT,'D3 resolution inputs are immutable'); END;
CREATE TRIGGER trg_projection_final_work_resolution_input_immutable_delete
BEFORE DELETE ON public_projection_final_work_resolution_inputs
BEGIN SELECT RAISE(ABORT,'D3 resolution inputs are append-only'); END;
CREATE TRIGGER trg_projection_final_work_mapping_input_immutable_update
BEFORE UPDATE ON public_projection_final_work_mapping_inputs
BEGIN SELECT RAISE(ABORT,'D3 mapping inputs are immutable'); END;
CREATE TRIGGER trg_projection_final_work_mapping_input_immutable_delete
BEFORE DELETE ON public_projection_final_work_mapping_inputs
BEGIN SELECT RAISE(ABORT,'D3 mapping inputs are append-only'); END;
CREATE TRIGGER trg_projection_final_work_canonical_request_validate_update
BEFORE UPDATE ON public_projection_final_work_canonical_requests
BEGIN
  SELECT CASE WHEN OLD.match_complete=1
    OR NEW.run_id<>OLD.run_id OR NEW.ordinal<>OLD.ordinal
    OR NEW.signal_hash<>OLD.signal_hash OR NEW.request_hash<>OLD.request_hash
    OR NEW.encoded_bytes<>OLD.encoded_bytes OR NEW.created_at<>OLD.created_at
    OR NEW.match_count<OLD.match_count OR NEW.match_digest IS NULL
    OR (NEW.match_count>0 AND NEW.match_cursor='')
  THEN RAISE(ABORT,'D3 canonical request update is invalid') END;
END;
CREATE TRIGGER trg_projection_final_work_canonical_request_immutable_delete
BEFORE DELETE ON public_projection_final_work_canonical_requests
BEGIN SELECT RAISE(ABORT,'D3 canonical requests are append-only'); END;
CREATE TRIGGER trg_projection_final_work_canonical_match_immutable_update
BEFORE UPDATE ON public_projection_final_work_canonical_matches
BEGIN SELECT RAISE(ABORT,'D3 canonical matches are immutable'); END;
CREATE TRIGGER trg_projection_final_work_canonical_match_immutable_delete
BEFORE DELETE ON public_projection_final_work_canonical_matches
BEGIN SELECT RAISE(ABORT,'D3 canonical matches are append-only'); END;
CREATE TRIGGER trg_projection_final_work_canonical_member_immutable_update
BEFORE UPDATE ON public_projection_final_work_canonical_members
BEGIN SELECT RAISE(ABORT,'D3 canonical members are immutable'); END;
CREATE TRIGGER trg_projection_final_work_canonical_member_immutable_delete
BEFORE DELETE ON public_projection_final_work_canonical_members
BEGIN SELECT RAISE(ABORT,'D3 canonical members are append-only'); END;
CREATE TRIGGER trg_projection_final_work_public_root_immutable_update
BEFORE UPDATE ON public_projection_final_work_public_roots
BEGIN SELECT RAISE(ABORT,'D3 public roots are immutable'); END;
CREATE TRIGGER trg_projection_final_work_public_root_immutable_delete
BEFORE DELETE ON public_projection_final_work_public_roots
BEGIN SELECT RAISE(ABORT,'D3 public roots are append-only'); END;
CREATE TRIGGER trg_projection_final_work_relation_immutable_update
BEFORE UPDATE ON public_projection_final_work_relations
BEGIN SELECT RAISE(ABORT,'D3 relation inputs are immutable'); END;
CREATE TRIGGER trg_projection_final_work_relation_immutable_delete
BEFORE DELETE ON public_projection_final_work_relations
BEGIN SELECT RAISE(ABORT,'D3 relation inputs are append-only'); END;
CREATE TRIGGER trg_projection_final_work_component_member_immutable_update
BEFORE UPDATE ON public_projection_final_work_component_members
BEGIN SELECT RAISE(ABORT,'D3 component members are immutable'); END;
CREATE TRIGGER trg_projection_final_work_component_member_immutable_delete
BEFORE DELETE ON public_projection_final_work_component_members
BEGIN SELECT RAISE(ABORT,'D3 component members are append-only'); END;
CREATE TRIGGER trg_projection_final_work_component_root_immutable_update
BEFORE UPDATE ON public_projection_final_work_component_roots
BEGIN SELECT RAISE(ABORT,'D3 component roots are immutable'); END;
CREATE TRIGGER trg_projection_final_work_component_root_immutable_delete
BEFORE DELETE ON public_projection_final_work_component_roots
BEGIN SELECT RAISE(ABORT,'D3 component roots are append-only'); END;
CREATE TRIGGER trg_projection_final_work_component_relation_immutable_update
BEFORE UPDATE ON public_projection_final_work_component_relations
BEGIN SELECT RAISE(ABORT,'D3 component relations are immutable'); END;
CREATE TRIGGER trg_projection_final_work_component_relation_immutable_delete
BEFORE DELETE ON public_projection_final_work_component_relations
BEGIN SELECT RAISE(ABORT,'D3 component relations are append-only'); END;
CREATE TRIGGER trg_projection_final_component_root_candidate_immutable_update
BEFORE UPDATE ON public_projection_final_component_root_candidates
BEGIN SELECT RAISE(ABORT,'D3 component root candidates are immutable'); END;
CREATE TRIGGER trg_projection_final_component_root_candidate_immutable_delete
BEFORE DELETE ON public_projection_final_component_root_candidates
BEGIN SELECT RAISE(ABORT,'D3 component root candidates are append-only'); END;
CREATE TRIGGER trg_projection_final_work_position_update_immutable_update
BEFORE UPDATE ON public_projection_final_work_position_updates
BEGIN SELECT RAISE(ABORT,'D3 position updates are immutable'); END;
CREATE TRIGGER trg_projection_final_work_position_update_immutable_delete
BEFORE DELETE ON public_projection_final_work_position_updates
BEGIN SELECT RAISE(ABORT,'D3 position updates are append-only'); END;
CREATE TRIGGER trg_projection_candidate_result_validate
BEFORE INSERT ON public_projection_candidate_results
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM public_projection_allocation_components allocation
      JOIN public_projection_final_duplicate_seals seal
        ON seal.run_id=allocation.run_id
     WHERE allocation.run_id=NEW.run_id
       AND allocation.id=NEW.allocation_id
       AND (
         (NEW.state='prepared'
           AND allocation.state='promotable'
           AND NEW.public_job_id=COALESCE(
             allocation.winning_public_job_id,
             allocation.proposed_public_job_id
           )
           AND NEW.source_position_id=
             allocation.founding_source_position_id)
         OR (NEW.state='blocked')
       )
  ) THEN RAISE(ABORT,'candidate result does not match sealed allocation') END;
END;
CREATE TRIGGER trg_projection_candidate_result_immutable_update
BEFORE UPDATE ON public_projection_candidate_results
BEGIN
  SELECT RAISE(ABORT,'public projection candidate results are immutable');
END;
CREATE TRIGGER trg_projection_candidate_result_immutable_delete
BEFORE DELETE ON public_projection_candidate_results
BEGIN
  SELECT RAISE(ABORT,'public projection candidate results are append-only');
END;
CREATE TRIGGER trg_projection_candidate_seal_validate
BEFORE INSERT ON public_projection_candidate_seals
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM public_projection_final_duplicate_seals final_seal
     WHERE final_seal.run_id=NEW.run_id
       AND final_seal.seal_hash=NEW.final_duplicate_seal_hash
       AND final_seal.allocation_count=NEW.result_count
       AND final_seal.promotable_count>=NEW.prepared_count
       AND final_seal.blocked_allocation_count<=NEW.blocked_count
       AND NEW.result_count=(
         SELECT COUNT(*) FROM public_projection_candidate_results result
          WHERE result.run_id=NEW.run_id
       )
       AND NEW.prepared_count=(
         SELECT COUNT(*) FROM public_projection_candidate_results result
          WHERE result.run_id=NEW.run_id AND result.state='prepared'
       )
       AND NEW.blocked_count=(
         SELECT COUNT(*) FROM public_projection_candidate_results result
          WHERE result.run_id=NEW.run_id AND result.state='blocked'
       )
  ) THEN RAISE(ABORT,'candidate seal does not match immutable results') END;
END;
CREATE TRIGGER trg_projection_candidate_seal_immutable_update
BEFORE UPDATE ON public_projection_candidate_seals
BEGIN
  SELECT RAISE(ABORT,'public projection candidate seals are immutable');
END;
CREATE TRIGGER trg_projection_candidate_seal_immutable_delete
BEFORE DELETE ON public_projection_candidate_seals
BEGIN
  SELECT RAISE(ABORT,'public projection candidate seals are append-only');
END;
CREATE TRIGGER trg_projection_promotion_manifest_validate
BEFORE INSERT ON public_projection_promotion_manifests
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
      FROM public_projection_candidate_results candidate
      JOIN public_projection_candidate_seals seal
        ON seal.run_id=candidate.run_id
     WHERE candidate.run_id=NEW.run_id
       AND candidate.allocation_id=NEW.allocation_id
       AND candidate.state='prepared'
       AND candidate.candidate_id=NEW.candidate_id
       AND candidate.candidate_hash=NEW.candidate_hash
       AND seal.result_digest=NEW.candidate_seal_digest
  ) THEN RAISE(ABORT,'promotion manifest lost its candidate seal') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users
     WHERE id=NEW.authorized_by_user_id AND role='operator'
  ) THEN RAISE(ABORT,'promotion requires an operator') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_job_catalog_head_pointer
     WHERE singleton=1
       AND current_version=NEW.activated_catalog_version
  ) THEN RAISE(ABORT,'promotion catalog activation is incomplete') END;
END;
CREATE TRIGGER trg_projection_promotion_manifest_immutable_update
BEFORE UPDATE ON public_projection_promotion_manifests
BEGIN
  SELECT RAISE(ABORT,'public projection promotion manifests are immutable');
END;
CREATE TRIGGER trg_projection_promotion_manifest_immutable_delete
BEFORE DELETE ON public_projection_promotion_manifests
BEGIN
  SELECT RAISE(ABORT,'public projection promotion manifests are append-only');
END;
CREATE TRIGGER trg_public_projection_listing_update_guard
BEFORE UPDATE ON public_projection_listing_items
BEGIN
  SELECT CASE WHEN
    OLD.status IN ('completed','superseded')
    AND (
      NEW.stage IS NOT OLD.stage
      OR NEW.status IS NOT OLD.status
      OR NEW.attempt_count IS NOT OLD.attempt_count
      OR NEW.lease_owner IS NOT OLD.lease_owner
      OR NEW.lease_token IS NOT OLD.lease_token
      OR NEW.lease_expires_at IS NOT OLD.lease_expires_at
      OR NEW.checkpoint_json IS NOT OLD.checkpoint_json
      OR NEW.error_code IS NOT OLD.error_code
      OR NEW.error_detail IS NOT OLD.error_detail
      OR NEW.started_at IS NOT OLD.started_at
      OR NEW.completed_at IS NOT OLD.completed_at
      OR NEW.updated_at IS NOT OLD.updated_at
    )
  THEN RAISE(ABORT,'terminal projection listing is immutable') END;

  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.run_id IS NOT OLD.run_id
    OR NEW.listing_id IS NOT OLD.listing_id
    OR NEW.material_version IS NOT OLD.material_version
    OR NEW.input_hash IS NOT OLD.input_hash
    OR NEW.max_attempts IS NOT OLD.max_attempts
    OR NEW.created_at IS NOT OLD.created_at
  THEN RAISE(ABORT,'projection listing input snapshot is immutable') END;

  SELECT CASE WHEN NEW.stage<>OLD.stage AND NOT (
    (OLD.stage='selected' AND NEW.stage='prerequisites')
    OR (OLD.stage='prerequisites' AND NEW.stage='source_positions')
    OR (OLD.stage='source_positions' AND NEW.stage='completed')
  ) THEN RAISE(ABORT,'invalid projection listing stage transition') END;

  SELECT CASE WHEN NEW.status<>OLD.status AND NOT (
    (OLD.status='queued' AND NEW.status IN ('processing','superseded'))
    OR (OLD.status='processing' AND NEW.status IN (
      'queued','waiting_analysis','blocked','completed','failed','superseded'
    ))
    OR (OLD.status='waiting_analysis' AND NEW.status IN (
      'queued','processing','blocked','failed','superseded'
    ))
    OR (OLD.status IN ('blocked','failed') AND NEW.status IN (
      'queued','superseded'
    ))
  ) THEN RAISE(ABORT,'invalid projection listing status transition') END;

  SELECT CASE WHEN
    OLD.status<>'processing'
    AND NEW.status='processing'
    AND NEW.attempt_count<>OLD.attempt_count+1
  THEN RAISE(ABORT,'projection listing claim must advance attempt') END;

  SELECT CASE WHEN NOT (
    (OLD.status<>'processing' AND NEW.status='processing')
    OR (
      OLD.status IN ('processing','waiting_analysis')
      AND NEW.status='queued'
      AND NEW.attempt_count=0
    )
    OR (
      OLD.status='queued'
      AND NEW.status='queued'
      AND OLD.attempt_count>=OLD.max_attempts
      AND NEW.attempt_count=0
    )
  ) AND NEW.attempt_count<>OLD.attempt_count
  THEN RAISE(ABORT,'projection listing attempt changes require a claim') END;

  SELECT CASE WHEN
    OLD.status='processing'
    AND NEW.status='processing'
    AND (
      NEW.lease_owner IS NOT OLD.lease_owner
      OR NEW.lease_token IS NOT OLD.lease_token
    )
  THEN RAISE(ABORT,'projection listing lease ownership is immutable') END;
end;
CREATE TRIGGER trg_public_projection_run_step_budget_guard
BEFORE UPDATE ON public_projection_runs
BEGIN
  SELECT RAISE(ABORT,'projection run step count cannot move backward')
   WHERE NEW.advance_step_count<OLD.advance_step_count;
  SELECT RAISE(ABORT,'terminal projection run is immutable')
   WHERE OLD.status IN ('completed','completed_with_blocks','failed','canceled')
     AND NEW.advance_step_count IS NOT OLD.advance_step_count;
END;
CREATE TRIGGER trg_public_job_catalog_version_ordinal_advance
BEFORE INSERT ON public_job_catalog_versions
BEGIN
  SELECT RAISE(ABORT,'public job catalog version ordinal must advance')
   WHERE NEW.ordinal IS NULL
      OR NEW.ordinal<>(
        SELECT COALESCE(MAX(existing.ordinal),0)+1
        FROM public_job_catalog_versions existing);
END;
CREATE TRIGGER trg_public_job_catalog_version_immutable_update
BEFORE UPDATE ON public_job_catalog_versions
BEGIN
  SELECT RAISE(ABORT,'public job catalog versions are immutable');
END;
CREATE TRIGGER trg_public_job_catalog_version_immutable_delete
BEFORE DELETE ON public_job_catalog_versions
BEGIN
  SELECT RAISE(ABORT,'public job catalog versions are immutable');
END;
CREATE TRIGGER trg_public_job_catalog_member_insert_before_head
BEFORE INSERT ON public_job_catalog_members
BEGIN
  SELECT RAISE(ABORT,'public job catalog members must precede activation')
   WHERE EXISTS (
    SELECT 1 FROM public_job_catalog_head_history history
    JOIN public_job_catalog_versions version
      ON version.version=history.catalog_version
    WHERE version.ordinal=NEW.valid_from_ordinal);
  SELECT RAISE(ABORT,'public job catalog member spans must open unbounded')
   WHERE NEW.valid_to_ordinal IS NOT NULL;
  SELECT RAISE(ABORT,'public job catalog member spans cannot overlap')
   WHERE EXISTS (
    SELECT 1 FROM public_job_catalog_members existing
    WHERE existing.public_job_id=NEW.public_job_id
      AND (existing.valid_to_ordinal IS NULL
        OR existing.valid_to_ordinal>NEW.valid_from_ordinal));
END;
CREATE TRIGGER trg_public_job_catalog_member_immutable_update
BEFORE UPDATE ON public_job_catalog_members
BEGIN
  SELECT RAISE(ABORT,'public job catalog members permit only span closure')
   WHERE NEW.public_job_id IS NOT OLD.public_job_id
      OR NEW.valid_from_ordinal IS NOT OLD.valid_from_ordinal
      OR NEW.public_job_version IS NOT OLD.public_job_version
      OR NEW.eligibility_decision_version
         IS NOT OLD.eligibility_decision_version
      OR NEW.item_json IS NOT OLD.item_json
      OR NEW.detail_json IS NOT OLD.detail_json
      OR NEW.public_content_hash IS NOT OLD.public_content_hash
      OR NEW.eligibility_decision_hash IS NOT OLD.eligibility_decision_hash
      OR NEW.location_facets_json IS NOT OLD.location_facets_json
      OR NEW.representation_updated_at IS NOT OLD.representation_updated_at
      OR NEW.created_at IS NOT OLD.created_at
      OR OLD.valid_to_ordinal IS NOT NULL
      OR NEW.valid_to_ordinal IS NULL
      OR NEW.valid_to_ordinal<=OLD.valid_from_ordinal;
  SELECT RAISE(ABORT,'public job catalog member closure needs a known version')
   WHERE NOT EXISTS (
    SELECT 1 FROM public_job_catalog_versions version
    WHERE version.ordinal=NEW.valid_to_ordinal);
  SELECT RAISE(ABORT,'public job catalog member closure must follow the head')
   WHERE NEW.valid_to_ordinal<=(
    SELECT version.ordinal
    FROM public_job_catalog_head_pointer pointer
    JOIN public_job_catalog_versions version
      ON version.version=pointer.current_version
    WHERE pointer.singleton=1);
END;
CREATE TRIGGER trg_public_job_catalog_member_immutable_delete
BEFORE DELETE ON public_job_catalog_members
BEGIN
  SELECT RAISE(ABORT,'public job catalog members are immutable');
END;
CREATE TRIGGER trg_public_job_search_insert_before_activation
BEFORE INSERT ON public_job_search_index
BEGIN
  SELECT RAISE(ABORT,'public job search rows must precede activation')
   WHERE EXISTS (
    SELECT 1 FROM public_job_catalog_head_history history
    JOIN public_job_catalog_versions version
      ON version.version=history.catalog_version
    WHERE version.ordinal=NEW.valid_from_ordinal);
END;
CREATE TRIGGER trg_public_job_search_immutable_update
BEFORE UPDATE ON public_job_search_index
BEGIN
  SELECT RAISE(ABORT,'public job search rows are immutable');
END;
CREATE TRIGGER trg_public_job_search_immutable_delete
BEFORE DELETE ON public_job_search_index
BEGIN
  SELECT RAISE(ABORT,'public job search rows are immutable');
END;
CREATE TRIGGER trg_public_job_search_term_insert_before_activation
BEFORE INSERT ON public_job_search_terms
BEGIN
  SELECT RAISE(ABORT,'public job search terms must precede activation')
   WHERE EXISTS (
    SELECT 1 FROM public_job_catalog_head_history history
    JOIN public_job_catalog_versions version
      ON version.version=history.catalog_version
    WHERE version.ordinal=NEW.valid_from_ordinal);
END;
CREATE TRIGGER trg_public_job_search_term_immutable_update
BEFORE UPDATE ON public_job_search_terms
BEGIN
  SELECT RAISE(ABORT,'public job search terms are immutable');
END;
CREATE TRIGGER trg_public_job_search_term_immutable_delete
BEFORE DELETE ON public_job_search_terms
BEGIN
  SELECT RAISE(ABORT,'public job search terms are immutable');
END;
CREATE TRIGGER trg_public_browse_location_insert_before_activation
BEFORE INSERT ON public_browse_job_locations
BEGIN
  SELECT RAISE(ABORT,'public browse location facets must precede activation')
   WHERE EXISTS (
    SELECT 1 FROM public_job_catalog_head_history history
    JOIN public_job_catalog_versions version
      ON version.version=history.catalog_version
    WHERE version.ordinal=NEW.valid_from_ordinal);
END;
CREATE TRIGGER trg_public_browse_location_immutable_update
BEFORE UPDATE ON public_browse_job_locations
BEGIN
  SELECT RAISE(ABORT,'public browse location facets are immutable');
END;
CREATE TRIGGER trg_public_browse_location_immutable_delete
BEFORE DELETE ON public_browse_job_locations
BEGIN
  SELECT RAISE(ABORT,'public browse location facets are immutable');
END;
CREATE TRIGGER trg_public_job_catalog_head_advance
BEFORE UPDATE ON public_job_catalog_head_pointer
BEGIN
  SELECT RAISE(ABORT,'public job catalog head identity is immutable')
   WHERE NEW.singleton<>OLD.singleton;
  SELECT RAISE(ABORT,'public job catalog head successor is invalid')
   WHERE NOT EXISTS (
    SELECT 1
    FROM public_job_catalog_versions successor
    JOIN public_job_catalog_versions predecessor
      ON predecessor.version=OLD.current_version
    WHERE successor.version=NEW.current_version
      AND successor.predecessor_version=OLD.current_version
      AND successor.ordinal>predecessor.ordinal);
  SELECT RAISE(ABORT,'public job catalog version was already activated')
   WHERE EXISTS (
    SELECT 1 FROM public_job_catalog_head_history history
    WHERE history.catalog_version=NEW.current_version);
  SELECT RAISE(ABORT,'public job catalog seal does not match version')
   WHERE NOT EXISTS (
    SELECT 1
    FROM public_job_catalog_versions version
    JOIN public_job_catalog_seals seal
      ON seal.catalog_version=version.version
     AND seal.membership_hash=version.membership_hash
     AND seal.member_count=version.member_count
     AND seal.search_document_count=version.search_document_count
     AND seal.search_content_hash=version.search_content_hash
     AND seal.search_term_count=version.search_term_count
     AND seal.location_facet_count=version.location_facet_count
    WHERE version.version=NEW.current_version
      AND (
        (seal.member_count=0 AND seal.membership_hash=
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
        OR (seal.member_count>0 AND seal.membership_hash<>
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
      ));
  SELECT RAISE(ABORT,'public job catalog member count does not match seal')
   WHERE (
    SELECT COUNT(*)
    FROM public_job_catalog_versions target
    JOIN public_job_catalog_members member
      ON member.valid_from_ordinal<=target.ordinal
     AND (member.valid_to_ordinal IS NULL
       OR member.valid_to_ordinal>target.ordinal)
    WHERE target.version=NEW.current_version
   )<>(
    SELECT seal.member_count FROM public_job_catalog_seals seal
    WHERE seal.catalog_version=NEW.current_version
   );
  SELECT RAISE(ABORT,'public job catalog payload identity is invalid')
   WHERE EXISTS (
    SELECT 1
    FROM public_job_catalog_versions target
    JOIN public_job_catalog_members member
      ON member.valid_from_ordinal<=target.ordinal
     AND (member.valid_to_ordinal IS NULL
       OR member.valid_to_ordinal>target.ordinal)
    LEFT JOIN public_browse_job_candidates candidate
      ON candidate.public_job_id=member.public_job_id
     AND candidate.public_job_version=member.public_job_version
     AND candidate.eligibility_decision_version=
         member.eligibility_decision_version
     AND candidate.public_content_hash=member.public_content_hash
     AND candidate.eligibility_decision_hash=member.eligibility_decision_hash
     AND candidate.representation_updated_at=member.representation_updated_at
     AND candidate.item_json=member.item_json
     AND candidate.detail_json=member.detail_json
    WHERE target.version=NEW.current_version
      AND candidate.public_job_id IS NULL);
  SELECT RAISE(ABORT,'public job search count does not match seal')
   WHERE (
    SELECT COUNT(*)
    FROM public_job_catalog_versions target
    JOIN public_job_catalog_members member
      ON member.valid_from_ordinal<=target.ordinal
     AND (member.valid_to_ordinal IS NULL
       OR member.valid_to_ordinal>target.ordinal)
    JOIN public_job_search_index search
      ON search.public_job_id=member.public_job_id
     AND search.valid_from_ordinal=member.valid_from_ordinal
    WHERE target.version=NEW.current_version
   )<>(
    SELECT seal.search_document_count FROM public_job_catalog_seals seal
    WHERE seal.catalog_version=NEW.current_version
   );
  SELECT RAISE(ABORT,'public job search term count does not match seal')
   WHERE (
    SELECT COUNT(*)
    FROM public_job_catalog_versions target
    JOIN public_job_catalog_members member
      ON member.valid_from_ordinal<=target.ordinal
     AND (member.valid_to_ordinal IS NULL
       OR member.valid_to_ordinal>target.ordinal)
    JOIN public_job_search_terms term
      ON term.public_job_id=member.public_job_id
     AND term.valid_from_ordinal=member.valid_from_ordinal
    WHERE target.version=NEW.current_version
   )<>(
    SELECT seal.search_term_count FROM public_job_catalog_seals seal
    WHERE seal.catalog_version=NEW.current_version
   );
  SELECT RAISE(ABORT,'public job catalog member has no search document')
   WHERE EXISTS (
    SELECT 1
    FROM public_job_catalog_versions target
    JOIN public_job_catalog_members member
      ON member.valid_from_ordinal<=target.ordinal
     AND (member.valid_to_ordinal IS NULL
       OR member.valid_to_ordinal>target.ordinal)
    LEFT JOIN public_job_search_index search
      ON search.public_job_id=member.public_job_id
     AND search.valid_from_ordinal=member.valid_from_ordinal
     AND search.public_job_version=member.public_job_version
    WHERE target.version=NEW.current_version
      AND search.public_job_id IS NULL);
  SELECT RAISE(ABORT,'public job search terms do not match search row')
   WHERE EXISTS (
    SELECT 1
    FROM public_job_catalog_versions target
    JOIN public_job_catalog_members member
      ON member.valid_from_ordinal<=target.ordinal
     AND (member.valid_to_ordinal IS NULL
       OR member.valid_to_ordinal>target.ordinal)
    JOIN public_job_search_index search
      ON search.public_job_id=member.public_job_id
     AND search.valid_from_ordinal=member.valid_from_ordinal
    JOIN json_each(search.search_terms_json) expected
    LEFT JOIN public_job_search_terms term
      ON term.public_job_id=search.public_job_id
     AND term.valid_from_ordinal=search.valid_from_ordinal
     AND term.public_job_version=search.public_job_version
     AND term.term=json_extract(expected.value,'$.term')
     AND term.score=json_extract(expected.value,'$.score')
    WHERE target.version=NEW.current_version
    GROUP BY search.public_job_id,search.valid_from_ordinal
    HAVING COUNT(expected.key)<>COUNT(term.term)
       OR COUNT(expected.key)<>(
         SELECT COUNT(*) FROM public_job_search_terms all_terms
         WHERE all_terms.public_job_id=search.public_job_id
           AND all_terms.valid_from_ordinal=search.valid_from_ordinal
       ));
  SELECT RAISE(ABORT,'public job location facet count does not match seal')
   WHERE (
    SELECT COUNT(*)
    FROM public_job_catalog_versions target
    JOIN public_job_catalog_members member
      ON member.valid_from_ordinal<=target.ordinal
     AND (member.valid_to_ordinal IS NULL
       OR member.valid_to_ordinal>target.ordinal)
    JOIN public_browse_job_locations facet
      ON facet.public_job_id=member.public_job_id
     AND facet.valid_from_ordinal=member.valid_from_ordinal
    WHERE target.version=NEW.current_version
   )<>(
    SELECT seal.location_facet_count FROM public_job_catalog_seals seal
    WHERE seal.catalog_version=NEW.current_version
   );
  SELECT RAISE(ABORT,'public job location payload count does not match seal')
   WHERE (
    SELECT COALESCE(SUM(json_array_length(member.item_json,'$.locations')),0)
    FROM public_job_catalog_versions target
    JOIN public_job_catalog_members member
      ON member.valid_from_ordinal<=target.ordinal
     AND (member.valid_to_ordinal IS NULL
       OR member.valid_to_ordinal>target.ordinal)
    WHERE target.version=NEW.current_version
   )<>(
    SELECT seal.location_facet_count FROM public_job_catalog_seals seal
    WHERE seal.catalog_version=NEW.current_version
   );
  SELECT RAISE(ABORT,'public job location routing count does not match payload')
   WHERE EXISTS (
    SELECT 1
    FROM public_job_catalog_versions target
    JOIN public_job_catalog_members member
      ON member.valid_from_ordinal<=target.ordinal
     AND (member.valid_to_ordinal IS NULL
       OR member.valid_to_ordinal>target.ordinal)
    WHERE target.version=NEW.current_version
      AND json_array_length(member.location_facets_json)<>
          json_array_length(member.item_json,'$.locations'));
  SELECT RAISE(ABORT,'public job location facets do not match payload')
   WHERE EXISTS (
    SELECT 1
    FROM public_job_catalog_versions target
    JOIN public_job_catalog_members member
      ON member.valid_from_ordinal<=target.ordinal
     AND (member.valid_to_ordinal IS NULL
       OR member.valid_to_ordinal>target.ordinal)
    JOIN public_browse_job_locations facet
      ON facet.public_job_id=member.public_job_id
     AND facet.valid_from_ordinal=member.valid_from_ordinal
    LEFT JOIN json_each(member.item_json,'$.locations') location
      ON CAST(location.key AS INTEGER)=facet.ordinal
     AND json_extract(location.value,'$.countryCode')=facet.country_code
     AND json_extract(location.value,'$.displayName')=facet.display_name
     AND (
       (json_extract(location.value,'$.role')='applicantArea'
         AND facet.location_role='applicant_area')
       OR (json_extract(location.value,'$.role')<>'applicantArea'
         AND facet.location_role='worksite')
     )
    LEFT JOIN json_each(member.location_facets_json) routing
      ON CAST(routing.key AS INTEGER)=facet.ordinal
     AND json_extract(routing.value,'$.countryCode')=facet.country_code
     AND json_extract(routing.value,'$.countrySlug')=facet.country_slug
     AND json_extract(routing.value,'$.citySlug') IS facet.city_slug
     AND json_extract(routing.value,'$.displayName')=facet.display_name
     AND json_extract(routing.value,'$.role')=facet.location_role
    LEFT JOIN public_job_version_locations snapshot
      ON snapshot.public_job_id=facet.public_job_id
     AND snapshot.public_job_version=facet.public_job_version
     AND snapshot.ordinal=facet.ordinal
     AND snapshot.resolution_state='resolved'
     AND snapshot.country_code=facet.country_code
     AND snapshot.display_name=facet.display_name
     AND snapshot.location_role=facet.location_role
     AND json_extract(snapshot.location_json,'$.routing.countrySlug')=
         facet.country_slug
     AND json_extract(snapshot.location_json,'$.routing.citySlug') IS
         facet.city_slug
    WHERE target.version=NEW.current_version
      AND (
        location.key IS NULL OR routing.key IS NULL
        OR snapshot.public_job_id IS NULL
      ));
END;
CREATE TRIGGER trg_policy_head_invalidate_public_catalog
AFTER UPDATE OF current_version ON source_publication_policy_heads
BEGIN
  INSERT INTO public_job_catalog_versions (
    version,predecessor_version,membership_hash,member_count,
    search_document_count,search_content_hash,search_term_count,
    location_facet_count,representation_updated_at,
    material_changed_at,search_index_version,created_at,ordinal
  )
  SELECT
    'policy-invalidation:' || NEW.source_key || ':' || NEW.current_version,
    head.current_version,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    0,0,
    '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    0,0,
    NEW.updated_at,NEW.updated_at,
    'policy-invalidation:' || NEW.source_key || ':' || NEW.current_version,
    NEW.updated_at,
    (SELECT COALESCE(MAX(version.ordinal),0)+1
     FROM public_job_catalog_versions version)
  FROM public_job_catalog_head_pointer head
  WHERE head.singleton=1;

  UPDATE public_job_catalog_members
     SET valid_to_ordinal=(
       SELECT version.ordinal FROM public_job_catalog_versions version
       WHERE version.version=
         'policy-invalidation:' || NEW.source_key || ':' || NEW.current_version
     )
   WHERE valid_to_ordinal IS NULL;

  INSERT INTO public_job_catalog_seals (
    catalog_version,membership_hash,member_count,search_document_count,
    search_content_hash,search_term_count,location_facet_count,sealed_at
  ) VALUES (
    'policy-invalidation:' || NEW.source_key || ':' || NEW.current_version,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    0,0,
    '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    0,0,NEW.updated_at
  );

  UPDATE public_job_catalog_head_pointer
     SET current_version=(
           SELECT 'policy-invalidation:' || NEW.source_key || ':' || NEW.current_version
         ),
         updated_at=NEW.updated_at
   WHERE singleton=1;
END;
CREATE TRIGGER trg_source_label_head_invalidate_public_catalog
AFTER UPDATE OF current_version ON public_source_display_label_heads
BEGIN
  INSERT INTO public_job_catalog_versions (
    version,predecessor_version,membership_hash,member_count,
    search_document_count,search_content_hash,search_term_count,
    location_facet_count,representation_updated_at,
    material_changed_at,search_index_version,created_at,ordinal
  )
  SELECT
    'label-invalidation:' || NEW.source_key || ':' || NEW.current_version,
    head.current_version,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    0,0,
    '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    0,0,
    NEW.updated_at,NEW.updated_at,
    'label-invalidation:' || NEW.source_key || ':' || NEW.current_version,
    NEW.updated_at,
    (SELECT COALESCE(MAX(version.ordinal),0)+1
     FROM public_job_catalog_versions version)
  FROM public_job_catalog_head_pointer head
  WHERE head.singleton=1;

  UPDATE public_job_catalog_members
     SET valid_to_ordinal=(
       SELECT version.ordinal FROM public_job_catalog_versions version
       WHERE version.version=
         'label-invalidation:' || NEW.source_key || ':' || NEW.current_version
     )
   WHERE valid_to_ordinal IS NULL;

  INSERT INTO public_job_catalog_seals (
    catalog_version,membership_hash,member_count,search_document_count,
    search_content_hash,search_term_count,location_facet_count,sealed_at
  ) VALUES (
    'label-invalidation:' || NEW.source_key || ':' || NEW.current_version,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    0,0,
    '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    0,0,NEW.updated_at
  );

  UPDATE public_job_catalog_head_pointer
     SET current_version=(
           SELECT 'label-invalidation:' || NEW.source_key || ':' || NEW.current_version
         ),
         updated_at=NEW.updated_at
   WHERE singleton=1;
END;
CREATE TRIGGER trg_public_catalog_google_indexing_events
AFTER UPDATE OF current_version ON public_job_catalog_head_pointer
WHEN NEW.current_version<>OLD.current_version
BEGIN
  INSERT INTO google_indexing_events (
    id,public_job_id,public_job_version,canonical_path,event_type,
    catalog_version,public_content_hash,next_attempt_at,created_at,updated_at
  )
  SELECT
    'gidx:' || NEW.current_version || ':' || current.public_job_id ||
      ':updated',
    current.public_job_id,current.public_job_version,
    json_extract(current.item_json,'$.canonicalPath'),'URL_UPDATED',
    NEW.current_version,current.public_content_hash,NEW.updated_at,
    NEW.updated_at,NEW.updated_at
  FROM public_job_catalog_versions target
  JOIN public_job_catalog_members current
    ON current.valid_from_ordinal=target.ordinal
  JOIN public_job_eligibility_decisions decision
    ON decision.public_job_id=current.public_job_id
   AND decision.decision_version=current.eligibility_decision_version
  JOIN public_job_versions version
    ON version.public_job_id=current.public_job_id
   AND version.version=current.public_job_version
  JOIN public_job_catalog_versions old_version
    ON old_version.version=OLD.current_version
  LEFT JOIN public_job_catalog_members previous
    ON previous.public_job_id=current.public_job_id
   AND previous.valid_from_ordinal<=old_version.ordinal
   AND (previous.valid_to_ordinal IS NULL
     OR previous.valid_to_ordinal>old_version.ordinal)
  WHERE target.version=NEW.current_version
    AND decision.job_posting_eligible=1
    AND version.date_posted IS NOT NULL
    AND version.date_posted_provenance IN (
      'employer-original','board-published'
    )
    AND (
      previous.public_job_id IS NULL
      OR previous.public_content_hash<>current.public_content_hash
      OR previous.public_job_version<>current.public_job_version
    );

  INSERT INTO google_indexing_events (
    id,public_job_id,public_job_version,canonical_path,event_type,
    catalog_version,public_content_hash,next_attempt_at,created_at,updated_at
  )
  SELECT
    'gidx:' || NEW.current_version || ':' || previous.public_job_id ||
      ':deleted',
    previous.public_job_id,previous.public_job_version,
    json_extract(previous.item_json,'$.canonicalPath'),'URL_DELETED',
    NEW.current_version,previous.public_content_hash,NEW.updated_at,
    NEW.updated_at,NEW.updated_at
  FROM public_job_catalog_versions target
  JOIN public_job_catalog_members previous
    ON previous.valid_to_ordinal=target.ordinal
  JOIN public_job_eligibility_decisions decision
    ON decision.public_job_id=previous.public_job_id
   AND decision.decision_version=previous.eligibility_decision_version
  JOIN public_job_versions version
    ON version.public_job_id=previous.public_job_id
   AND version.version=previous.public_job_version
  LEFT JOIN public_job_catalog_members current
    ON current.public_job_id=previous.public_job_id
   AND current.valid_from_ordinal=target.ordinal
  WHERE target.version=NEW.current_version
    AND decision.job_posting_eligible=1
    AND version.date_posted IS NOT NULL
    AND version.date_posted_provenance IN (
      'employer-original','board-published'
    )
    AND current.public_job_id IS NULL;
END;
CREATE VIEW public_job_catalog_head AS
SELECT
  version.version,
  version.membership_hash,
  version.member_count,
  version.representation_updated_at,
  version.material_changed_at,
  version.search_index_version
FROM public_job_catalog_head_pointer head
JOIN public_job_catalog_versions version
  ON version.version=head.current_version
WHERE head.singleton=1
/* public_job_catalog_head(version,membership_hash,member_count,representation_updated_at,material_changed_at,search_index_version) */;
CREATE VIEW public_job_effective_policy_fields AS
WITH source_fields AS (
  SELECT
    source.public_job_id,
    source.decision_version,
    source.source_position_id,
    source.source_mapping_version,
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM json_each(source.fields_used_json) used
      WHERE NOT EXISTS (
        SELECT 1 FROM json_each(policy.allowed_fields_json) allowed
        WHERE allowed.value=used.value
      )
    ) THEN 1 ELSE 0 END AS policy_fields_valid,
    MAX(CASE WHEN used.value='title' THEN 1 ELSE 0 END) AS has_title,
    MAX(CASE WHEN used.value='organization_name' THEN 1 ELSE 0 END)
      AS has_organization_name,
    MAX(CASE WHEN used.value='locations' THEN 1 ELSE 0 END) AS has_locations,
    MAX(CASE WHEN used.value='description' THEN 1 ELSE 0 END)
      AS has_description,
    MAX(CASE WHEN used.value='date_posted' THEN 1 ELSE 0 END)
      AS has_date_posted,
    MAX(CASE WHEN used.value='valid_through' THEN 1 ELSE 0 END)
      AS has_valid_through,
    MAX(CASE WHEN used.value='employment_types' THEN 1 ELSE 0 END)
      AS has_employment_types,
    MAX(CASE WHEN used.value='compensation' THEN 1 ELSE 0 END)
      AS has_compensation
  FROM public_job_decision_sources source
  JOIN source_publication_policy_heads policy_head
    ON policy_head.source_key=source.source_key
   AND policy_head.current_version=source.policy_version
  JOIN source_publication_policy_versions policy
    ON policy.source_key=policy_head.source_key
   AND policy.version=policy_head.current_version
  JOIN source_publication_policy_label_versions policy_label
    ON policy_label.source_key=source.source_key
   AND policy_label.policy_version=source.policy_version
  JOIN public_source_display_label_heads label_head
    ON label_head.source_key=policy_label.source_key
   AND label_head.current_version=policy_label.label_version
  JOIN json_each(source.fields_used_json) used
  WHERE source.contribution_kind='public_content'
    AND policy.approval_state='approved'
    AND policy.publication_enabled=1
    AND policy.publication_scope<>'blocked'
  GROUP BY source.public_job_id,source.decision_version,
           source.source_position_id,source.source_mapping_version
)
SELECT
  public_job_id,
  decision_version,
  MIN(policy_fields_valid) AS policy_fields_valid,
  MAX(has_title) AS has_title,
  MAX(has_organization_name) AS has_organization_name,
  MAX(has_locations) AS has_locations,
  MAX(has_description) AS has_description,
  MAX(has_date_posted) AS has_date_posted,
  MAX(has_valid_through) AS has_valid_through,
  MAX(has_employment_types) AS has_employment_types,
  MAX(has_compensation) AS has_compensation
FROM source_fields
GROUP BY public_job_id,decision_version
/* public_job_effective_policy_fields(public_job_id,decision_version,policy_fields_valid,has_title,has_organization_name,has_locations,has_description,has_date_posted,has_valid_through,has_employment_types,has_compensation) */;
CREATE VIEW public_job_route_content AS
SELECT
  job.id AS public_job_id,
  content.version AS public_job_version,
  decision.decision_version AS eligibility_decision_version,
  content.canonical_slug,
  content.title,
  content.organization_name,
  content.workplace_type,
  CASE WHEN fields.has_date_posted=1
    THEN content.date_posted ELSE NULL END AS date_posted,
  CASE WHEN fields.has_date_posted=1
    THEN content.date_posted_provenance ELSE 'unknown'
  END AS date_posted_provenance,
  CASE WHEN fields.has_valid_through=1
    THEN content.valid_through ELSE NULL END AS valid_through,
  CASE WHEN fields.has_valid_through=1
    THEN content.valid_through_provenance ELSE 'unknown'
  END AS valid_through_provenance,
  CASE WHEN fields.has_employment_types=1
    THEN content.employment_types_json ELSE '[]'
  END AS employment_types_json,
  CASE WHEN fields.has_compensation=1
    THEN content.compensation_json ELSE NULL
  END AS compensation_json,
  content.description_html,
  content.public_content_hash,
  decision.decision_hash AS eligibility_decision_hash,
  content.material_changed_at,
  CASE WHEN content.created_at>decision.decided_at
    THEN content.created_at ELSE decision.decided_at
  END AS representation_updated_at,
  decision.publication_state,
  decision.route_disposition,
  decision.browse_eligible,
  decision.organic_index_eligible,
  decision.job_posting_eligible,
  decision.verified_at,
  CASE WHEN decision.publication_state='published' THEN 1 ELSE 0 END
    AS application_available,
  COALESCE((
    SELECT json_group_array(json(location_row.location_value))
    FROM (
      SELECT json_object(
        'role',CASE location.location_role
          WHEN 'applicant_area' THEN 'applicantArea' ELSE 'worksite' END,
        'scope',json_extract(location.location_json,'$.scope'),
        'displayName',location.display_name,
        'countryCode',location.country_code,
        'region',NULLIF(location.region,''),
        'locality',NULLIF(location.locality,''),
        'postalCode',NULLIF(location.postal_code,''),
        'coordinates',json(json_extract(
          location.location_json,'$.coordinates'
        )),
        'coordinateKind',json_extract(
          location.location_json,'$.coordinateKind'
        ),
        'bounds',CASE WHEN json_extract(location.location_json,'$.bounds') IS NULL
          THEN NULL ELSE json(json_extract(location.location_json,'$.bounds')) END
      ) AS location_value
      FROM public_job_version_locations location
      WHERE location.public_job_id=content.public_job_id
        AND location.public_job_version=content.version
        AND location.resolution_state='resolved'
      ORDER BY location.ordinal
    ) location_row
  ),'[]') AS locations_json,
  COALESCE((
    SELECT json_group_array(json(attribution.attribution_value))
    FROM (
      SELECT DISTINCT json_object(
        'name',CASE
          WHEN policy.attribution_mode IN ('source_name','source_link')
           AND EXISTS (
             SELECT 1 FROM json_each(source.fields_used_json)
             WHERE value='source_name'
           )
           AND EXISTS (
             SELECT 1 FROM json_each(policy.allowed_fields_json)
             WHERE value='source_name'
           )
          THEN label.display_label ELSE NULL END,
        'url',CASE
          WHEN policy.attribution_mode='source_link'
           AND EXISTS (
             SELECT 1 FROM json_each(source.fields_used_json)
             WHERE value='source_url'
           )
           AND EXISTS (
             SELECT 1 FROM json_each(policy.allowed_fields_json)
             WHERE value='source_url'
           )
           AND length(policy.source_origin_url)>9
           AND substr(policy.source_origin_url,1,8)='https://'
           AND substr(policy.source_origin_url,-1)='/'
           AND instr(policy.source_origin_url,'@')=0
           AND instr(policy.source_origin_url,'?')=0
           AND instr(policy.source_origin_url,'#')=0
           AND instr(substr(policy.source_origin_url,9),'/')=
               length(substr(policy.source_origin_url,9))
           AND json_type(material.material_json,'$.sourceUrl')='text'
           AND substr(
                 json_extract(material.material_json,'$.sourceUrl'),
                 1,length(policy.source_origin_url)
               )=
               policy.source_origin_url
          THEN json_extract(material.material_json,'$.sourceUrl') ELSE NULL END
      ) AS attribution_value
      FROM public_job_decision_sources source
      JOIN source_publication_policy_versions policy
        ON policy.source_key=source.source_key
       AND policy.version=source.policy_version
      JOIN source_publication_policy_label_versions policy_label
        ON policy_label.source_key=source.source_key
       AND policy_label.policy_version=source.policy_version
      JOIN job_source_position_mapping_versions mapping
        ON mapping.source_position_id=source.source_position_id
       AND mapping.version=source.source_mapping_version
      JOIN job_listing_versions material
        ON material.listing_id=mapping.listing_id
       AND material.material_version=mapping.listing_material_version
      JOIN public_source_display_label_versions label
        ON label.source_key=policy_label.source_key
       AND label.version=policy_label.label_version
      WHERE source.public_job_id=decision.public_job_id
        AND source.decision_version=decision.decision_version
        AND source.contribution_kind='public_content'
        AND policy.attribution_mode<>'none'
      ORDER BY attribution_value
    ) attribution
    WHERE json_extract(attribution.attribution_value,'$.name') IS NOT NULL
       OR json_extract(attribution.attribution_value,'$.url') IS NOT NULL
  ),'[]') AS source_attributions_json
FROM public_jobs job
JOIN public_job_heads content_head ON content_head.public_job_id=job.id
JOIN public_job_versions content
  ON content.public_job_id=content_head.public_job_id
 AND content.version=content_head.current_version
JOIN public_job_eligibility_heads decision_head
  ON decision_head.public_job_id=job.id
JOIN public_job_eligibility_decisions decision
  ON decision.public_job_id=decision_head.public_job_id
 AND decision.decision_version=decision_head.current_decision_version
JOIN public_job_effective_policy_fields fields
  ON fields.public_job_id=decision.public_job_id
 AND fields.decision_version=decision.decision_version
WHERE decision.public_job_version=content.version
  AND decision.publication_state IN ('published','closed')
  AND decision.content_review_state='approved'
  AND decision.privacy_state='passed'
  AND decision.verified_at IS NOT NULL
  AND fields.has_title=1
  AND fields.has_organization_name=1
  AND fields.has_locations=1
  AND fields.has_description=1
  AND fields.policy_fields_valid=1
  AND trim(content.title)<>''
  AND content.organization_id IS NOT NULL
  AND content.organization_resolution_state='resolved'
  AND trim(content.organization_name)<>''
  AND content.workplace_type IN ('onsite','hybrid','remote')
  AND trim(content.description_html)<>''
  AND trim(content.public_content_hash)<>''
  AND trim(content.material_changed_at)<>''
  AND (
    EXISTS (
      SELECT 1 FROM public_job_version_locations location
      WHERE location.public_job_id=content.public_job_id
        AND location.public_job_version=content.version
        AND location.location_role='worksite'
        AND location.resolution_state='resolved'
    )
    OR (
      content.workplace_type='remote'
      AND EXISTS (
        SELECT 1 FROM public_job_version_locations location
        WHERE location.public_job_id=content.public_job_id
          AND location.public_job_version=content.version
          AND location.location_role='applicant_area'
          AND location.resolution_state='resolved'
      )
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public_job_decision_sources source
    JOIN job_source_positions position ON position.id=source.source_position_id
    JOIN job_source_position_mapping_versions mapping
      ON mapping.source_position_id=source.source_position_id
     AND mapping.version=source.source_mapping_version
    JOIN job_listings listing ON listing.id=mapping.listing_id
    JOIN source_publication_policy_versions policy
      ON policy.source_key=source.source_key
     AND policy.version=source.policy_version
    LEFT JOIN job_source_position_mapping_heads mapping_head
      ON mapping_head.source_position_id=source.source_position_id
    LEFT JOIN source_publication_policy_heads policy_head
      ON policy_head.source_key=source.source_key
    LEFT JOIN source_publication_policy_label_versions policy_label
      ON policy_label.source_key=source.source_key
     AND policy_label.policy_version=source.policy_version
    LEFT JOIN public_source_display_label_heads label_head
      ON label_head.source_key=source.source_key
    WHERE source.public_job_id=decision.public_job_id
      AND source.decision_version=decision.decision_version
      AND (
        mapping.public_job_id<>decision.public_job_id
        OR mapping.mapping_state<>'mapped'
        OR mapping.listing_id<>position.listing_id
        OR position.source_key<>source.source_key
        OR listing.board<>source.source_key
        OR mapping.listing_material_version<>listing.material_version
        OR mapping_head.current_version IS NULL
        OR mapping_head.current_version<>source.source_mapping_version
        OR policy_head.current_version IS NULL
        OR policy_head.current_version<>source.policy_version
        OR policy_label.label_version IS NULL
        OR label_head.current_version IS NULL
        OR label_head.current_version<>policy_label.label_version
        OR policy.approval_state<>'approved'
        OR policy.publication_enabled<>1
        OR policy.publication_scope='blocked'
      )
  )
  AND (
    (
      decision.publication_state='published'
      AND decision.route_disposition='serve'
      AND decision.source_open_state='open'
      AND decision.application_route_state='valid'
      AND decision.application_route_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM application_routes route
        WHERE route.id=decision.application_route_id
          AND route.status='active'
          AND EXISTS (
            SELECT 1
            FROM public_job_decision_sources route_source
            JOIN job_source_position_mapping_versions route_mapping
              ON route_mapping.source_position_id=route_source.source_position_id
             AND route_mapping.version=route_source.source_mapping_version
            WHERE route_source.public_job_id=decision.public_job_id
              AND route_source.decision_version=decision.decision_version
              AND route_mapping.listing_id=route.job_id
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public_job_decision_sources source
        JOIN job_source_position_mapping_versions mapping
          ON mapping.source_position_id=source.source_position_id
         AND mapping.version=source.source_mapping_version
        JOIN job_listings listing ON listing.id=mapping.listing_id
        WHERE source.public_job_id=decision.public_job_id
          AND source.decision_version=decision.decision_version
          AND listing.inventory_status<>'active'
      )
    )
    OR (
      decision.publication_state='closed'
      AND decision.route_disposition='retain_noindex'
    )
  )
/* public_job_route_content(public_job_id,public_job_version,eligibility_decision_version,canonical_slug,title,organization_name,workplace_type,date_posted,date_posted_provenance,valid_through,valid_through_provenance,employment_types_json,compensation_json,description_html,public_content_hash,eligibility_decision_hash,material_changed_at,representation_updated_at,publication_state,route_disposition,browse_eligible,organic_index_eligible,job_posting_eligible,verified_at,application_available,locations_json,source_attributions_json) */;
CREATE VIEW public_browse_job_candidates AS
WITH candidate AS (
  SELECT
    public_job_id,public_job_version,eligibility_decision_version,
    canonical_slug,title,organization_name,workplace_type,date_posted,
    date_posted_provenance,valid_through,valid_through_provenance,
    employment_types_json,compensation_json,description_html,
    public_content_hash,eligibility_decision_hash,material_changed_at,
    representation_updated_at,verified_at,application_available,
    locations_json,source_attributions_json
  FROM public_job_route_content
  WHERE publication_state='published' AND browse_eligible=1
),
items AS (
  SELECT
    candidate.*,
    json_object(
    'application',json_object(
      'available',CASE WHEN candidate.application_available=1
        THEN json('true') ELSE json('false') END
    ),
    'canonicalPath','/job/' || candidate.public_job_id || '/' ||
      candidate.canonical_slug,
    'canonicalSlug',candidate.canonical_slug,
    'compensation',CASE WHEN candidate.compensation_json IS NULL
      THEN NULL ELSE json(candidate.compensation_json) END,
    'datePosted',CASE WHEN candidate.date_posted IS NULL THEN NULL
      ELSE json_object(
        'provenance',candidate.date_posted_provenance,
        'value',candidate.date_posted
      ) END,
    'employmentTypes',json(candidate.employment_types_json),
    'freshness',json_object(
      'materialChangedAt',candidate.material_changed_at,
      'verifiedAt',candidate.verified_at
    ),
    'locations',json(candidate.locations_json),
    'organization',json_object('name',candidate.organization_name),
    'publicId',candidate.public_job_id,
    'publicJobVersion',candidate.public_job_version,
    'sources',json(candidate.source_attributions_json),
    'title',candidate.title,
    'validThrough',CASE WHEN candidate.valid_through IS NULL THEN NULL
      ELSE json_object(
        'provenance',candidate.valid_through_provenance,
        'value',candidate.valid_through
      ) END,
    'workplaceType',candidate.workplace_type,
    'status','active'
    ) AS item_json
  FROM candidate
)
SELECT
  items.*,
  json_set(
    items.item_json,
    '$.descriptionHtml',items.description_html,
    '$.schemaVersion','public-job-detail-v1'
  ) AS detail_json
FROM items
/* public_browse_job_candidates(public_job_id,public_job_version,eligibility_decision_version,canonical_slug,title,organization_name,workplace_type,date_posted,date_posted_provenance,valid_through,valid_through_provenance,employment_types_json,compensation_json,description_html,public_content_hash,eligibility_decision_hash,material_changed_at,representation_updated_at,verified_at,application_available,locations_json,source_attributions_json,item_json,detail_json) */;
CREATE VIEW public_browse_jobs AS
SELECT
  head.current_version AS catalog_version,
  member.public_job_id,
  member.public_job_version,
  member.valid_from_ordinal,
  json_extract(member.item_json,'$.canonicalSlug') AS canonical_slug,
  json_extract(member.item_json,'$.title') AS title,
  json_extract(member.item_json,'$.organization.name') AS organization_name,
  json_extract(member.item_json,'$.workplaceType') AS workplace_type,
  json_extract(member.item_json,'$.datePosted.value') AS date_posted,
  COALESCE(
    json_extract(member.item_json,'$.datePosted.provenance'),'unknown'
  ) AS date_posted_provenance,
  json_extract(member.item_json,'$.validThrough.value') AS valid_through,
  COALESCE(
    json_extract(member.item_json,'$.validThrough.provenance'),'unknown'
  ) AS valid_through_provenance,
  json_extract(member.item_json,'$.employmentTypes') AS employment_types_json,
  json_extract(member.item_json,'$.compensation') AS compensation_json,
  member.public_content_hash,
  member.eligibility_decision_hash,
  json_extract(
    member.item_json,'$.freshness.materialChangedAt'
  ) AS material_changed_at,
  member.representation_updated_at,
  json_extract(member.item_json,'$.freshness.verifiedAt') AS verified_at,
  CASE WHEN json_extract(member.item_json,'$.application.available')
    THEN 1 ELSE 0 END AS application_available,
  json_extract(member.item_json,'$.locations') AS locations_json,
  json_extract(member.item_json,'$.sources') AS source_attributions_json,
  member.item_json
FROM public_job_catalog_head_pointer head
JOIN public_job_catalog_versions head_version
  ON head_version.version=head.current_version
JOIN public_job_catalog_members member
  ON member.valid_from_ordinal<=head_version.ordinal
 AND (member.valid_to_ordinal IS NULL
   OR member.valid_to_ordinal>head_version.ordinal)
WHERE head.singleton=1
/* public_browse_jobs(catalog_version,public_job_id,public_job_version,valid_from_ordinal,canonical_slug,title,organization_name,workplace_type,date_posted,date_posted_provenance,valid_through,valid_through_provenance,employment_types_json,compensation_json,public_content_hash,eligibility_decision_hash,material_changed_at,representation_updated_at,verified_at,application_available,locations_json,source_attributions_json,item_json) */;
CREATE VIEW organic_index_jobs AS
SELECT browse.*
FROM public_browse_jobs browse
JOIN public_job_route_content content
  ON content.public_job_id=browse.public_job_id
 AND content.public_job_version=browse.public_job_version
WHERE content.publication_state='published'
  AND content.browse_eligible=1
  AND content.organic_index_eligible=1
/* organic_index_jobs(catalog_version,public_job_id,public_job_version,valid_from_ordinal,canonical_slug,title,organization_name,workplace_type,date_posted,date_posted_provenance,valid_through,valid_through_provenance,employment_types_json,compensation_json,public_content_hash,eligibility_decision_hash,material_changed_at,representation_updated_at,verified_at,application_available,locations_json,source_attributions_json,item_json) */;
CREATE VIEW public_job_route_inputs AS
SELECT
  decision.public_job_id,
  CASE WHEN current_member.public_job_id IS NOT NULL
    THEN 'published' ELSE decision.publication_state END AS publication_state,
  CASE WHEN current_member.public_job_id IS NOT NULL
    THEN 'serve' ELSE decision.route_disposition END AS route_disposition,
  decision.redirect_public_job_id,
  COALESCE(
    json_extract(current_member.item_json,'$.canonicalSlug'),
    json_extract(historical_member.item_json,'$.canonicalSlug')
  ) AS canonical_slug,
  CASE WHEN current_member.public_job_id IS NOT NULL THEN 1
    WHEN decision.publication_state='closed'
     AND decision.route_disposition='retain_noindex'
     AND historical_member.public_job_id IS NOT NULL THEN 1
    ELSE 0 END AS has_content,
  CASE WHEN current_member.public_job_id IS NOT NULL THEN 0 ELSE 1 END
    AS noindex,
  CASE WHEN current_member.public_job_id IS NOT NULL
    THEN catalog_head.current_version
    ELSE historical_version.version
  END AS content_catalog_version,
  COALESCE(current_member.detail_json,historical_member.detail_json)
    AS detail_json,
  COALESCE(
    current_member.public_content_hash,
    historical_member.public_content_hash
  ) AS public_content_hash,
  CASE WHEN current_member.public_job_id IS NOT NULL
    THEN current_member.eligibility_decision_hash
    WHEN decision.publication_state='closed'
     AND decision.route_disposition='retain_noindex'
     AND historical_member.public_job_id IS NOT NULL
    THEN decision.decision_hash
    ELSE historical_member.eligibility_decision_hash
  END AS eligibility_decision_hash,
  CASE WHEN current_member.public_job_id IS NOT NULL
    THEN current_member.representation_updated_at
    WHEN decision.publication_state='closed'
     AND decision.route_disposition='retain_noindex'
     AND historical_member.public_job_id IS NOT NULL
    THEN CASE
      WHEN historical_member.representation_updated_at>decision.decided_at
      THEN historical_member.representation_updated_at
      ELSE decision.decided_at
    END
    ELSE historical_member.representation_updated_at
  END AS representation_updated_at,
  CASE WHEN historical_member.public_job_id IS NULL THEN 0 ELSE 1 END
    AS has_activated_history
FROM public_job_eligibility_heads head
JOIN public_job_eligibility_decisions decision
  ON decision.public_job_id=head.public_job_id
 AND decision.decision_version=head.current_decision_version
LEFT JOIN public_job_catalog_head_pointer catalog_head
  ON catalog_head.singleton=1
LEFT JOIN public_job_catalog_versions catalog_head_version
  ON catalog_head_version.version=catalog_head.current_version
LEFT JOIN public_job_catalog_members current_member
  ON current_member.public_job_id=decision.public_job_id
 AND current_member.valid_from_ordinal<=catalog_head_version.ordinal
 AND (current_member.valid_to_ordinal IS NULL
   OR current_member.valid_to_ordinal>catalog_head_version.ordinal)
LEFT JOIN public_job_catalog_versions historical_version
  ON historical_version.version=(
    SELECT history.catalog_version
    FROM public_job_catalog_head_history history
    JOIN public_job_catalog_versions activated
      ON activated.version=history.catalog_version
    JOIN public_job_catalog_members span
      ON span.public_job_id=decision.public_job_id
     AND span.valid_from_ordinal<=activated.ordinal
     AND (span.valid_to_ordinal IS NULL
       OR span.valid_to_ordinal>activated.ordinal)
    ORDER BY history.activated_at DESC,history.catalog_version DESC
    LIMIT 1
  )
LEFT JOIN public_job_catalog_members historical_member
  ON historical_member.public_job_id=decision.public_job_id
 AND historical_member.valid_from_ordinal<=historical_version.ordinal
 AND (historical_member.valid_to_ordinal IS NULL
   OR historical_member.valid_to_ordinal>historical_version.ordinal)
/* public_job_route_inputs(public_job_id,publication_state,route_disposition,redirect_public_job_id,canonical_slug,has_content,noindex,content_catalog_version,detail_json,public_content_hash,eligibility_decision_hash,representation_updated_at,has_activated_history) */;
CREATE VIEW public_job_route_resolutions AS
WITH RECURSIVE redirect_chain(
  origin_id,current_id,depth,visited
) AS (
  SELECT
    input.public_job_id,input.redirect_public_job_id,1,
    '|' || input.public_job_id || '|'
  FROM public_job_route_inputs input
  WHERE input.publication_state='merged'
    AND input.route_disposition='redirect'
    AND input.redirect_public_job_id IS NOT NULL
    AND input.has_activated_history=1
  UNION ALL
  SELECT
    chain.origin_id,input.redirect_public_job_id,chain.depth+1,
    chain.visited || chain.current_id || '|'
  FROM redirect_chain chain
  JOIN public_job_route_inputs input ON input.public_job_id=chain.current_id
  WHERE input.publication_state='merged'
    AND input.route_disposition='redirect'
    AND input.redirect_public_job_id IS NOT NULL
    AND chain.depth<32
    AND instr(chain.visited,'|' || chain.current_id || '|')=0
),
terminal_redirects AS (
  SELECT chain.origin_id,chain.current_id
  FROM redirect_chain chain
  JOIN public_job_route_inputs input ON input.public_job_id=chain.current_id
  WHERE input.publication_state<>'merged'
),
served AS (
  SELECT
    content.public_job_id,
    alias.slug AS requested_slug,
    CASE WHEN alias.slug=content.canonical_slug
      THEN 'serve' ELSE 'permanent_redirect' END AS route_action,
    CASE WHEN alias.slug=content.canonical_slug THEN NULL
      ELSE '/job/' || content.public_job_id || '/' || content.canonical_slug
    END AS target_path,
    content.noindex,
    content.content_catalog_version,
    content.detail_json,
    content.public_content_hash,
    content.eligibility_decision_hash,
    content.representation_updated_at
  FROM public_job_route_inputs content
  JOIN public_job_aliases alias ON alias.public_job_id=content.public_job_id
  WHERE content.has_content=1
),
merged AS (
  SELECT
    terminal.origin_id AS public_job_id,
    alias.slug AS requested_slug,
    CASE WHEN target.has_content=1 THEN 'permanent_redirect' ELSE 'gone' END
      AS route_action,
    CASE WHEN target.has_content=1
      THEN '/job/' || target.public_job_id || '/' || target.canonical_slug
      ELSE NULL END AS target_path,
    1 AS noindex,
    NULL AS content_catalog_version,
    NULL AS detail_json,
    NULL AS public_content_hash,
    NULL AS eligibility_decision_hash,
    NULL AS representation_updated_at
  FROM terminal_redirects terminal
  JOIN public_job_aliases alias ON alias.public_job_id=terminal.origin_id
  JOIN public_job_route_inputs target ON target.public_job_id=terminal.current_id
  WHERE target.has_content=1
     OR (
       target.route_disposition='gone'
       AND target.has_activated_history=1
     )
),
gone AS (
  SELECT
    input.public_job_id,
    alias.slug AS requested_slug,
    'gone' AS route_action,
    NULL AS target_path,
    1 AS noindex,
    NULL AS content_catalog_version,
    NULL AS detail_json,
    NULL AS public_content_hash,
    NULL AS eligibility_decision_hash,
    NULL AS representation_updated_at
  FROM public_job_route_inputs input
  JOIN public_job_aliases alias ON alias.public_job_id=input.public_job_id
  WHERE input.route_disposition='gone'
    AND input.has_activated_history=1
)
SELECT public_job_id,requested_slug,route_action,target_path,noindex,
       content_catalog_version,detail_json,public_content_hash,
       eligibility_decision_hash,representation_updated_at
FROM served
UNION ALL
SELECT public_job_id,requested_slug,route_action,target_path,noindex,
       content_catalog_version,detail_json,public_content_hash,
       eligibility_decision_hash,representation_updated_at
FROM merged
UNION ALL
SELECT public_job_id,requested_slug,route_action,target_path,noindex,
       content_catalog_version,detail_json,public_content_hash,
       eligibility_decision_hash,representation_updated_at
FROM gone
/* public_job_route_resolutions(public_job_id,requested_slug,route_action,target_path,noindex,content_catalog_version,detail_json,public_content_hash,eligibility_decision_hash,representation_updated_at) */;
CREATE VIEW job_posting_jobs AS
SELECT organic.*
FROM organic_index_jobs organic
JOIN public_job_route_content content
  ON content.public_job_id=organic.public_job_id
 AND content.public_job_version=organic.public_job_version
WHERE content.job_posting_eligible=1
  AND content.date_posted IS NOT NULL
  AND content.date_posted_provenance IN ('employer-original','board-published')
/* job_posting_jobs(catalog_version,public_job_id,public_job_version,valid_from_ordinal,canonical_slug,title,organization_name,workplace_type,date_posted,date_posted_provenance,valid_through,valid_through_provenance,employment_types_json,compensation_json,public_content_hash,eligibility_decision_hash,material_changed_at,representation_updated_at,verified_at,application_available,locations_json,source_attributions_json,item_json) */;

-- Historical Tajikistan research seed, carried from 0037_historical_country_research.
-- A schema-only dump does not capture it, and production has since accumulated
-- sweep-discovered rows that are not part of the baseline.
INSERT OR IGNORE INTO organizations (
  id,country_code,country_name,name,identity_key,city,region,website_url,
  canonical_domain,market_segment,status,outreach_eligibility,evidence_url,
  last_verified_at,created_at,updated_at
) VALUES
  ('historical-tj-dii','TJ','Tajikistan','Dushanbe Innovation Institute',
   'domain:dii.tj','Dushanbe','','https://dii.tj/english-language-instructor/',
   'dii.tj','university','active','review',
   'https://dii.tj/english-language-instructor/','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z'),
  ('historical-tj-arkon','TJ','Tajikistan','Arkon Education Group',
   'name:arkon education group|city:khujand','Khujand','','','',
   'language_center','active','review',
   'https://tesljobs.com/jobs/full-time-english-teacher-khujand-tajikistan-online--K5tqDXmjU5x',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-modern','TJ','Tajikistan','Modern International School',
   'domain:mistj.edupage.org','Dushanbe','','https://mistj.edupage.org/contact/',
   'mistj.edupage.org','international_school','active','review',
   'https://www.eslboards.com/job/esl-teacher-native-speaker-6060',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-dis','TJ','Tajikistan','Dushanbe International School',
   'domain:dis.tj','Dushanbe','','https://www.dis.tj/','dis.tj',
   'international_school','active','review','https://dissecondary.edupage.org/job/',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-qsi','TJ','Tajikistan','QSI International School of Dushanbe',
   'domain:dushanbe.qsi.org','Dushanbe','','https://dushanbe.qsi.org/',
   'dushanbe.qsi.org','international_school','active','review',
   'https://www.qsi.org/careers','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z'),
  ('historical-tj-qalam','TJ','Tajikistan','Qalam International School',
   'name:qalam international school|city:dushanbe','Dushanbe','','','',
   'international_school','unverified','review',
   'https://jobs.teachingnomad.com/company/14576/qalam-international-school/',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-contofield','TJ','Tajikistan','Contofield International School',
   'domain:contofield.com','Dushanbe','','https://contofield.com/','contofield.com',
   'international_school','active','review','https://contofield.com/',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-imperiya','TJ','Tajikistan','Imperiya Znaniy Private School',
   'domain:imperiya.vip','Dushanbe','','https://imperiya.vip/en','imperiya.vip',
   'private_school','active','review','https://imperiya.vip/en',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-tis','TJ','Tajikistan','Tajikistan International School',
   'name:tajikistan international school|city:dushanbe','Dushanbe','','','',
   'international_school','unverified','review',
   'https://www.teachaway.com/schools/tajikistan-international-school',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-aga-khan','TJ','Tajikistan','Aga Khan Lycee',
   'domain:agakhanschools.org','Khorog','','https://www.agakhanschools.org/Tajikistan/AKL/Index',
   'agakhanschools.org','private_school','active','review',
   'https://www.agakhanschools.org/Tajikistan/AKL/PracticalInformation',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-uca','TJ','Tajikistan','University of Central Asia / SPCE',
   'domain:ucentralasia.org','Khorog / Dushanbe','',
   'https://ucentralasia.org/','ucentralasia.org','university','active','review',
   'https://ucentralasia.org/schools/school-of-professional-and-continuing-education/about-spce/spce-tajikistan',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-melting-pot','TJ','Tajikistan','Melting Pot School of Languages',
   'name:melting pot school of languages|city:dushanbe','Dushanbe','','','',
   'language_center','unverified','review',
   'https://tj.linkedin.com/jobs/view/%D0%BF%D1%80%D0%B5%D0%BF%D0%BE%D0%B4%D0%B0%D0%B2%D0%B0%D1%82%D0%B5%D0%BB%D1%8C-%D0%B0%D0%BD%D0%B3%D0%BB%D0%B8%D0%B9%D1%81%D0%BA%D0%BE%D0%B3%D0%BE-%D1%8F%D0%B7%D1%8B%D0%BA%D0%B0-%D0%BA%D0%B0%D0%BA-%D0%B8%D0%BD%D0%BE%D1%81%D1%82%D1%80%D0%B0%D0%BD%D0%BD%D0%BE%D0%B3%D0%BE-at-melting-pot-language-school-4006664497',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-american-councils','TJ','Tajikistan','American Councils Tajikistan',
   'domain:tajikistan.americancouncils.org','Dushanbe','',
   'https://tajikistan.americancouncils.org/menu',
   'tajikistan.americancouncils.org','training_center','active','review',
   'https://tajikistan.americancouncils.org/menu','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z');

INSERT INTO organization_evidence (
  id,organization_id,source_kind,evidence_kind,evidence_status,roles,
  source_label,source_url,posting_context,notes,observed_at,provenance_path,
  metadata_json,created_at
) VALUES
  ('historical-tj-evidence-dii',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:dii.tj' OR canonical_domain='dii.tj')),'historical_workbook',
   'vacancy','unclear','English Language Instructor','Direct job page',
   'https://dii.tj/english-language-instructor/','No date shown',
   'English-medium higher-ed institution.','2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"Unclear","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-arkon',(SELECT id FROM organizations WHERE country_code='TJ' AND identity_key='name:arkon education group|city:khujand'),'historical_workbook',
   'vacancy','active','Full-time English Teacher','TeslJobs / ESL Cafe',
   'https://tesljobs.com/jobs/full-time-english-teacher-khujand-tajikistan-online--K5tqDXmjU5x',
   'Posted Mar 7, 2026','Language centers plus IB candidate middle school.',
   '2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"Yes","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-modern-esl',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:mistj.edupage.org' OR canonical_domain='mistj.edupage.org')),'historical_workbook',
   'vacancy','active','ESL Teacher','ESLboards',
   'https://www.eslboards.com/job/esl-teacher-native-speaker-6060',
   'May 8, 2026','Title has location noise; text says Dushanbe.',
   '2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"Yes","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-modern-science',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:mistj.edupage.org' OR canonical_domain='mistj.edupage.org')),'historical_workbook',
   'vacancy','unclear','Physics/Chemistry Teacher','LinkedIn',
   'https://tj.linkedin.com/jobs/view/teacher-at-modern-international-school-4193206850',
   '2025-26 year','Science lead; verify still open.',
   '2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"Unclear","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-dis',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:dis.tj' OR canonical_domain='dis.tj')),'historical_workbook',
   'outreach_target','outreach','ESL, Biology, Chemistry','School jobs page',
   'https://dissecondary.edupage.org/job/','Aug 15, 2020 on jobs page',
   'Old dates but active contact page.','2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"No","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-qsi',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:dushanbe.qsi.org' OR canonical_domain='dushanbe.qsi.org')),'historical_workbook',
   'outreach_target','outreach','English/Science outreach','QSI school page',
   'https://www.qsi.org/careers','No current target role found',
   'English-medium, AP, reputable target.','2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"No","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-qalam',(SELECT id FROM organizations WHERE country_code='TJ' AND identity_key='name:qalam international school|city:dushanbe'),'historical_workbook',
   'outreach_target','outreach','Primary/English outreach','Teaching Nomad profile',
   'https://jobs.teachingnomad.com/company/14576/qalam-international-school/',
   'No current target role found','Private international school target.',
   '2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"No","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-contofield',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:contofield.com' OR canonical_domain='contofield.com')),'historical_workbook',
   'outreach_target','outreach','English, Science, Chemistry outreach','School site',
   'https://contofield.com/','No date found',
   'English-medium; science subjects listed.','2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"No","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-imperiya',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:imperiya.vip' OR canonical_domain='imperiya.vip')),'historical_workbook',
   'outreach_target','outreach','Primary/STEEM/Science outreach','School site',
   'https://imperiya.vip/en','No date found',
   'Private STEEM school; check directly.','2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"Unclear","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-tis',(SELECT id FROM organizations WHERE country_code='TJ' AND identity_key='name:tajikistan international school|city:dushanbe'),'historical_workbook',
   'outreach_target','outreach','English/Science outreach','Teach Away school profile',
   'https://www.teachaway.com/schools/tajikistan-international-school',
   'No current jobs','TeachAway says no current jobs.',
   '2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"No","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-aga-khan',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:agakhanschools.org' OR canonical_domain='agakhanschools.org')),'historical_workbook',
   'outreach_target','outreach','English/Science outreach','School site',
   'https://www.agakhanschools.org/Tajikistan/AKL/PracticalInformation',
   'No current target role found','Large school; English teacher history.',
   '2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"No","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-uca-spce',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:ucentralasia.org' OR canonical_domain='ucentralasia.org')),'historical_workbook',
   'outreach_target','outreach','Conversational English, YLE, academic English',
   'University program page',
   'https://ucentralasia.org/schools/school-of-professional-and-continuing-education/about-spce/spce-tajikistan',
   'No current target role found','Multiple Tajik training centers.',
   '2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"No","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-uca-esl',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:ucentralasia.org' OR canonical_domain='ucentralasia.org')),'historical_workbook',
   'vacancy','unclear','ESL Faculty / English Instructor','Vacancy PDF',
   'https://www.iicanada.org/sites/default/files/English%20language%20Instructor%20%28ESL%29%20UCA.pdf',
   'Older PDF','Good target; confirm current status.',
   '2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"Unclear","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-melting-pot',(SELECT id FROM organizations WHERE country_code='TJ' AND identity_key='name:melting pot school of languages|city:dushanbe'),'historical_workbook',
   'vacancy','unclear','English as a Foreign Language Teacher','LinkedIn',
   'https://tj.linkedin.com/jobs/view/%D0%BF%D1%80%D0%B5%D0%BF%D0%BE%D0%B4%D0%B0%D0%B2%D0%B0%D1%82%D0%B5%D0%BB%D1%8C-%D0%B0%D0%BD%D0%B3%D0%BB%D0%B8%D0%B9%D1%81%D0%BA%D0%BE%D0%B3%D0%BE-%D1%8F%D0%B7%D1%8B%D0%BA%D0%B0-%D0%BA%D0%B0%D0%BA-%D0%B8%D0%BD%D0%BE%D1%81%D1%82%D1%80%D0%B0%D0%BD%D0%BD%D0%BE%D0%B3%D0%BE-at-melting-pot-language-school-4006664497',
   'Crawled Apr 2026','Language-school lead.',
   '2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"Unclear","priority":"Top"}',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-evidence-american-councils',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:tajikistan.americancouncils.org' OR canonical_domain='tajikistan.americancouncils.org')),
   'historical_workbook','outreach_target','outreach','English-program outreach',
   'Organization site','https://tajikistan.americancouncils.org/menu',
   'No current target role found','Useful networking lead.',
   '2026-05-11T00:00:00.000Z',
   'job-search/job-data/country-sweeps/tajikistan/2026-05-11/teaching_leads_eastern_europe_central_asia.xlsx',
   '{"applied":false,"openJob2026":"No","priority":"Top"}',
   '2026-05-11T00:00:00.000Z');

INSERT INTO organization_contact_points (
  id,organization_id,kind,label,value,status,evidence_url,last_verified_at,
  created_at,updated_at
) VALUES
  ('historical-tj-contact-dii',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:dii.tj' OR canonical_domain='dii.tj')),'careers_page','Instructor page',
   'https://dii.tj/english-language-instructor/','active',
   'https://dii.tj/english-language-instructor/','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z'),
  ('historical-tj-contact-modern',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:mistj.edupage.org' OR canonical_domain='mistj.edupage.org')),'website','School contact page',
   'https://mistj.edupage.org/contact/','active','https://mistj.edupage.org/contact/',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-contact-dis',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:dis.tj' OR canonical_domain='dis.tj')),'careers_page','School jobs page',
   'https://dissecondary.edupage.org/job/','stale',
   'https://dissecondary.edupage.org/job/','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z'),
  ('historical-tj-contact-qsi',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:dushanbe.qsi.org' OR canonical_domain='dushanbe.qsi.org')),'careers_page','QSI careers',
   'https://www.qsi.org/careers','active','https://www.qsi.org/careers',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-contact-contofield',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:contofield.com' OR canonical_domain='contofield.com')),'website','School website',
   'https://contofield.com/','active','https://contofield.com/',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-contact-imperiya',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:imperiya.vip' OR canonical_domain='imperiya.vip')),'website','School website',
   'https://imperiya.vip/en','active','https://imperiya.vip/en',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-contact-aga-khan',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:agakhanschools.org' OR canonical_domain='agakhanschools.org')),'website','School website',
   'https://www.agakhanschools.org/Tajikistan/AKL/Index','active',
   'https://www.agakhanschools.org/Tajikistan/AKL/Index',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-contact-uca',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:ucentralasia.org' OR canonical_domain='ucentralasia.org')),'website','University website',
   'https://ucentralasia.org/','active','https://ucentralasia.org/',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z'),
  ('historical-tj-contact-american-councils',(SELECT id FROM organizations WHERE country_code='TJ' AND (identity_key='domain:tajikistan.americancouncils.org' OR canonical_domain='tajikistan.americancouncils.org')),
   'website','Organization website','https://tajikistan.americancouncils.org/menu',
   'active','https://tajikistan.americancouncils.org/menu',
   '2026-05-11T00:00:00.000Z','2026-05-11T00:00:00.000Z',
   '2026-05-11T00:00:00.000Z')
ON CONFLICT(organization_id,kind,value) DO NOTHING;
