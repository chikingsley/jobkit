PRAGMA defer_foreign_keys = ON;

ALTER TABLE jobs RENAME TO job_listings;
ALTER TABLE user_jobs RENAME TO user_listing_states;

DROP INDEX idx_user_jobs_user_status_priority;
DROP INDEX idx_user_jobs_job;
DROP INDEX idx_jobs_inventory_source_status;

CREATE INDEX idx_user_listing_states_user_status_priority
  ON user_listing_states(user_id,status,priority DESC,updated_at DESC);
CREATE INDEX idx_user_listing_states_listing
  ON user_listing_states(job_id);
CREATE INDEX idx_job_listings_inventory_source_status
  ON job_listings(inventory_source_id,inventory_status,source_last_seen_at DESC);

PRAGMA defer_foreign_keys = OFF;
