-- PUBLIC-DATA-001: private, append-only foundation for canonical public jobs.
-- Every publication policy starts disabled. This migration publishes zero jobs.

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

CREATE UNIQUE INDEX idx_canonical_locations_provider_identity
  ON canonical_locations(provider,provider_place_id)
  WHERE provider<>'' AND provider_place_id<>'';

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

-- Seed only disabled policies. Approval is an append-only policy successor.
INSERT INTO source_publication_policy_versions (
  source_key,version,predecessor_version,approval_state,publication_scope,
  publication_enabled,allowed_fields_json,attribution_mode,
  max_verbatim_chars,source_origin_url,terms_url,terms_checked_at,robots_url,
  robots_checked_at,evidence_json,decision_note,policy_hash,idempotency_key,
  created_at
) VALUES
  (
    'ajarn',1,NULL,'rejected','blocked',0,'[]','none',0,
    'https://www.ajarn.com/','https://www.ajarn.com/terms-of-use',
    '2026-07-21','https://www.ajarn.com/robots.txt','2026-07-21',
    '{"basis":"official terms and homepage","reviewedAt":"2026-07-21","status":"written permission required"}',
    'Third-party republication requires written permission.',
    '4a8885b2154c414e7932a8ec344cfa535d1829f11017dd7d7e4917637e53a3b1',
    'seed-v1','2026-07-21T00:00:00.000Z'
  ),
  (
    'anesl',1,NULL,'rejected','blocked',0,'[]','none',0,
    'https://www.anesl.com/','',NULL,
    'https://cafe.anesl.com/robots.txt','2026-07-21',
    '{"basis":"official application process and absent republication grant","reviewedAt":"2026-07-21","status":"permission required"}',
    'ANESL is an intermediary application channel; public republication is unapproved.',
    'eba56ec0278fe08b53eb2a7f20230f9d339ea4135b48b6dc8b24924245dec79d',
    'seed-v1','2026-07-21T00:00:00.000Z'
  ),
  (
    'eslcafe-modern',1,NULL,'pending','metadata_only',0,
    '["title","organization_name","locations","date_posted","valid_through","employment_types","compensation","source_name","source_url"]',
    'source_link',0,'https://www.eslcafe.com/',
    'https://www.eslcafe.com/terms','2026-07-21',
    'https://www.eslcafe.com/robots.txt','2026-07-21',
    '{"basis":"official terms, privacy, and robots policy","reviewedAt":"2026-07-21","status":"metadata review pending"}',
    'Metadata publication remains disabled pending explicit approval.',
    '686e968b2e45d76671fa70541077b1ecce77fa58c687432c9c04883525b703bf',
    'seed-v1','2026-07-21T00:00:00.000Z'
  ),
  (
    'seriousteachers',1,NULL,'pending','metadata_only',0,
    '["title","organization_name","locations","date_posted","valid_through","employment_types","compensation","source_name","source_url"]',
    'source_link',0,'https://www.seriousteachers.com/',
    'https://www.seriousteachers.com/shared/terms_use','2026-07-21',
    'https://www.seriousteachers.com/robots.txt','2026-07-21',
    '{"basis":"official terms, privacy, and robots policy","reviewedAt":"2026-07-21","status":"metadata review pending"}',
    'Metadata publication remains disabled pending explicit approval.',
    '4de923f9f55355a81caf82923181fdaaf218d1d2597fe6e63ad0340dd17b87b2',
    'seed-v1','2026-07-21T00:00:00.000Z'
  ),
  (
    'tefl',1,NULL,'rejected','blocked',0,'[]','none',0,
    'https://www.tefl.com/',
    'https://www.tefl.com/about-us/terms-and-conditions.html','2026-07-21',
    'https://www.tefl.com/robots.txt','2026-07-21',
    '{"basis":"official terms and absent automation grant","reviewedAt":"2026-07-21","status":"feed or written permission required"}',
    'Commercial reuse and automated application terms require written clarification.',
    '73593718d0e4af1a3bb0a920faf985c69d3c1a1ebd4e1e51197d0b745af883d9',
    'seed-v1','2026-07-21T00:00:00.000Z'
  );

INSERT INTO source_publication_policy_heads (
  source_key,current_version,updated_at
)
SELECT source_key,version,created_at
FROM source_publication_policy_versions
WHERE version=1;

-- Immutable rows and direct-successor heads preserve complete history.
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

