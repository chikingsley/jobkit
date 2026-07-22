ALTER TABLE job_listings ADD COLUMN source_posted_date TEXT;
ALTER TABLE job_listings ADD COLUMN source_posted_date_raw TEXT NOT NULL
  DEFAULT '';
ALTER TABLE job_listings ADD COLUMN source_posted_date_provenance TEXT NOT NULL
  DEFAULT 'unknown'
  CHECK (source_posted_date_provenance IN (
    'board-published','unresolved','unknown'
  ));
ALTER TABLE job_listings ADD COLUMN source_expiry_date TEXT;
ALTER TABLE job_listings ADD COLUMN source_expiry_date_raw TEXT NOT NULL
  DEFAULT '';
ALTER TABLE job_listings ADD COLUMN source_expiry_date_provenance TEXT NOT NULL
  DEFAULT 'unknown'
  CHECK (source_expiry_date_provenance IN (
    'board-published','unresolved','unknown'
  ));
ALTER TABLE job_listings ADD COLUMN material_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE job_listings ADD COLUMN material_hash_version INTEGER NOT NULL
  DEFAULT 0 CHECK (material_hash_version >= 0);
ALTER TABLE job_listings ADD COLUMN material_version INTEGER NOT NULL
  DEFAULT 1 CHECK (material_version > 0);
ALTER TABLE job_listings ADD COLUMN material_changed_at TEXT NOT NULL
  DEFAULT '';

UPDATE job_listings
SET material_hash=source_content_hash,
    material_changed_at=updated_at
WHERE material_hash='';

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

CREATE INDEX idx_job_listing_versions_material_hash
  ON job_listing_versions(material_hash_version,material_hash);
CREATE INDEX idx_job_listings_source_posted_date
  ON job_listings(source_posted_date DESC);

-- Version zero identifies the legacy full-envelope hash algorithm. The NULL
-- material_json makes explicit that this hash is not a v1 material projection.
INSERT INTO job_listing_versions (
  listing_id,material_version,material_hash,material_hash_version,material_json,
  source_posted_date,source_posted_date_raw,source_posted_date_provenance,
  source_expiry_date,source_expiry_date_raw,source_expiry_date_provenance,
  inventory_run_id,created_at
)
SELECT id,material_version,source_content_hash,0,NULL,
       source_posted_date,source_posted_date_raw,source_posted_date_provenance,
       source_expiry_date,source_expiry_date_raw,source_expiry_date_provenance,
       inventory_run_id,material_changed_at
FROM job_listings;
