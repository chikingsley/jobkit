-- SEARCH-LAUNCH-001: approve JobKit-authored fact summaries for the two
-- reviewed public boards and add a durable Google job-indexing outbox.

INSERT INTO source_publication_policy_versions (
  source_key,version,predecessor_version,approval_state,publication_scope,
  publication_enabled,allowed_fields_json,attribution_mode,
  max_verbatim_chars,source_origin_url,terms_url,terms_checked_at,robots_url,
  robots_checked_at,evidence_json,decision_note,policy_hash,idempotency_key,
  created_at
) VALUES
  (
    'eslcafe-modern',2,1,'approved','fact_summary',1,
    '["title","organization_name","locations","date_posted","valid_through","employment_types","compensation","description","source_name","source_url"]',
    'source_link',0,'https://www.eslcafe.com/',
    'https://www.eslcafe.com/terms','2026-07-23',
    'https://www.eslcafe.com/robots.txt','2026-07-23',
    '{"approvedBy":"product-owner","basis":"JobKit-authored factual summary with source attribution and private contact redaction","reviewedAt":"2026-07-23","verbatimPolicy":"none"}',
    'Publish JobKit-authored factual summaries with source attribution. Source text and private contact destinations remain private.',
    '8ea201d8d35756252e8c343c405d82e2c5e2ef8663b9c79748f78d402d98969f',
    'search-launch-v2','2026-07-23T10:15:00.000Z'
  ),
  (
    'seriousteachers',2,1,'approved','fact_summary',1,
    '["title","organization_name","locations","date_posted","valid_through","employment_types","compensation","description","source_name","source_url"]',
    'source_link',0,'https://www.seriousteachers.com/',
    'https://www.seriousteachers.com/shared/terms_use','2026-07-23',
    'https://www.seriousteachers.com/robots.txt','2026-07-23',
    '{"approvedBy":"product-owner","basis":"JobKit-authored factual summary with source attribution and private contact redaction","reviewedAt":"2026-07-23","verbatimPolicy":"none"}',
    'Publish JobKit-authored factual summaries with source attribution. Source text and private contact destinations remain private.',
    'd0ed179914dfe617a8439903cf0ff4b1e90899744029c6a872fc5cc23f8fde49',
    'search-launch-v2','2026-07-23T10:15:00.000Z'
  );

UPDATE source_publication_policy_heads
SET current_version=2,updated_at='2026-07-23T10:15:00.000Z'
WHERE source_key='eslcafe-modern' AND current_version=1;

UPDATE source_publication_policy_heads
SET current_version=2,updated_at='2026-07-23T10:15:00.001Z'
WHERE source_key='seriousteachers' AND current_version=1;

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

CREATE INDEX idx_google_indexing_events_claim
  ON google_indexing_events(status,next_attempt_at,created_at,id);

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
  FROM public_job_catalog_members current
  JOIN public_job_eligibility_decisions decision
    ON decision.public_job_id=current.public_job_id
   AND decision.decision_version=current.eligibility_decision_version
  JOIN public_job_versions version
    ON version.public_job_id=current.public_job_id
   AND version.version=current.public_job_version
  LEFT JOIN public_job_catalog_members previous
    ON previous.catalog_version=OLD.current_version
   AND previous.public_job_id=current.public_job_id
  WHERE current.catalog_version=NEW.current_version
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
  FROM public_job_catalog_members previous
  JOIN public_job_eligibility_decisions decision
    ON decision.public_job_id=previous.public_job_id
   AND decision.decision_version=previous.eligibility_decision_version
  JOIN public_job_versions version
    ON version.public_job_id=previous.public_job_id
   AND version.version=previous.public_job_version
  LEFT JOIN public_job_catalog_members current
    ON current.catalog_version=NEW.current_version
   AND current.public_job_id=previous.public_job_id
  WHERE previous.catalog_version=OLD.current_version
    AND decision.job_posting_eligible=1
    AND version.date_posted IS NOT NULL
    AND version.date_posted_provenance='employer-original'
    AND current.public_job_id IS NULL;
END;
