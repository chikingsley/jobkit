import { canonicalJson } from "./hash";
import type { ExactProjectionListingSnapshot } from "./listing-snapshot";
import type { ProjectionAnalysisGuard } from "./prerequisites";

export const EXACT_PROJECTION_ANALYSIS_GUARD_SQL = `
  AND EXISTS (
      SELECT 1 FROM job_listings listing
      JOIN job_listing_versions version
        ON version.listing_id=listing.id
       AND version.material_version=?
      WHERE listing.id=? AND listing.board=?
        AND listing.material_version=?
        AND listing.material_hash=?
        AND listing.material_hash_version=1
        AND version.material_hash=?
        AND version.material_hash_version=1
        AND version.material_json=?
    )
  AND EXISTS (
      SELECT 1 FROM job_match_facts analysis
      WHERE analysis.job_id=? AND analysis.schema_version=?
        AND analysis.source_hash=? AND analysis.model_provider=?
        AND analysis.model_id=? AND analysis.updated_at=?
        AND analysis.facts_json=?
    )
  AND EXISTS (
      SELECT 1 FROM job_content_analyses analysis
      WHERE analysis.job_id=? AND analysis.schema_version=?
        AND analysis.source_hash=? AND analysis.model_provider=?
        AND analysis.model_id=? AND analysis.updated_at=?
        AND analysis.content_json=?
    )
  AND EXISTS (
      SELECT 1 FROM job_position_analyses analysis
      WHERE analysis.job_id=? AND analysis.scope=?
        AND analysis.review_notes_json=?
        AND analysis.schema_version=? AND analysis.source_hash=?
        AND analysis.model_provider=? AND analysis.model_id=?
        AND analysis.updated_at=?
    )
  AND (
      SELECT COUNT(*) FROM job_position_variants variant
       WHERE variant.job_id=?
    )=?
  AND NOT EXISTS (
      SELECT 1 FROM json_each(?) expected
      LEFT JOIN job_position_variants variant
        ON variant.job_id=?
       AND variant.ordinal=json_extract(expected.value,'$.ordinal')
      WHERE variant.id IS NULL
         OR variant.title IS NOT json_extract(expected.value,'$.title')
         OR variant.role_family IS NOT
              json_extract(expected.value,'$.role_family')
         OR variant.subjects_json IS NOT
              json_extract(expected.value,'$.subjects_json')
         OR variant.locations_json IS NOT
              json_extract(expected.value,'$.locations_json')
         OR variant.audiences_json IS NOT
              json_extract(expected.value,'$.audiences_json')
         OR variant.employment_types_json IS NOT
              json_extract(expected.value,'$.employment_types_json')
         OR variant.requirements_json IS NOT
              json_extract(expected.value,'$.requirements_json')
         OR variant.evidence_json IS NOT
              json_extract(expected.value,'$.evidence_json')
         OR variant.compensation_evidence_json IS NOT
              json_extract(expected.value,'$.compensation_evidence_json')
         OR variant.certainty IS NOT
              json_extract(expected.value,'$.certainty')
    )`;

export function exactProjectionAnalysisGuardBindings(
  snapshot: ExactProjectionListingSnapshot,
  guard: ProjectionAnalysisGuard
) {
  return [
    snapshot.materialVersion,
    snapshot.listingId,
    snapshot.board,
    snapshot.materialVersion,
    snapshot.materialHash,
    snapshot.materialHash,
    snapshot.materialJson,
    snapshot.listingId,
    guard.matchFacts.schema_version,
    guard.matchFacts.source_hash,
    guard.matchFacts.model_provider,
    guard.matchFacts.model_id,
    guard.matchFacts.updated_at,
    guard.matchFacts.payload_json,
    snapshot.listingId,
    guard.content.schema_version,
    guard.content.source_hash,
    guard.content.model_provider,
    guard.content.model_id,
    guard.content.updated_at,
    guard.content.payload_json,
    snapshot.listingId,
    guard.position.analysis.scope,
    guard.position.analysis.review_notes_json,
    guard.position.analysis.schema_version,
    guard.position.analysis.source_hash,
    guard.position.analysis.model_provider,
    guard.position.analysis.model_id,
    guard.position.analysis.updated_at,
    snapshot.listingId,
    guard.position.variants.length,
    canonicalJson(guard.position.variants),
    snapshot.listingId,
  ] as const;
}
