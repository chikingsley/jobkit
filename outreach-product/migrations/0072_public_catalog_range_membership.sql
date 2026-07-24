-- PUBLIC-CATALOG-002: version-range catalog membership.
--
-- Catalog membership moves from per-version row copies to spans. Each member
-- row carries valid_from_ordinal and valid_to_ordinal over the new integer
-- ordinal on public_job_catalog_versions; NULL valid_to_ordinal means the row
-- is current. Search documents, search terms, and browse location facets key
-- off the owning member span, so a promotion writes only the changed member
-- and closes the span it supersedes. Reads at version V select
-- valid_from_ordinal<=V AND (valid_to_ordinal IS NULL OR valid_to_ordinal>V).
--
-- The conversion below rebuilds spans from the activated catalog history.
-- Partially staged copies belonging to never-activated catalog versions are
-- dropped: they were unreachable by reads and existed only as residue of the
-- superseded chunked staging flow. CHECK-constraint assertions abort the
-- migration if the converted head state disagrees with the sealed counts.

DROP VIEW public_job_route_resolutions;
DROP VIEW public_job_route_inputs;
DROP VIEW job_posting_jobs;
DROP VIEW organic_index_jobs;
DROP VIEW public_browse_jobs;

DROP TRIGGER trg_public_catalog_google_indexing_events;
DROP TRIGGER trg_policy_head_invalidate_public_catalog;
DROP TRIGGER trg_source_label_head_invalidate_public_catalog;
DROP TRIGGER trg_public_job_catalog_head_advance;
DROP TRIGGER trg_public_job_catalog_version_immutable_update;
DROP TRIGGER trg_public_job_catalog_version_immutable_delete;

ALTER TABLE public_job_catalog_versions ADD COLUMN ordinal INTEGER;

-- Activation history rows are append-only, so their insertion order is the
-- authoritative activation order even when activated_at values tie.
UPDATE public_job_catalog_versions SET ordinal=(
  SELECT COUNT(*)
  FROM public_job_catalog_head_history other
  JOIN public_job_catalog_head_history mine
    ON mine.catalog_version=public_job_catalog_versions.version
  WHERE other.rowid<=mine.rowid
)
WHERE version IN (
  SELECT catalog_version FROM public_job_catalog_head_history
);

UPDATE public_job_catalog_versions SET ordinal=(
  (SELECT COUNT(*) FROM public_job_catalog_head_history)
  + (SELECT COUNT(*)
     FROM public_job_catalog_versions other
     WHERE other.version NOT IN (
       SELECT catalog_version FROM public_job_catalog_head_history
     )
       AND (other.created_at<public_job_catalog_versions.created_at
         OR (other.created_at=public_job_catalog_versions.created_at
             AND other.version<=public_job_catalog_versions.version)))
)
WHERE version NOT IN (
  SELECT catalog_version FROM public_job_catalog_head_history
);

CREATE UNIQUE INDEX idx_public_job_catalog_versions_ordinal
  ON public_job_catalog_versions(ordinal);

INSERT INTO public_projection_final_assertions (
  expected_changes,actual_changes
) SELECT 0,(
  SELECT COUNT(*) FROM public_job_catalog_versions WHERE ordinal IS NULL
);

INSERT INTO public_projection_final_assertions (
  expected_changes,actual_changes
) SELECT 1,(
  SELECT COUNT(*)
  FROM public_job_catalog_head_pointer pointer
  JOIN public_job_catalog_versions version
    ON version.version=pointer.current_version
  WHERE pointer.singleton=1
    AND version.ordinal=(
      SELECT MAX(activated.ordinal)
      FROM public_job_catalog_versions activated
      JOIN public_job_catalog_head_history history
        ON history.catalog_version=activated.version
    )
);

CREATE TABLE pjc_migration_activated AS
SELECT
  version.version AS catalog_version,
  version.ordinal AS catalog_ordinal,
  ROW_NUMBER() OVER (ORDER BY version.ordinal) AS catalog_seq
FROM public_job_catalog_head_history history
JOIN public_job_catalog_versions version
  ON version.version=history.catalog_version;

CREATE TABLE pjc_migration_members AS
SELECT
  activated.catalog_seq,
  activated.catalog_ordinal,
  member.public_job_id,
  member.public_job_version,
  member.eligibility_decision_version,
  member.item_json,
  member.detail_json,
  member.public_content_hash,
  member.eligibility_decision_hash,
  member.location_facets_json,
  member.representation_updated_at,
  member.created_at
FROM public_job_catalog_members member
JOIN pjc_migration_activated activated
  ON activated.catalog_version=member.catalog_version;

CREATE TABLE pjc_migration_search AS
SELECT
  activated.catalog_ordinal,
  search.public_job_id,
  search.public_job_version,
  search.search_document,
  search.search_terms_json,
  search.title_sort_key,
  search.effective_recency,
  search.conservative_hourly_usd,
  search.created_at
FROM public_job_search_index search
JOIN public_job_catalog_versions version
  ON version.search_index_version=search.search_index_version
JOIN pjc_migration_activated activated
  ON activated.catalog_version=version.version;