-- This internal projection is fail-closed. It contains only public-safe facts
-- and never exposes route destinations, contacts, users, drafts, or messages.
CREATE VIEW public_job_route_content AS
SELECT
  job.id AS public_job_id,
  content.version AS public_job_version,
  content.canonical_slug,
  content.title,
  content.organization_name,
  content.workplace_type,
  content.date_posted,
  content.date_posted_provenance,
  content.valid_through,
  content.valid_through_provenance,
  content.employment_types_json,
  content.compensation_json,
  content.description_html,
  content.public_content_hash,
  content.material_changed_at,
  decision.publication_state,
  decision.route_disposition,
  decision.browse_eligible,
  decision.organic_index_eligible,
  decision.job_posting_eligible,
  decision.verified_at,
  CASE WHEN decision.publication_state='published' THEN 1 ELSE 0 END
    AS application_available,
  COALESCE((
    SELECT json_group_array(json_object(
      'role',location_row.location_role,
      'displayName',location_row.display_name,
      'countryCode',location_row.country_code,
      'region',location_row.region,
      'locality',location_row.locality,
      'postalCode',location_row.postal_code
    ))
    FROM (
      SELECT
        location.location_role,
        location.display_name,
        location.country_code,
        location.region,
        location.locality,
        location.postal_code
      FROM public_job_version_locations location
      WHERE location.public_job_id=content.public_job_id
        AND location.public_job_version=content.version
        AND location.resolution_state='resolved'
      ORDER BY location.ordinal
    ) location_row
  ),'[]') AS locations_json,
  COALESCE((
    SELECT json_group_array(json_object(
      'sourceName',attribution.source_key,
      'sourceUrl',attribution.source_url
    ))
    FROM (
      SELECT DISTINCT
        CASE WHEN EXISTS (
          SELECT 1 FROM json_each(source.fields_used_json)
          WHERE value='source_name'
        ) THEN source.source_key ELSE '' END AS source_key,
        CASE WHEN EXISTS (
          SELECT 1 FROM json_each(source.fields_used_json)
          WHERE value='source_url'
        ) THEN listing.source_url ELSE '' END AS source_url
      FROM public_job_decision_sources source
      JOIN job_source_position_mapping_versions mapping
        ON mapping.source_position_id=source.source_position_id
       AND mapping.version=source.source_mapping_version
      JOIN job_listings listing ON listing.id=mapping.listing_id
      WHERE source.public_job_id=decision.public_job_id
        AND source.decision_version=decision.decision_version
        AND EXISTS (
          SELECT 1 FROM json_each(source.fields_used_json)
          WHERE value IN ('source_name','source_url')
        )
      ORDER BY source.source_key,source_url
    ) attribution
  ),'[]') AS source_attributions_json
FROM public_jobs job
JOIN public_job_heads content_head
  ON content_head.public_job_id=job.id
JOIN public_job_versions content
  ON content.public_job_id=content_head.public_job_id
 AND content.version=content_head.current_version
JOIN public_job_eligibility_heads decision_head
  ON decision_head.public_job_id=job.id
JOIN public_job_eligibility_decisions decision
  ON decision.public_job_id=decision_head.public_job_id
 AND decision.decision_version=decision_head.current_decision_version
WHERE decision.public_job_version=content.version
  AND decision.publication_state IN ('published','closed')
  AND decision.content_review_state='approved'
  AND decision.privacy_state='passed'
  AND decision.verified_at IS NOT NULL
  AND trim(content.title)<>''
  AND content.organization_id IS NOT NULL
  AND content.organization_resolution_state='resolved'
  AND trim(content.organization_name)<>''
  AND trim(content.description_html)<>''
  AND trim(content.public_content_hash)<>''
  AND trim(content.material_changed_at)<>''
  AND (
    EXISTS (
      SELECT 1
      FROM public_job_version_locations location
      WHERE location.public_job_id=content.public_job_id
        AND location.public_job_version=content.version
        AND location.location_role='worksite'
        AND location.resolution_state='resolved'
    )
    OR (
      content.workplace_type='remote'
      AND EXISTS (
        SELECT 1
        FROM public_job_version_locations location
        WHERE location.public_job_id=content.public_job_id
          AND location.public_job_version=content.version
          AND location.location_role='applicant_area'
          AND location.resolution_state='resolved'
      )
    )
  )
  AND EXISTS (
    SELECT 1
    FROM public_job_decision_sources source
    WHERE source.public_job_id=decision.public_job_id
      AND source.decision_version=decision.decision_version
      AND source.contribution_kind='public_content'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public_job_decision_sources source
    JOIN job_source_positions position
      ON position.id=source.source_position_id
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
        OR policy.approval_state<>'approved'
        OR policy.publication_enabled<>1
        OR policy.publication_scope='blocked'
        OR EXISTS (
          SELECT 1
          FROM json_each(source.fields_used_json) used_field
          WHERE NOT EXISTS (
            SELECT 1
            FROM json_each(policy.allowed_fields_json) allowed_field
            WHERE allowed_field.value=used_field.value
          )
        )
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
        SELECT 1
        FROM application_routes route
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
      AND (content.valid_through IS NULL OR content.valid_through>=date('now'))
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
  );

