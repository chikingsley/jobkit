import {
  derivePublicJobCatalogMembership,
  derivePublicJobCatalogSearch,
  derivePublicJobSearchEntry,
  type PublicJobCatalogLocationFacet,
  type PublicJobCatalogMembershipEntry,
  type PublicJobCatalogSearchEntry,
} from "../../../public-jobs/catalog";
import {
  parseCatalogItem,
  parseLocationFacets,
} from "../../../public-jobs/catalog-validation";
import type { PublicProjectionCandidate } from "../candidates/model";
import {
  candidateCatalogMember,
  candidateLocationFacets,
  candidateSearchRow,
  candidateSearchTerms,
} from "./catalog-statements";
import { assertion } from "./guards";
import { promotionLocationFacet } from "./location";
import type { PromotionCatalogHead } from "./model";
import { PublicProjectionPromotionError } from "./model";

export interface CatalogCopyMember {
  facetCount: number;
  publicJobId: string;
  termCount: number;
}

export interface PreparedCatalogPromotion {
  candidateEntry: PublicJobCatalogMembershipEntry;
  candidateSearch: ReturnType<typeof derivePublicJobSearchEntry>;
  catalogVersion: string;
  copyMembers: CatalogCopyMember[];
  locationFacetCount: number;
  memberCount: number;
  membershipHash: string;
  searchContentHash: string;
  searchTermCount: number;
  searchVersion: string;
}

export interface CatalogPromotionStatementInput {
  candidate: PublicProjectionCandidate;
  catalogHead: PromotionCatalogHead;
  prepared: PreparedCatalogPromotion;
  timestamp: string;
}

export async function prepareCatalogPromotion(
  db: D1Database,
  input: {
    candidate: PublicProjectionCandidate;
    catalogHead: PromotionCatalogHead;
    decisionHash: string;
    timestamp: string;
  }
): Promise<PreparedCatalogPromotion | null> {
  if (input.candidate.decision.publicationState === "private") {
    return null;
  }
  const current = await readCurrentMembership(
    db,
    input.catalogHead.current_version
  );
  const currentMembership = await derivePublicJobCatalogMembership(current);
  if (currentMembership.membershipHash !== input.catalogHead.membership_hash) {
    throw new PublicProjectionPromotionError(
      "Current public catalog membership failed validation"
    );
  }
  const currentSearchEntries = currentMembership.entries.map((entry) =>
    membershipSearchEntry(entry)
  );
  const currentSearch =
    await derivePublicJobCatalogSearch(currentSearchEntries);
  if (
    currentSearch.searchContentHash !== input.catalogHead.search_content_hash
  ) {
    throw new PublicProjectionPromotionError(
      "Current public catalog search projection failed validation"
    );
  }
  const facets = candidateFacets(input.candidate);
  const payload = liveCatalogPayload(input.candidate, input.timestamp);
  const candidateEntry: PublicJobCatalogMembershipEntry = {
    detailJson: payload.detailJson,
    eligibilityDecisionHash: input.decisionHash,
    eligibilityDecisionVersion: input.candidate.decision.decisionVersion,
    itemJson: payload.itemJson,
    locationFacets: facets,
    publicContentHash: input.candidate.publicContentHash,
    publicJobId: input.candidate.publicJobId,
    publicJobVersion: input.candidate.publicJobVersion,
  };
  const retained = currentMembership.entries.filter(
    ({ publicJobId }) => publicJobId !== input.candidate.publicJobId
  );
  const retainedSearch = currentSearchEntries.filter(
    ({ publicJobId }) => publicJobId !== input.candidate.publicJobId
  );
  const membership = await derivePublicJobCatalogMembership([
    ...retained,
    candidateEntry,
  ]);
  const search = await derivePublicJobCatalogSearch([
    ...retainedSearch,
    membershipSearchEntry(candidateEntry),
  ]);
  const attempt = crypto.randomUUID().slice(0, 8);
  return {
    candidateEntry,
    candidateSearch: derivePublicJobSearchEntry(input.candidate.item),
    catalogVersion: `catalog:promotion:${input.candidate.candidateId}:${attempt}`,
    copyMembers: catalogCopyMembers(retained, retainedSearch),
    locationFacetCount: membership.entries.reduce(
      (count, entry) => count + entry.locationFacets.length,
      0
    ),
    memberCount: membership.entries.length,
    membershipHash: membership.membershipHash,
    searchContentHash: search.searchContentHash,
    searchTermCount: search.termCount,
    searchVersion: `search:promotion:${input.candidate.candidateId}:${attempt}`,
  };
}

