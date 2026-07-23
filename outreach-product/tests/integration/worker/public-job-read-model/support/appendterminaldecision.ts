import {
  derivePublicJobCatalogMembership,
  derivePublicJobCatalogSearch,
  derivePublicJobSearchEntry,
  type PublicJobCatalogLocationFacet,
  sealAndActivatePublicJobCatalog,
} from "../../../../../worker/public-jobs/catalog";
import type {
  PublicJobListItem,
  PublicJobReadRow,
} from "../../../../../worker/public-jobs/schemas";
import {
  type CatalogCandidateRow,
  type PublishCatalogOptions,
  testEnv,
  timestamp,
} from "./model";

interface PreparedCatalogCandidate {
  candidate: CatalogCandidateRow;
  detailJson: string;
  facets: PublicJobCatalogLocationFacet[];
  item: PublicJobListItem;
  itemJson: string;
  search: ReturnType<typeof derivePublicJobSearchEntry>;
}

export async function appendTerminalDecision(
  publicJobId: string,
  state: "closed" | "gone" | "merged",
  redirectPublicJobId: string | null,
  decidedAt = timestamp
) {
  let routeDisposition: "gone" | "redirect" | "retain_noindex" =
    "retain_noindex";
  if (state === "merged") {
    routeDisposition = "redirect";
  } else if (state === "gone") {
    routeDisposition = "gone";
  }
  const publicationState = state === "merged" ? "merged" : "closed";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO public_job_eligibility_decisions (
        public_job_id,decision_version,predecessor_version,public_job_version,
        publication_state,route_disposition,browse_eligible,
        organic_index_eligible,job_posting_eligible,source_open_state,
        application_route_id,application_route_state,content_review_state,
        privacy_state,verified_at,redirect_public_job_id,reason_codes_json,
        decision_note,evaluator_kind,evaluator_version,decision_hash,
        idempotency_key,decided_at
      ) VALUES (?,2,1,1,?,?,0,0,0,'closed',NULL,'unresolved','approved',
        'passed',?,?, '["lifecycle"]','lifecycle','system','v1',?,
        'decision-v2',?)`
    ).bind(
      publicJobId,
      publicationState,
      routeDisposition,
      timestamp,
      redirectPublicJobId,
      hash(Number.parseInt(publicJobId.slice(-4), 16) + 4),
      decidedAt
    ),
    ...(state === "closed"
      ? [
          testEnv.DB.prepare(
            `INSERT INTO public_job_decision_sources (
              public_job_id,decision_version,source_position_id,
              source_mapping_version,source_key,policy_version,
              contribution_kind,fields_used_json,created_at
            )
            SELECT public_job_id,2,source_position_id,source_mapping_version,
                   source_key,policy_version,contribution_kind,
                   fields_used_json,created_at
              FROM public_job_decision_sources
             WHERE public_job_id=? AND decision_version=1`
          ).bind(publicJobId),
        ]
      : []),
    testEnv.DB.prepare(
      `UPDATE public_job_eligibility_heads
          SET current_decision_version=2,updated_at=?
        WHERE public_job_id=?`
    ).bind(timestamp, publicJobId),
  ]);
}

export async function publishCatalog(
  label: string,
  publicJobIds: string[],
  options: PublishCatalogOptions = {}
) {
  const head = await testEnv.DB.prepare(
    "SELECT version FROM public_job_catalog_head"
  ).first<{ version: string }>();
  if (!head) {
    throw new Error("Catalog head is missing");
  }
  const catalogVersion = `catalog:${label}`;
  const searchVersion = `search:${label}`;
  const candidates: PreparedCatalogCandidate[] = [];
  for (const publicJobId of publicJobIds) {
    // biome-ignore lint/performance/noAwaitInLoops: the fixture reads each immutable candidate before sealing one catalog.
    candidates.push(await prepareCatalogCandidate(publicJobId, options));
  }
  const membership = await derivePublicJobCatalogMembership(
    candidates.map(({ candidate, detailJson, facets, itemJson }) => ({
      detailJson,
      eligibilityDecisionHash: candidate.eligibility_decision_hash,
      eligibilityDecisionVersion: candidate.eligibility_decision_version,
      itemJson,
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
      head.version,
      options.versionMembershipHash ?? membership.membershipHash,
      candidates.length,
      candidates.length,
      options.versionSearchContentHash ?? search.searchContentHash,
      search.termCount,
      locationFacetCount,
      timestamp,
      timestamp,
      searchVersion,
      timestamp
    )
    .run();

  for (const candidate of candidates) {
    const statements = catalogMemberStatements(
      candidate,
      catalogVersion,
      searchVersion,
      options
    );
    // biome-ignore lint/performance/noAwaitInLoops: the fixture materializes each immutable catalog member before one head advance.
    await testEnv.DB.batch(statements);
  }
  if (options.sealMembershipHash) {
    await testEnv.DB.prepare(
      `INSERT INTO public_job_catalog_seals (
        catalog_version,membership_hash,member_count,search_document_count,
        search_content_hash,search_term_count,location_facet_count,sealed_at
      ) VALUES (?,?,?,?,?,?,?,?)`
    )
      .bind(
        catalogVersion,
        options.sealMembershipHash,
        candidates.length,
        candidates.length,
        search.searchContentHash,
        search.termCount,
        locationFacetCount,
        timestamp
      )
      .run();
    await testEnv.DB.prepare(
      `UPDATE public_job_catalog_head_pointer
          SET current_version=?,updated_at=?
        WHERE singleton=1`
    )
      .bind(catalogVersion, timestamp)
      .run();
    return;
  }
  await sealAndActivatePublicJobCatalog(testEnv.DB, {
    catalogVersion,
    sealedAt: timestamp,
  });
}

async function prepareCatalogCandidate(
  publicJobId: string,
  options: PublishCatalogOptions
): Promise<PreparedCatalogCandidate> {
  const candidate = await catalogCandidateRow(publicJobId);
  if (!candidate) {
    throw new Error(`Catalog candidate is missing: ${publicJobId}`);
  }
  const item = JSON.parse(candidate.item_json) as PublicJobListItem;
  const detailJson = options.detailValue
    ? JSON.stringify(
        options.detailValue(JSON.parse(candidate.detail_json) as unknown)
      )
    : candidate.detail_json;
  const itemJson = options.itemValue
    ? JSON.stringify(options.itemValue(item))
    : candidate.item_json;
  const facets = item.locations.map((location) => {
    const facet = {
      citySlug: location.locality === null ? null : slugify(location.locality),
      countryCode: location.countryCode,
      countrySlug: countrySlug(location.countryCode),
      displayName: location.displayName,
      role: location.role === "applicantArea" ? "applicant_area" : "worksite",
    } as const satisfies PublicJobCatalogLocationFacet;
    return options.facetValue ? options.facetValue(facet) : facet;
  });
  const search = derivePublicJobSearchEntry(item);
  return {
    candidate,
    detailJson,
    facets,
    item,
    itemJson,
    search: options.searchValue ? options.searchValue(search) : search,
  };
}

function catalogMemberStatements(
  prepared: PreparedCatalogCandidate,
  catalogVersion: string,
  searchVersion: string,
  options: PublishCatalogOptions
) {
  const {
    candidate,
    detailJson,
    facets,
    item,
    itemJson,
    search: derived,
  } = prepared;
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
      itemJson,
      detailJson,
      candidate.public_content_hash,
      candidate.eligibility_decision_hash,
      JSON.stringify(facets),
      candidate.representation_updated_at,
      timestamp
    ),
    ...(options.omitSearch
      ? []
      : [
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
        ]),
    ...(options.omitFacets
      ? []
      : item.locations.map((_location, ordinal) =>
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
        )),
  ];
}

export function catalogCandidateRow(publicJobId: string) {
  return testEnv.DB.prepare(
    `SELECT
      public_job_id,public_job_version,eligibility_decision_version,
      canonical_slug,title,organization_name,workplace_type,date_posted,
      date_posted_provenance,valid_through,valid_through_provenance,
      employment_types_json,compensation_json,material_changed_at,verified_at,
      application_available,locations_json,source_attributions_json,
      'published' AS publication_state,public_content_hash,
      eligibility_decision_hash,representation_updated_at,item_json,detail_json
     FROM public_browse_job_candidates WHERE public_job_id=?`
  )
    .bind(publicJobId)
    .first<CatalogCandidateRow>();
}

export function candidateRow(publicJobId: string) {
  return testEnv.DB.prepare(
    `SELECT
      public_job_id,public_job_version,canonical_slug,title,
      organization_name,workplace_type,date_posted,date_posted_provenance,
      valid_through,valid_through_provenance,employment_types_json,
      compensation_json,description_html,material_changed_at,verified_at,
      application_available,locations_json,source_attributions_json,
      publication_state
     FROM public_job_route_content WHERE public_job_id=?`
  )
    .bind(publicJobId)
    .first<PublicJobReadRow>();
}

export function makePublicId(index: number) {
  return `pjob_v1_${index.toString(16).padStart(64, "0")}`;
}

export function countrySlug(countryCode: string) {
  return countryCode === "KR" ? "south-korea" : countryCode.toLowerCase();
}

export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

export function hash(index: number) {
  return Math.max(0, index).toString(16).padStart(64, "0").slice(-64);
}
