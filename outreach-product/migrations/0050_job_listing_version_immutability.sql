-- Listing material versions are immutable historical snapshots. Inventory
-- changes append a successor and then advance the mutable job_listings head.

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