function membershipSearchEntry(
  entry: PublicJobCatalogMembershipEntry
): PublicJobCatalogSearchEntry {
  return {
    ...derivePublicJobSearchEntry(parseCatalogItem(entry.itemJson)),
    publicJobId: entry.publicJobId,
    publicJobVersion: entry.publicJobVersion,
  };
}

function catalogCopyMembers(
  retained: PublicJobCatalogMembershipEntry[],
  retainedSearch: PublicJobCatalogSearchEntry[]
): CatalogCopyMember[] {
  const termCounts = new Map(
    retainedSearch.map((entry) => [entry.publicJobId, entry.terms.length])
  );
  return retained.map((entry) => ({
    facetCount: entry.locationFacets.length,
    publicJobId: entry.publicJobId,
    termCount: termCounts.get(entry.publicJobId) ?? 0,
  }));
}

async function readCurrentMembership(db: D1Database, catalogVersion: string) {
  const rows = await db
    .prepare(
      `SELECT public_job_id,public_job_version,eligibility_decision_version,
              item_json,detail_json,location_facets_json,public_content_hash,
              eligibility_decision_hash
         FROM public_job_catalog_members
        WHERE catalog_version=? ORDER BY public_job_id`
    )
    .bind(catalogVersion)
    .all<{
      detail_json: string;
      eligibility_decision_hash: string;
      eligibility_decision_version: number;
      item_json: string;
      location_facets_json: string;
      public_content_hash: string;
      public_job_id: string;
      public_job_version: number;
    }>();
  return rows.results.map(
    (row): PublicJobCatalogMembershipEntry => ({
      detailJson: row.detail_json,
      eligibilityDecisionHash: row.eligibility_decision_hash,
      eligibilityDecisionVersion: row.eligibility_decision_version,
      itemJson: row.item_json,
      locationFacets: parseLocationFacets(row.location_facets_json),
      publicContentHash: row.public_content_hash,
      publicJobId: row.public_job_id,
      publicJobVersion: row.public_job_version,
    })
  );
}

// The head flip stays a single atomic batch: candidate rows, the immutable
// seal, and the guarded pointer advance commit together after the copied
// predecessor rows were staged in bounded chunks.
export function catalogActivationStatements(
  db: D1Database,
  input: CatalogPromotionStatementInput
) {
  const { candidate, catalogHead, prepared, timestamp } = input;
  return [
    candidateCatalogMember(db, input),
    candidateSearchRow(db, input),
    candidateSearchTerms(db, input),
    candidateLocationFacets(db, input),
    db
      .prepare(
        `INSERT INTO public_job_catalog_seals (
          catalog_version,membership_hash,member_count,search_document_count,
          search_content_hash,search_term_count,location_facet_count,sealed_at
        ) VALUES (?,?,?,?,?,?,?,?)`
      )
      .bind(
        prepared.catalogVersion,
        prepared.membershipHash,
        prepared.memberCount,
        prepared.memberCount,
        prepared.searchContentHash,
        prepared.searchTermCount,
        prepared.locationFacetCount,
        timestamp
      ),
    db
      .prepare(
        `UPDATE public_job_catalog_head_pointer
            SET current_version=?,updated_at=?
          WHERE singleton=1 AND current_version=?`
      )
      .bind(prepared.catalogVersion, timestamp, catalogHead.current_version),
    assertion(db, 1, "SELECT changes()", []),
    assertion(
      db,
      1,
      `SELECT COUNT(*) FROM public_job_catalog_head_pointer
        WHERE singleton=1 AND current_version=?`,
      [prepared.catalogVersion]
    ),
    assertion(db, 1, "SELECT COUNT(*) FROM public_jobs WHERE id=?", [
      candidate.publicJobId,
    ]),
  ];
}