CREATE TABLE pjc_migration_terms AS
SELECT
  activated.catalog_ordinal,
  term.public_job_id,
  term.public_job_version,
  term.term,
  term.score,
  term.created_at
FROM public_job_search_terms term
JOIN public_job_catalog_versions version
  ON version.search_index_version=term.search_index_version
JOIN pjc_migration_activated activated
  ON activated.catalog_version=version.version;

CREATE TABLE pjc_migration_facets AS
SELECT
  activated.catalog_ordinal,
  facet.public_job_id,
  facet.public_job_version,
  facet.ordinal,
  facet.location_role,
  facet.country_code,
  facet.country_slug,
  facet.city_slug,
  facet.display_name,
  facet.created_at
FROM public_browse_job_locations facet
JOIN pjc_migration_activated activated
  ON activated.catalog_version=facet.catalog_version;

DROP TABLE public_browse_job_locations;
DROP TABLE public_job_search_terms;
DROP TABLE public_job_search_index;
DROP TABLE public_job_catalog_members;

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

CREATE INDEX idx_public_job_catalog_members_open
  ON public_job_catalog_members(public_job_id)
  WHERE valid_to_ordinal IS NULL;
CREATE INDEX idx_public_job_catalog_members_closed
  ON public_job_catalog_members(valid_to_ordinal)
  WHERE valid_to_ordinal IS NOT NULL;
CREATE INDEX idx_public_job_catalog_members_from
  ON public_job_catalog_members(valid_from_ordinal);

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

CREATE INDEX idx_public_job_search_recent
  ON public_job_search_index(effective_recency DESC,public_job_id);
CREATE INDEX idx_public_job_search_hourly
  ON public_job_search_index(
    conservative_hourly_usd DESC,effective_recency DESC,public_job_id
  );
CREATE INDEX idx_public_job_search_title
  ON public_job_search_index(title_sort_key,public_job_id);

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

CREATE INDEX idx_public_job_search_terms_lookup
  ON public_job_search_terms(term,public_job_id,valid_from_ordinal);

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

INSERT INTO public_job_catalog_members (
  public_job_id,valid_from_ordinal,valid_to_ordinal,public_job_version,
  eligibility_decision_version,item_json,detail_json,public_content_hash,
  eligibility_decision_hash,location_facets_json,representation_updated_at,
  created_at
)
SELECT
  current.public_job_id,
  current.catalog_ordinal,
  (SELECT MIN(later.catalog_ordinal)
   FROM pjc_migration_activated later
   WHERE later.catalog_seq>current.catalog_seq
     AND NOT EXISTS (
       SELECT 1 FROM pjc_migration_members same
       WHERE same.catalog_seq=later.catalog_seq
         AND same.public_job_id=current.public_job_id
         AND same.public_job_version=current.public_job_version
         AND same.eligibility_decision_version=
             current.eligibility_decision_version
         AND same.item_json=current.item_json
         AND same.detail_json=current.detail_json
         AND same.public_content_hash=current.public_content_hash
         AND same.eligibility_decision_hash=current.eligibility_decision_hash
         AND same.location_facets_json=current.location_facets_json
         AND same.representation_updated_at=current.representation_updated_at
     )),
  current.public_job_version,
  current.eligibility_decision_version,
  current.item_json,
  current.detail_json,
  current.public_content_hash,
  current.eligibility_decision_hash,
  current.location_facets_json,
  current.representation_updated_at,
  current.created_at
FROM pjc_migration_members current
WHERE NOT EXISTS (
  SELECT 1 FROM pjc_migration_members previous
  WHERE previous.catalog_seq=current.catalog_seq-1
    AND previous.public_job_id=current.public_job_id
    AND previous.public_job_version=current.public_job_version
    AND previous.eligibility_decision_version=
        current.eligibility_decision_version
    AND previous.item_json=current.item_json
    AND previous.detail_json=current.detail_json
    AND previous.public_content_hash=current.public_content_hash
    AND previous.eligibility_decision_hash=current.eligibility_decision_hash
    AND previous.location_facets_json=current.location_facets_json
    AND previous.representation_updated_at=current.representation_updated_at
);

INSERT INTO public_job_search_index (
  public_job_id,valid_from_ordinal,public_job_version,search_document,
  search_terms_json,title_sort_key,effective_recency,conservative_hourly_usd,
  created_at
)
SELECT
  span.public_job_id,
  span.valid_from_ordinal,
  span.public_job_version,
  search.search_document,
  search.search_terms_json,
  search.title_sort_key,
  search.effective_recency,
  search.conservative_hourly_usd,
  search.created_at
FROM public_job_catalog_members span
JOIN pjc_migration_search search
  ON search.catalog_ordinal=span.valid_from_ordinal
 AND search.public_job_id=span.public_job_id;

INSERT INTO public_job_search_terms (
  public_job_id,valid_from_ordinal,public_job_version,term,score,created_at
)
SELECT
  span.public_job_id,
  span.valid_from_ordinal,
  span.public_job_version,
  term.term,
  term.score,
  term.created_at
