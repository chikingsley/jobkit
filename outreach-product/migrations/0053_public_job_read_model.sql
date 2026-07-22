-- PUBLIC-DTO-001: fail-closed anonymous list and detail read model.
-- The seeded catalog is empty and every seeded source policy remains disabled.

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

INSERT INTO public_source_display_label_versions (
  source_key,version,predecessor_version,display_label,created_at
) VALUES
  ('ajarn',1,NULL,'Ajarn','2026-07-22T00:00:00.000Z'),
  ('anesl',1,NULL,'ANESL','2026-07-22T00:00:00.000Z'),
  ('eslcafe-modern',1,NULL,'Dave''s ESL Cafe','2026-07-22T00:00:00.000Z'),
  ('seriousteachers',1,NULL,'Serious Teachers','2026-07-22T00:00:00.000Z'),
  ('tefl',1,NULL,'TEFL.com','2026-07-22T00:00:00.000Z');

INSERT INTO public_source_display_label_heads (
  source_key,current_version,updated_at
)
SELECT source_key,version,created_at
FROM public_source_display_label_versions;

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

-- A publication-policy version pins the display-label version used by every
-- decision that references it. This keeps detail attribution stable and makes
-- a label-head rotation fail closed until a successor policy and decision are
-- published.
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

INSERT INTO source_publication_policy_label_versions (
  source_key,policy_version,label_version,created_at
)
SELECT policy.source_key,policy.version,label.version,policy.created_at
FROM source_publication_policy_versions policy
JOIN public_source_display_label_versions label
  ON label.source_key=policy.source_key AND label.version=1;

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
  created_at TEXT NOT NULL,
  UNIQUE (search_index_version)
);

CREATE TABLE public_job_catalog_head_pointer (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1),
  current_version TEXT NOT NULL REFERENCES public_job_catalog_versions(version)
    ON DELETE RESTRICT,
  updated_at TEXT NOT NULL
);

INSERT INTO public_job_catalog_versions (
  version,predecessor_version,membership_hash,member_count,
  search_document_count,search_content_hash,search_term_count,
  location_facet_count,representation_updated_at,
  material_changed_at,search_index_version,created_at
) VALUES (
  'public-catalog-v0',NULL,
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  0,0,
  '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  0,0,
  '2026-07-22T00:00:00.000Z','2026-07-22T00:00:00.000Z',
  'public-search-v0','2026-07-22T00:00:00.000Z'
);

-- A seal is written only after all immutable catalog children have been
-- materialized. The activation trigger below verifies the seal and the exact
-- child relations in the same statement that advances the public head.
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

INSERT INTO public_job_catalog_seals (
  catalog_version,membership_hash,member_count,search_document_count,
  search_content_hash,search_term_count,location_facet_count,sealed_at
) VALUES (
  'public-catalog-v0',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  0,0,
  '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  0,0,'2026-07-22T00:00:00.000Z'
);

INSERT INTO public_job_catalog_head_pointer (
  singleton,current_version,updated_at
) VALUES (1,'public-catalog-v0','2026-07-22T00:00:00.000Z');

-- Activation seals a catalog forever. Writers materialize every member, search
-- row, and location facet before advancing the one head pointer.
CREATE TABLE public_job_catalog_head_history (
  catalog_version TEXT PRIMARY KEY REFERENCES public_job_catalog_versions(version)
    ON DELETE RESTRICT,
  activated_at TEXT NOT NULL
);

INSERT INTO public_job_catalog_head_history (catalog_version,activated_at)
VALUES ('public-catalog-v0','2026-07-22T00:00:00.000Z');

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
WHERE head.singleton=1;

CREATE TABLE public_job_catalog_members (
  catalog_version TEXT NOT NULL REFERENCES public_job_catalog_versions(version)
    ON DELETE RESTRICT,
  public_job_id TEXT NOT NULL,
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
  PRIMARY KEY (catalog_version,public_job_id),
  UNIQUE (catalog_version,public_job_id,public_job_version),
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT,
  FOREIGN KEY (public_job_id,eligibility_decision_version)
    REFERENCES public_job_eligibility_decisions(public_job_id,decision_version)
    ON DELETE RESTRICT
);

CREATE INDEX idx_public_job_catalog_members_job
  ON public_job_catalog_members(public_job_id,public_job_version,catalog_version);

CREATE TRIGGER trg_public_job_catalog_member_immutable_update
BEFORE UPDATE ON public_job_catalog_members
BEGIN
  SELECT RAISE(ABORT,'public job catalog members are immutable');
END;

CREATE TRIGGER trg_public_job_catalog_member_insert_before_head
BEFORE INSERT ON public_job_catalog_members
WHEN EXISTS (
  SELECT 1 FROM public_job_catalog_head_history history
  WHERE history.catalog_version=NEW.catalog_version
)
BEGIN
  SELECT RAISE(ABORT,'public job catalog members must precede activation');