CREATE VIEW public_browse_jobs AS
SELECT
  public_job_id,canonical_slug,title,organization_name,workplace_type,
  date_posted,date_posted_provenance,valid_through,
  valid_through_provenance,employment_types_json,compensation_json,
  description_html,public_content_hash,material_changed_at,verified_at,
  application_available,locations_json,source_attributions_json
FROM public_job_route_content
WHERE publication_state='published' AND browse_eligible=1;

CREATE VIEW organic_index_jobs AS
SELECT
  public_job_id,canonical_slug,title,organization_name,workplace_type,
  date_posted,date_posted_provenance,valid_through,
  valid_through_provenance,employment_types_json,compensation_json,
  description_html,public_content_hash,material_changed_at,verified_at,
  application_available,locations_json,source_attributions_json
FROM public_job_route_content
WHERE publication_state='published'
  AND browse_eligible=1
  AND organic_index_eligible=1;

CREATE VIEW job_posting_jobs AS
SELECT
  public_job_id,canonical_slug,title,organization_name,workplace_type,
  date_posted,date_posted_provenance,valid_through,
  valid_through_provenance,employment_types_json,compensation_json,
  description_html,public_content_hash,material_changed_at,verified_at,
  application_available,locations_json,source_attributions_json
FROM public_job_route_content
WHERE publication_state='published'
  AND browse_eligible=1
  AND organic_index_eligible=1
  AND job_posting_eligible=1
  AND date_posted IS NOT NULL
  AND date_posted_provenance='employer-original'
  AND lower(trim(description_html))<>lower(trim(title));

CREATE VIEW public_job_route_resolutions AS
SELECT
  content.public_job_id,
  alias.slug AS requested_slug,
  CASE
    WHEN alias.slug=content.canonical_slug THEN 'serve'
    ELSE 'permanent_redirect'
  END AS route_action,
  CASE
    WHEN alias.slug=content.canonical_slug THEN NULL
    ELSE '/job/' || content.public_job_id || '/' || content.canonical_slug
  END AS target_path,
  CASE WHEN content.publication_state='closed' THEN 1 ELSE 0 END AS noindex
FROM public_job_route_content content
JOIN public_job_aliases alias ON alias.public_job_id=content.public_job_id

UNION ALL

SELECT
  decision.public_job_id,
  alias.slug AS requested_slug,
  'permanent_redirect' AS route_action,
  '/job/' || target.public_job_id || '/' || target.canonical_slug AS target_path,
  1 AS noindex
FROM public_job_eligibility_heads head
JOIN public_job_eligibility_decisions decision
  ON decision.public_job_id=head.public_job_id
 AND decision.decision_version=head.current_decision_version
JOIN public_job_aliases alias ON alias.public_job_id=decision.public_job_id
JOIN public_job_route_content target
  ON target.public_job_id=decision.redirect_public_job_id
WHERE decision.publication_state='merged'
  AND decision.route_disposition='redirect'

UNION ALL

SELECT
  decision.public_job_id,
  alias.slug AS requested_slug,
  'gone' AS route_action,
  NULL AS target_path,
  1 AS noindex
FROM public_job_eligibility_heads head
JOIN public_job_eligibility_decisions decision
  ON decision.public_job_id=head.public_job_id
 AND decision.decision_version=head.current_decision_version
JOIN public_job_aliases alias ON alias.public_job_id=decision.public_job_id
WHERE decision.route_disposition='gone'
  AND EXISTS (
    SELECT 1
    FROM public_job_eligibility_decisions history
    WHERE history.public_job_id=decision.public_job_id
      AND history.publication_state='published'
  );