FROM public_job_catalog_members span
JOIN pjc_migration_terms term
  ON term.catalog_ordinal=span.valid_from_ordinal
 AND term.public_job_id=span.public_job_id;

INSERT INTO public_browse_job_locations (
  public_job_id,valid_from_ordinal,public_job_version,ordinal,location_role,
  country_code,country_slug,city_slug,display_name,created_at
)
SELECT
  span.public_job_id,
  span.valid_from_ordinal,
  span.public_job_version,
  facet.ordinal,
  facet.location_role,
  facet.country_code,
  facet.country_slug,
  facet.city_slug,
  facet.display_name,
  facet.created_at
FROM public_job_catalog_members span
JOIN pjc_migration_facets facet
  ON facet.catalog_ordinal=span.valid_from_ordinal
 AND facet.public_job_id=span.public_job_id;

-- The converted head state must match the immutable head version counts.
INSERT INTO public_projection_final_assertions (
  expected_changes,actual_changes
) SELECT
  (SELECT version.member_count
   FROM public_job_catalog_head_pointer pointer
   JOIN public_job_catalog_versions version
     ON version.version=pointer.current_version
   WHERE pointer.singleton=1),
  (SELECT COUNT(*)
   FROM public_job_catalog_head_pointer pointer
   JOIN public_job_catalog_versions version
     ON version.version=pointer.current_version
   JOIN public_job_catalog_members member
     ON member.valid_from_ordinal<=version.ordinal
    AND (member.valid_to_ordinal IS NULL
      OR member.valid_to_ordinal>version.ordinal)
   WHERE pointer.singleton=1);

INSERT INTO public_projection_final_assertions (
  expected_changes,actual_changes
) SELECT
  (SELECT version.search_document_count
   FROM public_job_catalog_head_pointer pointer
   JOIN public_job_catalog_versions version
     ON version.version=pointer.current_version
   WHERE pointer.singleton=1),
  (SELECT COUNT(*)
   FROM public_job_catalog_head_pointer pointer
   JOIN public_job_catalog_versions version
     ON version.version=pointer.current_version
   JOIN public_job_catalog_members member
     ON member.valid_from_ordinal<=version.ordinal
    AND (member.valid_to_ordinal IS NULL
      OR member.valid_to_ordinal>version.ordinal)
   JOIN public_job_search_index search
     ON search.public_job_id=member.public_job_id
    AND search.valid_from_ordinal=member.valid_from_ordinal
   WHERE pointer.singleton=1);

INSERT INTO public_projection_final_assertions (
  expected_changes,actual_changes
) SELECT
  (SELECT version.search_term_count
   FROM public_job_catalog_head_pointer pointer
   JOIN public_job_catalog_versions version
     ON version.version=pointer.current_version
   WHERE pointer.singleton=1),
  (SELECT COUNT(*)
   FROM public_job_catalog_head_pointer pointer
   JOIN public_job_catalog_versions version
     ON version.version=pointer.current_version
   JOIN public_job_catalog_members member
     ON member.valid_from_ordinal<=version.ordinal
    AND (member.valid_to_ordinal IS NULL
      OR member.valid_to_ordinal>version.ordinal)
   JOIN public_job_search_terms term
     ON term.public_job_id=member.public_job_id
    AND term.valid_from_ordinal=member.valid_from_ordinal
   WHERE pointer.singleton=1);

INSERT INTO public_projection_final_assertions (
  expected_changes,actual_changes
) SELECT
  (SELECT version.location_facet_count
   FROM public_job_catalog_head_pointer pointer
   JOIN public_job_catalog_versions version
     ON version.version=pointer.current_version
   WHERE pointer.singleton=1),
  (SELECT COUNT(*)
   FROM public_job_catalog_head_pointer pointer
   JOIN public_job_catalog_versions version
     ON version.version=pointer.current_version
   JOIN public_job_catalog_members member
     ON member.valid_from_ordinal<=version.ordinal
    AND (member.valid_to_ordinal IS NULL
      OR member.valid_to_ordinal>version.ordinal)
   JOIN public_browse_job_locations facet
     ON facet.public_job_id=member.public_job_id
    AND facet.valid_from_ordinal=member.valid_from_ordinal
   WHERE pointer.singleton=1);

DROP TABLE pjc_migration_facets;
DROP TABLE pjc_migration_terms;
DROP TABLE pjc_migration_search;
DROP TABLE pjc_migration_members;
DROP TABLE pjc_migration_activated;

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

-- The one sanctioned mutation: closing an open span at a not-yet-activated
-- catalog version. Every other column must stay byte-identical.
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

-- The head update remains the sole exposure point. Every check runs inside
-- the update statement over the span membership at the successor version.
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

-- A source-policy rotation immediately advances to an empty catalog by
-- closing every open member span at the invalidation version.
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

-- Google indexing events derive from the spans a promotion opened or closed
-- at the activated version, so the outbox write stays O(changed members).
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
    AND version.date_posted_provenance='employer-original'
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
    AND version.date_posted_provenance='employer-original'
    AND current.public_job_id IS NULL;
END;

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
   OR historical_member.valid_to_ordinal>historical_version.ordinal);

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
