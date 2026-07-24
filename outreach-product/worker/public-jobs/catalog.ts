import {
  canonicalJson,
  canonicalSha256,
  compareUtf8Bytes,
} from "../services/public-projection/hash";
import {
  assertDetailMatchesItem,
  assertMembershipEntries,
  assertSearchEntries,
  parseCatalogDetail,
  parseCatalogItem,
  parseLocationFacets,
  parseSearchTerms,
  withoutSearchIdentity,
} from "./catalog-validation";
import type { PublicJobListItem } from "./schemas";

const emptyMembershipHash =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface PublicJobCatalogLocationFacet {
  citySlug: string | null;
  countryCode: string;
  countrySlug: string;
  displayName: string;
  role: "applicant_area" | "worksite";
}

export interface PublicJobCatalogMembershipEntry {
  detailJson: string;
  eligibilityDecisionHash: string;
  eligibilityDecisionVersion: number;
  itemJson: string;
  locationFacets: PublicJobCatalogLocationFacet[];
  publicContentHash: string;
  publicJobId: string;
  publicJobVersion: number;
}

export interface PublicJobSearchTerm {
  score: number;
  term: string;
}

export interface PublicJobCatalogSearchEntry {
  conservativeHourlyUsd: number | null;
  effectiveRecency: string;
  publicJobId: string;
  publicJobVersion: number;
  searchDocument: string;
  terms: PublicJobSearchTerm[];
  titleSortKey: string;
}

export interface DerivedPublicJobCatalogSearch {
  entries: PublicJobCatalogSearchEntry[];
  searchContentHash: string;
  termCount: number;
}

export interface DerivedPublicJobCatalogMembership {
  entries: PublicJobCatalogMembershipEntry[];
  membershipHash: string;
}

export async function derivePublicJobCatalogMembership(
  entries: PublicJobCatalogMembershipEntry[]
): Promise<DerivedPublicJobCatalogMembership> {
  const sorted = sortMembership(entries);
  assertMembershipEntries(sorted);
  return {
    entries: sorted,
    membershipHash:
      sorted.length === 0 ? emptyMembershipHash : await canonicalSha256(sorted),
  };
}

export function derivePublicJobSearchEntry(
  item: PublicJobListItem
): Omit<PublicJobCatalogSearchEntry, "publicJobId" | "publicJobVersion"> {
  const weightedText = [
    { score: 8, value: item.title },
    { score: 4, value: item.organization.name },
    ...item.locations.map(({ displayName }) => ({
      score: 2,
      value: displayName,
    })),
    { score: 1, value: item.workplaceType },
    ...item.employmentTypes.map((value) => ({ score: 1, value })),
  ];
  const scores = new Map<string, number>();
  for (const { score, value } of weightedText) {
    for (const term of publicSearchTerms(value)) {
      scores.set(term, (scores.get(term) ?? 0) + score);
    }
  }
  const terms = [...scores.entries()]
    .map(([term, score]) => ({ score, term }))
    .sort((left, right) => compareUtf8Bytes(left.term, right.term));
  return {
    conservativeHourlyUsd:
      item.compensation?.hourlyUsd?.minimum ??
      item.compensation?.hourlyUsd?.maximum ??
      null,
    effectiveRecency:
      item.datePosted?.value ?? item.freshness.materialChangedAt,
    searchDocument: weightedText
      .map(({ value }) => value)
      .join(" ")
      .normalize("NFKC")
      .replace(/\s+/gu, " ")
      .trim(),
    terms,
    titleSortKey: item.title.normalize("NFKC").toLocaleLowerCase("und"),
  };
}

export async function derivePublicJobCatalogSearch(
  entries: PublicJobCatalogSearchEntry[]
): Promise<DerivedPublicJobCatalogSearch> {
  const sorted = [...entries].sort((left, right) =>
    compareUtf8Bytes(left.publicJobId, right.publicJobId)
  );
  assertSearchEntries(sorted);
  return {
    entries: sorted,
    searchContentHash: await canonicalSha256(sorted),
    termCount: sorted.reduce((count, entry) => count + entry.terms.length, 0),
  };
}

