import { canonicalJson } from "../hash";
import type { CatalogPromotionStatementInput } from "./catalog";

export function closeSupersededCatalogMember(
  db: D1Database,
  input: CatalogPromotionStatementInput
) {
  return db
    .prepare(
      `UPDATE public_job_catalog_members
          SET valid_to_ordinal=(
            SELECT version.ordinal FROM public_job_catalog_versions version
             WHERE version.version=?
          )
        WHERE public_job_id=? AND valid_to_ordinal IS NULL`
    )
    .bind(input.prepared.catalogVersion, input.candidate.publicJobId);
}

export function candidateCatalogMember(
  db: D1Database,
  input: CatalogPromotionStatementInput
) {
  const entry = input.prepared.candidateEntry;
  return db
    .prepare(
      `INSERT INTO public_job_catalog_members (
        public_job_id,valid_from_ordinal,public_job_version,
        eligibility_decision_version,item_json,detail_json,public_content_hash,
        eligibility_decision_hash,location_facets_json,
        representation_updated_at,created_at
      )
      SELECT ?,version.ordinal,?,?,?,?,?,?,?,?,?
        FROM public_job_catalog_versions version
       WHERE version.version=?`
    )
    .bind(
      entry.publicJobId,
      entry.publicJobVersion,
      entry.eligibilityDecisionVersion,
      entry.itemJson,
      entry.detailJson,
      entry.publicContentHash,
      entry.eligibilityDecisionHash,
      canonicalJson(entry.locationFacets),
      input.timestamp,
      input.timestamp,
      input.prepared.catalogVersion
    );
}

export function candidateSearchRow(
  db: D1Database,
  input: CatalogPromotionStatementInput
) {
  const search = input.prepared.candidateSearch;
  return db
    .prepare(
      `INSERT INTO public_job_search_index (
        public_job_id,valid_from_ordinal,public_job_version,search_document,
        search_terms_json,title_sort_key,effective_recency,
        conservative_hourly_usd,created_at
      )
      SELECT ?,version.ordinal,?,?,?,?,?,?,?
        FROM public_job_catalog_versions version
       WHERE version.version=?`
    )
    .bind(
      input.candidate.publicJobId,
      input.candidate.publicJobVersion,
      search.searchDocument,
      canonicalJson(search.terms),
      search.titleSortKey,
      search.effectiveRecency,
      search.conservativeHourlyUsd,
      input.timestamp,
      input.prepared.catalogVersion
    );
}

export function candidateSearchTerms(
  db: D1Database,
  input: CatalogPromotionStatementInput
) {
  return db
    .prepare(
      `INSERT INTO public_job_search_terms (
        public_job_id,valid_from_ordinal,public_job_version,
        term,score,created_at
      )
      SELECT ?,version.ordinal,?,json_extract(term.value,'$.term'),
             json_extract(term.value,'$.score'),?
        FROM json_each(?) term
        JOIN public_job_catalog_versions version ON version.version=?`
    )
    .bind(
      input.candidate.publicJobId,
      input.candidate.publicJobVersion,
      input.timestamp,
      canonicalJson(input.prepared.candidateSearch.terms),
      input.prepared.catalogVersion
    );
}

export function candidateLocationFacets(
  db: D1Database,
  input: CatalogPromotionStatementInput
) {
  return db
    .prepare(
      `INSERT INTO public_browse_job_locations (
        public_job_id,valid_from_ordinal,public_job_version,ordinal,
        location_role,country_code,country_slug,city_slug,display_name,
        created_at
      )
      SELECT ?,version.ordinal,?,CAST(facet.key AS INTEGER),
             json_extract(facet.value,'$.role'),
             json_extract(facet.value,'$.countryCode'),
             json_extract(facet.value,'$.countrySlug'),
             json_extract(facet.value,'$.citySlug'),
             json_extract(facet.value,'$.displayName'),?
        FROM json_each(?) facet
        JOIN public_job_catalog_versions version ON version.version=?`
    )
    .bind(
      input.candidate.publicJobId,
      input.candidate.publicJobVersion,
      input.timestamp,
      canonicalJson(input.prepared.candidateEntry.locationFacets),
      input.prepared.catalogVersion
    );
}
