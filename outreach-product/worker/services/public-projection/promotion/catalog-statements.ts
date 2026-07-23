import { canonicalJson } from "../hash";
import type { CatalogPromotionStatementInput } from "./catalog";

export interface CatalogCopyRange {
  afterId: string;
  throughId: string;
}

export function copyCatalogMembers(
  db: D1Database,
  input: CatalogPromotionStatementInput,
  range: CatalogCopyRange
) {
  return db
    .prepare(
      `INSERT INTO public_job_catalog_members (
        catalog_version,public_job_id,public_job_version,
        eligibility_decision_version,item_json,detail_json,public_content_hash,
        eligibility_decision_hash,location_facets_json,
        representation_updated_at,created_at
      )
      SELECT ?,public_job_id,public_job_version,eligibility_decision_version,
             item_json,detail_json,public_content_hash,
             eligibility_decision_hash,location_facets_json,
             representation_updated_at,?
        FROM public_job_catalog_members
       WHERE catalog_version=? AND public_job_id<>?
         AND public_job_id>? AND public_job_id<=?`
    )
    .bind(
      input.prepared.catalogVersion,
      input.timestamp,
      input.catalogHead.current_version,
      input.candidate.publicJobId,
      range.afterId,
      range.throughId
    );
}

export function candidateCatalogMember(
  db: D1Database,
  input: CatalogPromotionStatementInput
) {
  const entry = input.prepared.candidateEntry;
  return db
    .prepare(
      `INSERT INTO public_job_catalog_members (
        catalog_version,public_job_id,public_job_version,
        eligibility_decision_version,item_json,detail_json,public_content_hash,
        eligibility_decision_hash,location_facets_json,
        representation_updated_at,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      input.prepared.catalogVersion,
      entry.publicJobId,
      entry.publicJobVersion,
      entry.eligibilityDecisionVersion,
      entry.itemJson,
      entry.detailJson,
      entry.publicContentHash,
      entry.eligibilityDecisionHash,
      canonicalJson(entry.locationFacets),
      input.timestamp,
      input.timestamp
    );
}

export function copySearchRows(
  db: D1Database,
  input: CatalogPromotionStatementInput,
  range: CatalogCopyRange
) {
  return db
    .prepare(
      `INSERT INTO public_job_search_index (
        public_job_id,public_job_version,search_index_version,
        search_document,search_terms_json,title_sort_key,effective_recency,
        conservative_hourly_usd,created_at
      )
      SELECT search.public_job_id,search.public_job_version,?,
             search.search_document,search.search_terms_json,
             search.title_sort_key,search.effective_recency,
             search.conservative_hourly_usd,?
        FROM public_job_search_index search
       WHERE search.search_index_version=? AND search.public_job_id<>?
         AND search.public_job_id>? AND search.public_job_id<=?`
    )
    .bind(
      input.prepared.searchVersion,
      input.timestamp,
      input.catalogHead.search_index_version,
      input.candidate.publicJobId,
      range.afterId,
      range.throughId
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
        public_job_id,public_job_version,search_index_version,
        search_document,search_terms_json,title_sort_key,effective_recency,
        conservative_hourly_usd,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      input.candidate.publicJobId,
      input.candidate.publicJobVersion,
      input.prepared.searchVersion,
      search.searchDocument,
      canonicalJson(search.terms),
      search.titleSortKey,
      search.effectiveRecency,
      search.conservativeHourlyUsd,
      input.timestamp
    );
}

export function copySearchTerms(
  db: D1Database,
  input: CatalogPromotionStatementInput,
  range: CatalogCopyRange
) {
  return db
    .prepare(
      `INSERT INTO public_job_search_terms (
        search_index_version,public_job_id,public_job_version,
        term,score,created_at
      )
      SELECT ?,public_job_id,public_job_version,term,score,?
        FROM public_job_search_terms
       WHERE search_index_version=? AND public_job_id<>?
         AND public_job_id>? AND public_job_id<=?`
    )
    .bind(
      input.prepared.searchVersion,
      input.timestamp,
      input.catalogHead.search_index_version,
      input.candidate.publicJobId,
      range.afterId,
      range.throughId
    );
}

export function candidateSearchTerms(
  db: D1Database,
  input: CatalogPromotionStatementInput
) {
  return db
    .prepare(
      `INSERT INTO public_job_search_terms (
        search_index_version,public_job_id,public_job_version,
        term,score,created_at
      )
      SELECT ?,?,?,json_extract(value,'$.term'),
             json_extract(value,'$.score'),?
        FROM json_each(?)`
    )
    .bind(
      input.prepared.searchVersion,
      input.candidate.publicJobId,
      input.candidate.publicJobVersion,
      input.timestamp,
      canonicalJson(input.prepared.candidateSearch.terms)
    );
}

export function copyLocationFacets(
  db: D1Database,
  input: CatalogPromotionStatementInput,
  range: CatalogCopyRange
) {
  return db
    .prepare(
      `INSERT INTO public_browse_job_locations (
        catalog_version,public_job_id,public_job_version,ordinal,
        location_role,country_code,country_slug,city_slug,display_name,
        created_at
      )
      SELECT ?,public_job_id,public_job_version,ordinal,location_role,
             country_code,country_slug,city_slug,display_name,?
        FROM public_browse_job_locations
       WHERE catalog_version=? AND public_job_id<>?
         AND public_job_id>? AND public_job_id<=?`
    )
    .bind(
      input.prepared.catalogVersion,
      input.timestamp,
      input.catalogHead.current_version,
      input.candidate.publicJobId,
      range.afterId,
      range.throughId
    );
}

export function candidateLocationFacets(
  db: D1Database,
  input: CatalogPromotionStatementInput
) {
  return db
    .prepare(
      `INSERT INTO public_browse_job_locations (
        catalog_version,public_job_id,public_job_version,ordinal,
        location_role,country_code,country_slug,city_slug,display_name,
        created_at
      )
      SELECT ?,?,?,CAST(key AS INTEGER),json_extract(value,'$.role'),
             json_extract(value,'$.countryCode'),
             json_extract(value,'$.countrySlug'),
             json_extract(value,'$.citySlug'),
             json_extract(value,'$.displayName'),?
        FROM json_each(?)`
    )
    .bind(
      input.prepared.catalogVersion,
      input.candidate.publicJobId,
      input.candidate.publicJobVersion,
      input.timestamp,
      canonicalJson(input.prepared.candidateEntry.locationFacets)
    );
}