END;

CREATE TRIGGER trg_public_job_catalog_member_immutable_delete
BEFORE DELETE ON public_job_catalog_members
BEGIN
  SELECT RAISE(ABORT,'public job catalog members are immutable');
END;

-- A source-policy rotation immediately advances to an empty catalog. The
-- projector later publishes a populated successor only after new decisions pin
-- the new policy. Existing cursors therefore become stale instead of observing
-- mutable policy results within one catalog version.
CREATE TRIGGER trg_policy_head_invalidate_public_catalog
AFTER UPDATE OF current_version ON source_publication_policy_heads
BEGIN
  INSERT INTO public_job_catalog_versions (
    version,predecessor_version,membership_hash,member_count,
    search_document_count,search_content_hash,search_term_count,
    location_facet_count,representation_updated_at,
    material_changed_at,search_index_version,created_at
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
    NEW.updated_at
  FROM public_job_catalog_head_pointer head
  WHERE head.singleton=1;

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
    material_changed_at,search_index_version,created_at
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
    NEW.updated_at
  FROM public_job_catalog_head_pointer head
  WHERE head.singleton=1;

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

-- The projection writer supplies NFKC case-folded title keys and one search
-- document for every browse member before advancing the catalog head.
CREATE TABLE public_job_search_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_job_id TEXT NOT NULL,
  public_job_version INTEGER NOT NULL CHECK (public_job_version > 0),
  search_index_version TEXT NOT NULL CHECK (trim(search_index_version)<>''),
  search_document TEXT NOT NULL CHECK (trim(search_document)<>''),
  search_terms_json TEXT NOT NULL CHECK (
    json_valid(search_terms_json) AND json_type(search_terms_json)='array'
    AND json_array_length(search_terms_json)>0
  ),
  title_sort_key TEXT NOT NULL CHECK (trim(title_sort_key)<>''),
  effective_recency TEXT NOT NULL CHECK (trim(effective_recency)<>''),
  conservative_hourly_usd REAL,
  created_at TEXT NOT NULL,
  UNIQUE (public_job_id,public_job_version,search_index_version),
  FOREIGN KEY (public_job_id,public_job_version)
    REFERENCES public_job_versions(public_job_id,version)
    ON DELETE RESTRICT
);

CREATE INDEX idx_public_job_search_recent
  ON public_job_search_index(
    search_index_version,effective_recency DESC,public_job_id
  );
CREATE INDEX idx_public_job_search_hourly
  ON public_job_search_index(
    search_index_version,conservative_hourly_usd DESC,
    effective_recency DESC,public_job_id
  );
CREATE INDEX idx_public_job_search_title
  ON public_job_search_index(
    search_index_version,title_sort_key,public_job_id
  );

CREATE TRIGGER trg_public_job_search_insert_before_activation
BEFORE INSERT ON public_job_search_index
WHEN EXISTS (
  SELECT 1
  FROM public_job_catalog_versions version
  JOIN public_job_catalog_head_history history
    ON history.catalog_version=version.version
  WHERE version.search_index_version=NEW.search_index_version
)
BEGIN
  SELECT RAISE(ABORT,'public job search rows must precede activation');
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