export function publicSearchTerms(value: string) {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase("und")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

export async function sealAndActivatePublicJobCatalog(
  db: D1Database,
  input: {
    catalogVersion: string;
    sealedAt: string;
  }
) {
  const rows = await db
    .prepare(
      `SELECT member.public_job_id,member.public_job_version,
              member.eligibility_decision_version,member.item_json,
              member.detail_json,member.location_facets_json,
              member.public_content_hash,member.eligibility_decision_hash
         FROM public_job_catalog_versions target
         JOIN public_job_catalog_members member
           ON member.valid_from_ordinal<=target.ordinal
          AND (member.valid_to_ordinal IS NULL
            OR member.valid_to_ordinal>target.ordinal)
        WHERE target.version=? ORDER BY member.public_job_id`
    )
    .bind(input.catalogVersion)
    .all<{
      eligibility_decision_hash: string;
      eligibility_decision_version: number;
      detail_json: string;
      item_json: string;
      location_facets_json: string;
      public_content_hash: string;
      public_job_id: string;
      public_job_version: number;
    }>();
  const membership = await derivePublicJobCatalogMembership(
    rows.results.map((row) => ({
      detailJson: row.detail_json,
      eligibilityDecisionHash: row.eligibility_decision_hash,
      eligibilityDecisionVersion: row.eligibility_decision_version,
      itemJson: row.item_json,
      locationFacets: parseLocationFacets(row.location_facets_json),
      publicContentHash: row.public_content_hash,
      publicJobId: row.public_job_id,
      publicJobVersion: row.public_job_version,
    }))
  );
  const items = new Map<string, PublicJobListItem>();
  for (const entry of membership.entries) {
    const item = parseCatalogItem(entry.itemJson);
    const detail = parseCatalogDetail(entry.detailJson);
    assertDetailMatchesItem(detail, item);
    items.set(entry.publicJobId, item);
  }
  const version = await db
    .prepare(
      `SELECT membership_hash,member_count,search_content_hash,
              search_document_count,search_term_count
         FROM public_job_catalog_versions WHERE version=? LIMIT 1`
    )
    .bind(input.catalogVersion)
    .first<{
      member_count: number;
      membership_hash: string;
      search_content_hash: string;
      search_document_count: number;
      search_term_count: number;
    }>();
  if (
    !version ||
    version.membership_hash !== membership.membershipHash ||
    version.member_count !== membership.entries.length
  ) {
    throw new Error(
      "Public job catalog version does not match its derived membership"
    );
  }
  const searchRows = await db
    .prepare(
      `SELECT search.public_job_id,search.public_job_version,
              search.search_document,search.title_sort_key,
              search.effective_recency,search.conservative_hourly_usd,
              search.search_terms_json
         FROM public_job_catalog_versions target
         JOIN public_job_catalog_members member
           ON member.valid_from_ordinal<=target.ordinal
          AND (member.valid_to_ordinal IS NULL
            OR member.valid_to_ordinal>target.ordinal)
         JOIN public_job_search_index search
           ON search.public_job_id=member.public_job_id
          AND search.valid_from_ordinal=member.valid_from_ordinal
        WHERE target.version=?
        ORDER BY search.public_job_id`
    )
    .bind(input.catalogVersion)
    .all<{
      conservative_hourly_usd: number | null;
      effective_recency: string;
      public_job_id: string;
      public_job_version: number;
      search_document: string;
      search_terms_json: string;
      title_sort_key: string;
    }>();
  const searchEntries: PublicJobCatalogSearchEntry[] = searchRows.results.map(
    (row) => ({
      conservativeHourlyUsd: row.conservative_hourly_usd,
      effectiveRecency: row.effective_recency,
      publicJobId: row.public_job_id,
      publicJobVersion: row.public_job_version,
      searchDocument: row.search_document,
      terms: parseSearchTerms(row.search_terms_json),
      titleSortKey: row.title_sort_key,
    })
  );
  for (const entry of searchEntries) {
    const item = items.get(entry.publicJobId);
    if (!item || item.publicJobVersion !== entry.publicJobVersion) {
      throw new Error("Public job search row has no exact catalog member");
    }
    const expected = derivePublicJobSearchEntry(item);
    if (
      JSON.stringify(expected) !== JSON.stringify(withoutSearchIdentity(entry))
    ) {
      throw new Error("Public job search row differs from its public member");
    }
  }
  const search = await derivePublicJobCatalogSearch(searchEntries);
  const termRows = await db
    .prepare(
      `SELECT term.public_job_id,term.public_job_version,term.term,term.score
         FROM public_job_catalog_versions target
         JOIN public_job_catalog_members member
           ON member.valid_from_ordinal<=target.ordinal
          AND (member.valid_to_ordinal IS NULL
            OR member.valid_to_ordinal>target.ordinal)
         JOIN public_job_search_terms term
           ON term.public_job_id=member.public_job_id
          AND term.valid_from_ordinal=member.valid_from_ordinal
        WHERE target.version=?
        ORDER BY term.public_job_id,term.term`
    )
    .bind(input.catalogVersion)
    .all<{
      public_job_id: string;
      public_job_version: number;
      score: number;
      term: string;
    }>();
  const expectedTerms = search.entries.flatMap((entry) =>
    entry.terms.map(({ score, term }) => ({
      public_job_id: entry.publicJobId,
      public_job_version: entry.publicJobVersion,
      score,
      term,
    }))
  );
  if (canonicalJson(termRows.results) !== canonicalJson(expectedTerms)) {
    throw new Error("Public job search terms differ from their search rows");
  }
  if (
    version.search_content_hash !== search.searchContentHash ||
    version.search_document_count !== search.entries.length ||
    version.search_term_count !== search.termCount
  ) {
    throw new Error(
      "Public job catalog version does not match its search rows"
    );
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO public_job_catalog_seals (
          catalog_version,membership_hash,member_count,search_document_count,
          search_content_hash,search_term_count,location_facet_count,sealed_at
        )
        SELECT version,membership_hash,member_count,
               search_document_count,search_content_hash,search_term_count,
               location_facet_count,?
          FROM public_job_catalog_versions
         WHERE version=?`
      )
      .bind(input.sealedAt, input.catalogVersion),
    db
      .prepare(
        `UPDATE public_job_catalog_head_pointer
            SET current_version=?,updated_at=?
          WHERE singleton=1`
      )
      .bind(input.catalogVersion, input.sealedAt),
  ]);
  return membership;
}

function sortMembership(entries: PublicJobCatalogMembershipEntry[]) {
  return [...entries].sort((left, right) =>
    compareUtf8Bytes(left.publicJobId, right.publicJobId)
  );
}