export function catalogVersionStatement(
  db: D1Database,
  input: CatalogPromotionStatementInput
) {
  const { candidate, catalogHead, prepared, timestamp } = input;
  const materialChangedAt =
    candidate.version.materialChangedAt > catalogHead.material_changed_at
      ? candidate.version.materialChangedAt
      : catalogHead.material_changed_at;
  return db
    .prepare(
      `INSERT INTO public_job_catalog_versions (
        version,predecessor_version,membership_hash,member_count,
        search_document_count,search_content_hash,search_term_count,
        location_facet_count,representation_updated_at,material_changed_at,
        search_index_version,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      prepared.catalogVersion,
      catalogHead.current_version,
      prepared.membershipHash,
      prepared.memberCount,
      prepared.memberCount,
      prepared.searchContentHash,
      prepared.searchTermCount,
      prepared.locationFacetCount,
      timestamp,
      materialChangedAt,
      prepared.searchVersion,
      timestamp
    );
}

function candidateFacets(candidate: PublicProjectionCandidate) {
  return candidate.locations.map(
    (location): PublicJobCatalogLocationFacet =>
      promotionLocationFacet(location)
  );
}

function liveCatalogPayload(
  candidate: PublicProjectionCandidate,
  verifiedAt: string
) {
  // biome-ignore assist/source/useSortedKeys: SQLite validates byte-identical view payloads.
  const locations = candidate.item.locations.map((location) => ({
    role: location.role,
    scope: location.scope,
    displayName: location.displayName,
    countryCode: location.countryCode,
    region: location.region,
    locality: location.locality,
    postalCode: location.postalCode,
    coordinates: location.coordinates,
    coordinateKind: location.coordinateKind,
    bounds: location.bounds,
  }));
  const sources = candidate.item.sources.map((source) => ({
    name: source.name,
    url: source.url,
  }));
  // biome-ignore assist/source/useSortedKeys: SQLite validates byte-identical view payloads.
  const item = {
    application: { available: true },
    canonicalPath: candidate.item.canonicalPath,
    canonicalSlug: candidate.item.canonicalSlug,
    compensation:
      candidate.item.compensation === null
        ? null
        : (JSON.parse(candidate.version.compensationJson) as unknown),
    datePosted: candidate.item.datePosted
      ? {
          provenance: candidate.item.datePosted.provenance,
          value: candidate.item.datePosted.value,
        }
      : null,
    employmentTypes: JSON.parse(
      candidate.version.employmentTypesJson
    ) as unknown,
    freshness: {
      materialChangedAt: candidate.version.materialChangedAt,
      verifiedAt,
    },
    locations,
    organization: { name: candidate.version.organizationName },
    publicId: candidate.publicJobId,
    publicJobVersion: candidate.publicJobVersion,
    sources,
    title: candidate.version.title,
    validThrough: candidate.item.validThrough
      ? {
          provenance: candidate.item.validThrough.provenance,
          value: candidate.item.validThrough.value,
        }
      : null,
    workplaceType: candidate.version.workplaceType,
    status: "active",
  };
  return {
    detailJson: JSON.stringify({
      ...item,
      descriptionHtml: candidate.version.descriptionHtml,
      schemaVersion: "public-job-detail-v1",
    }),
    itemJson: JSON.stringify(item),
  };
}