-- Search terms are an ordinary indexed relation rather than a mutable FTS
-- side table. The catalog seal pins their canonical source JSON and exact rows.
CREATE TABLE public_job_search_terms (
  search_index_version TEXT NOT NULL CHECK (trim(search_index_version)<>''),
  public_job_id TEXT NOT NULL,
  public_job_version INTEGER NOT NULL CHECK (public_job_version > 0),
  term TEXT NOT NULL CHECK (trim(term)<>''),
  score INTEGER NOT NULL CHECK (score > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (
    search_index_version,public_job_id,public_job_version,term
  ),
  FOREIGN KEY (public_job_id,public_job_version,search_index_version)
    REFERENCES public_job_search_index(
      public_job_id,public_job_version,search_index_version
    )
    ON DELETE RESTRICT
);

CREATE INDEX idx_public_job_search_terms_lookup
  ON public_job_search_terms(
    search_index_version,term,public_job_id,public_job_version
  );

CREATE TRIGGER trg_public_job_search_term_insert_before_activation
BEFORE INSERT ON public_job_search_terms
WHEN EXISTS (
  SELECT 1
  FROM public_job_catalog_versions version
  JOIN public_job_catalog_head_history history
    ON history.catalog_version=version.version
  WHERE version.search_index_version=NEW.search_index_version
)
BEGIN
  SELECT RAISE(ABORT,'public job search terms must precede activation');
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

CREATE TABLE public_browse_job_locations (
  catalog_version TEXT NOT NULL,
  public_job_id TEXT NOT NULL,
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
  PRIMARY KEY (catalog_version,public_job_id,public_job_version,ordinal),
  FOREIGN KEY (catalog_version,public_job_id,public_job_version)
    REFERENCES public_job_catalog_members(
      catalog_version,public_job_id,public_job_version
    )
    ON DELETE RESTRICT,
  CHECK (city_slug IS NULL OR trim(city_slug)<>'')
);

CREATE INDEX idx_public_browse_locations_country
  ON public_browse_job_locations(
    catalog_version,country_code,location_role,public_job_id,public_job_version
  );
CREATE INDEX idx_public_browse_locations_city
  ON public_browse_job_locations(
    catalog_version,country_code,city_slug,location_role,
    public_job_id,public_job_version
  ) WHERE city_slug IS NOT NULL;

CREATE TRIGGER trg_public_browse_location_insert_before_activation
BEFORE INSERT ON public_browse_job_locations
WHEN EXISTS (
  SELECT 1 FROM public_job_catalog_head_history history
  WHERE history.catalog_version=NEW.catalog_version
)
BEGIN
  SELECT RAISE(ABORT,'public browse location facets must precede activation');
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

DROP VIEW public_job_route_resolutions;
DROP VIEW job_posting_jobs;
DROP VIEW organic_index_jobs;
DROP VIEW public_browse_jobs;
DROP VIEW public_job_route_content;

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
GROUP BY public_job_id,decision_version;

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
  );

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
FROM items;

CREATE VIEW public_browse_jobs AS
SELECT
  member.catalog_version,
  member.public_job_id,
  member.public_job_version,
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
JOIN public_job_catalog_members member
  ON member.catalog_version=head.current_version
WHERE head.singleton=1;

CREATE VIEW organic_index_jobs AS
SELECT browse.*
FROM public_browse_jobs browse
JOIN public_job_route_content content
  ON content.public_job_id=browse.public_job_id
 AND content.public_job_version=browse.public_job_version
WHERE content.publication_state='published'
  AND content.browse_eligible=1
  AND content.organic_index_eligible=1;

CREATE VIEW job_posting_jobs AS
SELECT organic.*
FROM organic_index_jobs organic
JOIN public_job_route_content content
  ON content.public_job_id=organic.public_job_id
 AND content.public_job_version=organic.public_job_version
WHERE content.job_posting_eligible=1
  AND content.date_posted IS NOT NULL
  AND content.date_posted_provenance='employer-original';

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
  COALESCE(
    current_member.catalog_version,historical_member.catalog_version
  ) AS content_catalog_version,
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
LEFT JOIN public_job_catalog_members current_member
  ON current_member.catalog_version=catalog_head.current_version
 AND current_member.public_job_id=decision.public_job_id
LEFT JOIN public_job_catalog_members historical_member
  ON historical_member.public_job_id=decision.public_job_id
 AND historical_member.catalog_version=(
   SELECT history.catalog_version
   FROM public_job_catalog_head_history history
   JOIN public_job_catalog_members member
     ON member.catalog_version=history.catalog_version
    AND member.public_job_id=decision.public_job_id
   ORDER BY history.activated_at DESC,history.catalog_version DESC
   LIMIT 1
 );

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
FROM gone;

