import { JOB_CONTENT_ANALYSIS_SCHEMA_VERSION } from "../../../src/features/jobs/content-analysis";
import { JOB_POSITION_ANALYSIS_SCHEMA_VERSION } from "../../../src/features/jobs/position-variants";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../../src/features/matching/version";

interface AwakenedRunRow {
  run_id: string;
}

export async function awakenProjectionWaitersForListing(
  db: D1Database,
  listingId: string,
  timestamp = new Date().toISOString()
) {
  const result = await db
    .prepare(
      `UPDATE public_projection_listing_items
          SET status='queued',error_code='',error_detail='',updated_at=?
        WHERE listing_id=? AND status='waiting_analysis'
          AND stage IN ('prerequisites','source_positions')
          AND EXISTS (
            SELECT 1 FROM job_match_facts facts
             WHERE facts.job_id=public_projection_listing_items.listing_id
               AND facts.schema_version=?
               AND facts.source_hash=json_extract(
                 public_projection_listing_items.checkpoint_json,
                 '$.analyses.matchFacts.expectedSourceHash'
               )
          )
          AND EXISTS (
            SELECT 1 FROM job_content_analyses content
             WHERE content.job_id=public_projection_listing_items.listing_id
               AND content.schema_version=?
               AND content.source_hash=json_extract(
                 public_projection_listing_items.checkpoint_json,
                 '$.analyses.content.expectedSourceHash'
               )
          )
          AND EXISTS (
            SELECT 1 FROM job_position_analyses position
             WHERE position.job_id=public_projection_listing_items.listing_id
               AND position.schema_version=?
               AND position.source_hash=json_extract(
                 public_projection_listing_items.checkpoint_json,
                 '$.analyses.position.expectedSourceHash'
               )
          )
        RETURNING run_id`
    )
    .bind(
      timestamp,
      listingId,
      JOB_MATCH_FACTS_SCHEMA_VERSION,
      JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
      JOB_POSITION_ANALYSIS_SCHEMA_VERSION
    )
    .all<AwakenedRunRow>();
  return [...new Set(result.results.map((row) => row.run_id))];
}
