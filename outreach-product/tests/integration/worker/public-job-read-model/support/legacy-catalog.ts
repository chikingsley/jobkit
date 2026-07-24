import {
  derivePublicJobCatalogMembership,
  derivePublicJobCatalogSearch,
  derivePublicJobSearchEntry,
  type PublicJobCatalogLocationFacet,
} from "../../../../../worker/public-jobs/catalog";
import type { PublicJobListItem } from "../../../../../worker/public-jobs/schemas";
import {
  catalogCandidateRow,
  countrySlug,
  slugify,
} from "./appendterminaldecision";
import { type CatalogCandidateRow, testEnv, timestamp } from "./model";

interface LegacyCatalogCandidate {
  candidate: CatalogCandidateRow;
  facets: PublicJobCatalogLocationFacet[];
  item: PublicJobListItem;
  search: ReturnType<typeof derivePublicJobSearchEntry>;
}

// Publishes a catalog in the pre-range shape where every version copies its
// full membership. Only the conversion migration test may use this helper,
// and only against a database that has not applied the range migration yet.
export async function publishLegacyCatalog(
  label: string,
  publicJobIds: string[],
  activatedAt: string
) {
  const head = await testEnv.DB.prepare(
    `SELECT current_version FROM public_job_catalog_head_pointer
      WHERE singleton=1`
  ).first<{ current_version: string }>();
  if (!head) {
    throw new Error("Catalog head is missing");
  }
  const catalogVersion = `catalog:${label}`;
  const searchVersion = `search:${label}`;
  const candidates: LegacyCatalogCandidate[] = [];
  for (const publicJobId of publicJobIds) {
    // biome-ignore lint/performance/noAwaitInLoops: the fixture reads each immutable candidate before sealing one catalog.
    candidates.push(await legacyCatalogCandidate(publicJobId));
  }
  const membership = await derivePublicJobCatalogMembership(
    candidates.map(({ candidate, facets }) => ({
      detailJson: candidate.detail_json,
      eligibilityDecisionHash: candidate.eligibility_decision_hash,
      eligibilityDecisionVersion: candidate.eligibility_decision_version,
      itemJson: candidate.item_json,
      locationFacets: facets,
      publicContentHash: candidate.public_content_hash,
      publicJobId: candidate.public_job_id,
      publicJobVersion: candidate.public_job_version,
    }))
  );
  const search = await derivePublicJobCatalogSearch(
    candidates.map(({ candidate, item, search: derived }) => ({
      ...derived,
      publicJobId: candidate.public_job_id,
      publicJobVersion: item.publicJobVersion,
    }))
  );
  const locationFacetCount = candidates.reduce(
    (count, { item }) => count + item.locations.length,
    0
  );
  await testEnv.DB.prepare(
    `INSERT INTO public_job_catalog_versions (
      version,predecessor_version,membership_hash,member_count,
      search_document_count,search_content_hash,search_term_count,
      location_facet_count,representation_updated_at,
      material_changed_at,search_index_version,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      catalogVersion,
      head.current_version,
      membership.membershipHash,
      candidates.length,
      candidates.length,
      search.searchContentHash,
      search.termCount,
      locationFacetCount,
      activatedAt,
      activatedAt,
      searchVersion,
      activatedAt
    )
    .run();
  for (const candidate of candidates) {
    // biome-ignore lint/performance/noAwaitInLoops: the fixture materializes each immutable catalog member before one head advance.
    await testEnv.DB.batch(
      legacyMemberStatements(candidate, catalogVersion, searchVersion)
    );
  }
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO public_job_catalog_seals (
        catalog_version,membership_hash,member_count,search_document_count,
        search_content_hash,search_term_count,location_facet_count,sealed_at
      ) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      catalogVersion,
      membership.membershipHash,
      candidates.length,
      candidates.length,
      search.searchContentHash,
      search.termCount,
      locationFacetCount,
      activatedAt
    ),
    testEnv.DB.prepare(
      `UPDATE public_job_catalog_head_pointer
          SET current_version=?,updated_at=?
        WHERE singleton=1`
    ).bind(catalogVersion, activatedAt),
  ]);
  return { catalogVersion, searchVersion };
}

async function legacyCatalogCandidate(
  publicJobId: string
): Promise<LegacyCatalogCandidate> {
  const candidate = await catalogCandidateRow(publicJobId);
  if (!candidate) {
    throw new Error(`Catalog candidate is missing: ${publicJobId}`);
  }
  const item = JSON.parse(candidate.item_json) as PublicJobListItem;
  const facets = item.locations.map(
    (location) =>
      ({
        citySlug:
          location.locality === null ? null : slugify(location.locality),
        countryCode: location.countryCode,
        countrySlug: countrySlug(location.countryCode),
        displayName: location.displayName,
        role: location.role === "applicantArea" ? "applicant_area" : "worksite",
      }) as const satisfies PublicJobCatalogLocationFacet
  );
  return { candidate, facets, item, search: derivePublicJobSearchEntry(item) };
}

function legacyMemberStatements(
  prepared: LegacyCatalogCandidate,
  catalogVersion: string,
  searchVersion: string
) {
  const { candidate, facets, item, search: derived } = prepared;
  return [
    testEnv.DB.prepare(
      `INSERT INTO public_job_catalog_members (
        catalog_version,public_job_id,public_job_version,
        eligibility_decision_version,item_json,detail_json,public_content_hash,
        eligibility_decision_hash,location_facets_json,
        representation_updated_at,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      catalogVersion,
      candidate.public_job_id,
      item.publicJobVersion,
      candidate.eligibility_decision_version,
      candidate.item_json,
      candidate.detail_json,
      candidate.public_content_hash,
      candidate.eligibility_decision_hash,
      JSON.stringify(facets),
      candidate.representation_updated_at,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_job_search_index (
        public_job_id,public_job_version,search_index_version,
        search_document,search_terms_json,title_sort_key,effective_recency,
        conservative_hourly_usd,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      candidate.public_job_id,
      item.publicJobVersion,
      searchVersion,
      derived.searchDocument,
      JSON.stringify(derived.terms),
      derived.titleSortKey,
      derived.effectiveRecency,
      derived.conservativeHourlyUsd,
      timestamp
    ),
    ...derived.terms.map(({ score, term }) =>
      testEnv.DB.prepare(
        `INSERT INTO public_job_search_terms (
          search_index_version,public_job_id,public_job_version,
          term,score,created_at
        ) VALUES (?,?,?,?,?,?)`
      ).bind(
        searchVersion,
        candidate.public_job_id,
        item.publicJobVersion,
        term,
        score,
        timestamp
      )
    ),
    ...item.locations.map((_location, ordinal) =>
      testEnv.DB.prepare(
        `INSERT INTO public_browse_job_locations (
          catalog_version,public_job_id,public_job_version,ordinal,
          location_role,country_code,country_slug,city_slug,display_name,
          created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        catalogVersion,
        candidate.public_job_id,
        item.publicJobVersion,
        ordinal,
        facets[ordinal]?.role,
        facets[ordinal]?.countryCode,
        facets[ordinal]?.countrySlug,
        facets[ordinal]?.citySlug,
        facets[ordinal]?.displayName,
        timestamp
      )
    ),
  ];
}