-- The head update is the sole exposure point. These checks execute in that
-- update statement and prove that its immutable seal describes the complete
-- catalog, one immutable search document per member, exact location facets,
-- and the current approved canonical list payload.
CREATE TRIGGER trg_public_job_catalog_head_advance
BEFORE UPDATE ON public_job_catalog_head_pointer
BEGIN
  SELECT CASE WHEN NEW.singleton<>OLD.singleton
    THEN RAISE(ABORT,'public job catalog head identity is immutable') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public_job_catalog_versions version
    WHERE version.version=NEW.current_version
      AND version.predecessor_version=OLD.current_version
  ) THEN RAISE(ABORT,'public job catalog head successor is invalid') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_job_catalog_head_history history
    WHERE history.catalog_version=NEW.current_version
  ) THEN RAISE(ABORT,'public job catalog version was already activated') END;
  SELECT CASE WHEN NOT EXISTS (
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
      )
  ) THEN RAISE(ABORT,'public job catalog seal does not match version') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM public_job_catalog_members member
    WHERE member.catalog_version=NEW.current_version
  )<>(
    SELECT seal.member_count FROM public_job_catalog_seals seal
    WHERE seal.catalog_version=NEW.current_version
  ) THEN RAISE(ABORT,'public job catalog member count does not match seal') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM public_job_catalog_members member
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
    WHERE member.catalog_version=NEW.current_version
      AND candidate.public_job_id IS NULL
  ) THEN RAISE(ABORT,'public job catalog payload identity is invalid') END;
  SELECT CASE WHEN (
    SELECT COUNT(*)
    FROM public_job_search_index search
    JOIN public_job_catalog_versions version
      ON version.search_index_version=search.search_index_version
    WHERE version.version=NEW.current_version
  )<>(
    SELECT seal.search_document_count FROM public_job_catalog_seals seal
    WHERE seal.catalog_version=NEW.current_version
  ) THEN RAISE(ABORT,'public job search count does not match seal') END;
  SELECT CASE WHEN (
    SELECT COUNT(*)
    FROM public_job_search_terms term
    JOIN public_job_catalog_versions version
      ON version.search_index_version=term.search_index_version
    WHERE version.version=NEW.current_version
  )<>(
    SELECT seal.search_term_count FROM public_job_catalog_seals seal
    WHERE seal.catalog_version=NEW.current_version
  ) THEN RAISE(ABORT,'public job search term count does not match seal') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM public_job_catalog_members member
    JOIN public_job_catalog_versions version
      ON version.version=member.catalog_version
    LEFT JOIN public_job_search_index search
      ON search.public_job_id=member.public_job_id
     AND search.public_job_version=member.public_job_version
     AND search.search_index_version=version.search_index_version
    WHERE member.catalog_version=NEW.current_version
      AND search.id IS NULL
  ) THEN RAISE(ABORT,'public job catalog member has no search document') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM public_job_search_index search
    JOIN public_job_catalog_versions version
      ON version.search_index_version=search.search_index_version
    LEFT JOIN public_job_catalog_members member
      ON member.catalog_version=version.version
     AND member.public_job_id=search.public_job_id
     AND member.public_job_version=search.public_job_version
    WHERE version.version=NEW.current_version
      AND member.public_job_id IS NULL
  ) THEN RAISE(ABORT,'public job search document has no catalog member') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM public_job_search_index search
    JOIN public_job_catalog_versions version
      ON version.search_index_version=search.search_index_version
    JOIN json_each(search.search_terms_json) expected
    LEFT JOIN public_job_search_terms term
      ON term.search_index_version=search.search_index_version
     AND term.public_job_id=search.public_job_id
     AND term.public_job_version=search.public_job_version
     AND term.term=json_extract(expected.value,'$.term')
     AND term.score=json_extract(expected.value,'$.score')
    WHERE version.version=NEW.current_version
    GROUP BY search.id
    HAVING COUNT(expected.key)<>COUNT(term.term)
       OR COUNT(expected.key)<>(
         SELECT COUNT(*) FROM public_job_search_terms all_terms
         WHERE all_terms.search_index_version=search.search_index_version
           AND all_terms.public_job_id=search.public_job_id
           AND all_terms.public_job_version=search.public_job_version
       )
  ) THEN RAISE(ABORT,'public job search terms do not match search row') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM public_browse_job_locations facet
    WHERE facet.catalog_version=NEW.current_version
  )<>(
    SELECT seal.location_facet_count FROM public_job_catalog_seals seal
    WHERE seal.catalog_version=NEW.current_version
  ) THEN RAISE(ABORT,'public job location facet count does not match seal') END;
  SELECT CASE WHEN (
    SELECT COALESCE(SUM(json_array_length(member.item_json,'$.locations')),0)
    FROM public_job_catalog_members member
    WHERE member.catalog_version=NEW.current_version
  )<>(
    SELECT seal.location_facet_count FROM public_job_catalog_seals seal
    WHERE seal.catalog_version=NEW.current_version
  ) THEN RAISE(ABORT,'public job location payload count does not match seal') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public_job_catalog_members member
    WHERE member.catalog_version=NEW.current_version
      AND json_array_length(member.location_facets_json)<>
          json_array_length(member.item_json,'$.locations')
  ) THEN RAISE(ABORT,'public job location routing count does not match payload') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM public_browse_job_locations facet
    JOIN public_job_catalog_members member
      ON member.catalog_version=facet.catalog_version
     AND member.public_job_id=facet.public_job_id
     AND member.public_job_version=facet.public_job_version
    LEFT JOIN json_each(member.item_json,'$.locations') location
      ON CAST(location.key AS INTEGER)=facet.ordinal
     AND json_extract(location.value,'$.countryCode')=facet.country_code
     AND json_extract(location.value,'$.displayName')=facet.display_name
     AND CASE json_extract(location.value,'$.role')
       WHEN 'applicantArea' THEN 'applicant_area' ELSE 'worksite' END=
       facet.location_role
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
    WHERE facet.catalog_version=NEW.current_version
      AND (
        location.key IS NULL OR routing.key IS NULL
        OR snapshot.public_job_id IS NULL
      )
  ) THEN RAISE(ABORT,'public job location facets do not match payload') END;
END;
