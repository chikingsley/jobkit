-- PUBLIC-DATA-001 Phase D3a: immutable canonical-resolution shadow evidence.
-- Resolution output remains private projection state. The two acceptance
-- tables record explicit operator authority; neither writes a public table.

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

CREATE INDEX idx_org_source_employer_mapping_org
  ON organization_source_employer_mappings(organization_id,source_key);

CREATE TRIGGER trg_org_source_employer_mapping_operator
BEFORE INSERT ON organization_source_employer_mappings
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users
     WHERE id=NEW.accepted_by_user_id AND role='operator'
  ) THEN RAISE(ABORT,'source employer mapping requires an operator') END;
END;

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

CREATE INDEX idx_org_domain_mapping_lookup
  ON organization_domain_mappings(
    public_suffix_list_version,normalized_host,registrable_domain,mapping_kind
  );

CREATE INDEX idx_org_domain_mapping_org
  ON organization_domain_mappings(organization_id,mapping_kind);

CREATE TRIGGER trg_org_domain_mapping_operator
BEFORE INSERT ON organization_domain_mappings
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users
     WHERE id=NEW.accepted_by_user_id AND role='operator'
  ) THEN RAISE(ABORT,'domain mapping requires an operator') END;
END;

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

CREATE TRIGGER trg_org_opportunity_acceptance_operator
BEFORE INSERT ON organization_opportunity_acceptances
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM users
     WHERE id=NEW.accepted_by_user_id AND role='operator'
  ) THEN RAISE(ABORT,'opportunity acceptance requires an operator') END;
END;

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

-- Every normalized child and seal is immutable. Provider attempts that reach
-- this schema are permanent evidence and follow the same append-only rule.
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
