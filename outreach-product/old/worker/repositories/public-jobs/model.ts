import {
  countryCodeForSlug,
  countrySlugForCode,
} from "../../../src/lib/country-routing";
import type {
  PublicJobDetailResponse,
  PublicJobListResponse,
  PublicJobListScope,
  PublicJobReadRow,
} from "../../public-jobs/schemas";

export interface CatalogRow {
  material_changed_at: string;
  membership_hash: string;
  representation_updated_at: string;
  search_index_version: string;
  version: string;
}

export interface PublicJobListServerMetadata {
  cursor: string | null;
  membershipHash: string;
  queryHash: string;
  representationUpdatedAt: string;
}

export interface PublicJobListServerResult {
  data: PublicJobListResponse;
  metadata: PublicJobListServerMetadata;
}

export interface PublicJobListRow extends PublicJobReadRow {
  conservative_hourly_usd: number | null;
  effective_recency: string;
  item_json: string;
  search_rank: number;
  title_sort_key: string;
}

export interface RouteResolutionRow {
  detail_json: string | null;
  eligibility_decision_hash: string | null;
  job_posting_eligible: number;
  noindex: number;
  public_content_hash: string | null;
  representation_updated_at: string | null;
  route_action: "gone" | "permanent_redirect" | "serve";
  target_path: string | null;
}

export const publicIdPattern = /^pjob_v1_[0-9a-f]{64}$/u;

export const publicSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const canonicalTargetPathPattern =
  /^\/job\/pjob_v1_[0-9a-f]{64}\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type PublicJobDetailResult =
  | { data: PublicJobDetailResponse; kind: "serve"; noindex: boolean }
  | { kind: "redirect"; targetPath: string }
  | { kind: "gone" }
  | { kind: "missing" };

interface PublicMarketScopeRow {
  city_slug: string | null;
  country_code: string;
  country_count: number;
  country_slug: string;
  display_name: string | null;
}

export async function resolvePublicJobMarketScope(
  db: Pick<D1Database, "prepare">,
  input: { citySlug?: string; countrySlug: string }
): Promise<PublicJobListScope | null> {
  if (
    !publicSlugPattern.test(input.countrySlug) ||
    (input.citySlug !== undefined && !publicSlugPattern.test(input.citySlug))
  ) {
    return null;
  }
  const city = input.citySlug ?? null;
  const routedCountryCode = countryCodeForSlug(input.countrySlug);
  const row = await db
    .prepare(
      `SELECT
         MIN(facet.country_code) AS country_code,
         MIN(facet.country_slug) AS country_slug,
         CASE WHEN ? IS NULL THEN NULL ELSE MIN(facet.city_slug) END AS city_slug,
         CASE WHEN ? IS NULL THEN NULL ELSE MIN(facet.display_name) END
           AS display_name,
         COUNT(DISTINCT facet.country_code) AS country_count
       FROM public_job_catalog_head_pointer head
       JOIN public_job_catalog_versions head_version
         ON head_version.version=head.current_version
       JOIN public_job_catalog_members member
         ON member.valid_from_ordinal<=head_version.ordinal
        AND (member.valid_to_ordinal IS NULL
          OR member.valid_to_ordinal>head_version.ordinal)
       JOIN public_browse_job_locations facet
         ON facet.public_job_id=member.public_job_id
        AND facet.valid_from_ordinal=member.valid_from_ordinal
      WHERE (
        facet.country_slug=?
        OR (? IS NOT NULL AND facet.country_code=?)
      )
        AND (? IS NULL OR (
          facet.city_slug=? AND facet.location_role='worksite'
        ))`
    )
    .bind(
      city,
      city,
      input.countrySlug,
      routedCountryCode,
      routedCountryCode,
      city,
      city
    )
    .first<PublicMarketScopeRow>();
  if (row?.country_count !== 1) {
    return null;
  }
  if (city === null) {
    return {
      countryCode: row.country_code,
      countrySlug: countrySlugForCode(row.country_code),
      kind: "country",
    };
  }
  if (row.city_slug === null || row.display_name === null) {
    return null;
  }
  return {
    citySlug: row.city_slug,
    countryCode: row.country_code,
    countrySlug: countrySlugForCode(row.country_code),
    displayName: row.display_name,
    kind: "city",
  };
}

export type PublicJobDetailServerResult =
  | {
      data: PublicJobDetailResponse;
      kind: "serve";
      metadata: {
        canonicalPath: string;
        eligibilityDecisionHash: string;
        jobPostingEligible: boolean;
        publicContentHash: string;
        representationUpdatedAt: string;
      };
      noindex: boolean;
    }
  | Exclude<PublicJobDetailResult, { kind: "serve" }>;
