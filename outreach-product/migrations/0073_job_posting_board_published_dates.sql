-- SEO-DATEPOSTED-001: the JobPosting gates required the reserved
-- 'employer-original' provenance that no source evidence produces. The
-- source board's own listed posting date is the employer-visible posting
-- date on that board, recorded honestly as 'board-published'. The gates now
-- accept either provenance; the stored provenance value stays truthful.

DROP VIEW job_posting_jobs;

CREATE VIEW job_posting_jobs AS
SELECT organic.*
FROM organic_index_jobs organic
JOIN public_job_route_content content
  ON content.public_job_id=organic.public_job_id
 AND content.public_job_version=organic.public_job_version
WHERE content.job_posting_eligible=1
  AND content.date_posted IS NOT NULL
  AND content.date_posted_provenance IN ('employer-original','board-published');

DROP TRIGGER trg_public_catalog_google_indexing_events;

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
