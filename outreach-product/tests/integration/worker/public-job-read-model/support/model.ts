import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type {
  derivePublicJobSearchEntry,
  PublicJobCatalogLocationFacet,
} from "../../../../../worker/public-jobs/catalog";
import { normalizePublicJobListRequest } from "../../../../../worker/public-jobs/query";
import type {
  PublicJobListItem,
  PublicJobReadRow,
} from "../../../../../worker/public-jobs/schemas";
import { hash, makePublicId } from "./appendterminaldecision";

export interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

export const testEnv = env as TestEnv;

export const timestamp = "2026-07-22T12:00:00.000Z";

export const cursorSecret = "public-cursor-integration-secret";

export const activationSealPattern = /must precede activation/u;

export const catalogSealMismatchPattern = /seal does not match version/u;

export const locationFacetCountPattern = /location facet count/u;

export const payloadIdentityPattern =
  /catalog item is invalid|payload identity/u;

export const malformedCatalogItemPattern = /catalog item is invalid/u;

export const malformedCatalogDetailPattern = /catalog detail is invalid/u;

export const privateSearchContentPattern = /differs from its public member/u;

export const routingIdentityPattern = /location facets do not match payload/u;

export const searchCountPattern =
  /search count|does not match its search rows/u;

export const searchRowsMismatchPattern = /does not match its search rows/u;

export const catalogMembershipMismatchPattern =
  /does not match its derived membership/u;

export const hashPattern = /^[0-9a-f]{64}$/u;

export const searchImmutablePattern = /search rows are immutable/u;

export const allFields = [
  "title",
  "organization_name",
  "locations",
  "description",
  "date_posted",
  "valid_through",
  "employment_types",
  "compensation",
  "source_name",
  "source_url",
];

export interface CatalogCandidateRow extends PublicJobReadRow {
  detail_json: string;
  eligibility_decision_hash: string;
  eligibility_decision_version: number;
  item_json: string;
  public_content_hash: string;
  representation_updated_at: string;
}

export interface PublishCatalogOptions {
  detailValue?: (detail: unknown) => unknown;
  facetValue?: (
    facet: PublicJobCatalogLocationFacet
  ) => PublicJobCatalogLocationFacet;
  itemValue?: (item: PublicJobListItem) => unknown;
  omitFacets?: boolean;
  omitSearch?: boolean;
  sealMembershipHash?: string;
  searchValue?: (
    search: ReturnType<typeof derivePublicJobSearchEntry>
  ) => ReturnType<typeof derivePublicJobSearchEntry>;
  versionMembershipHash?: string;
  versionSearchContentHash?: string;
}

export function request(parameters: URLSearchParams) {
  return {
    ...normalizePublicJobListRequest(parameters),
    cursorSecret,
  };
}

export async function seedSource(source: string, allowedFields = allFields) {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO public_source_display_label_versions (
        source_key,version,predecessor_version,display_label,created_at
      ) VALUES (?,1,NULL,?,?)`
    ).bind(source, `Source ${source}`, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_source_display_label_heads (
        source_key,current_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(source, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO source_publication_policy_versions (
        source_key,version,predecessor_version,approval_state,
        publication_scope,publication_enabled,allowed_fields_json,
        attribution_mode,max_verbatim_chars,source_origin_url,terms_url,
        terms_checked_at,robots_url,robots_checked_at,evidence_json,
        decision_note,policy_hash,idempotency_key,created_at
      ) VALUES (?,1,NULL,'approved','fact_summary',1,?,'source_link',5000,
        ?,'',NULL,'',NULL,'{}','integration policy',?,'policy-v1',?)`
    ).bind(
      source,
      JSON.stringify(allowedFields),
      `https://${source}.example.test/`,
      hash(source.length),
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO source_publication_policy_heads (
        source_key,current_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(source, timestamp),
  ]);
}

export async function seedPublishedJob(input: {
  aliases?: string[];
  employmentTypesJson?: string;
  fields?: string[];
  index: number;
  source: string;
  sourceUrl?: string;
  title?: string;
}) {
  const publicJobId = makePublicId(input.index);
  const slug = `english-teacher-${input.index}`;
  const listingId = `listing-private-${input.index}`;
  const organizationId = `organization-private-${input.index}`;
  const locationId = `location-private-${input.index}`;
  const positionId = `source-position-private-${input.index}`;
  const routeId = `route-private-${input.index}`;
  const fields = input.fields ?? allFields;
  const title = input.title ?? `English Teacher ${input.index}`;
  const sourceUrl =
    input.sourceUrl ??
    `https://${input.source}.example.test/jobs/${input.index}`;
  const materialJson = JSON.stringify({ sourceUrl });
  const compensation = {
    amount: {
      currency: "USD",
      maximum: 35,
      minimum: 30,
      period: "hour",
      qualifier: "range",
      taxBasis: "gross",
    },
    hourlyUsd: {
      basis: "listed",
      fxAsOf: "2026-07-22",
      maximum: 35,
      minimum: 30,
      taxBasis: "gross",
    },
    kind: "amount",
  };
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO job_listings (
        id,board,title,company,contact_name,country,location,salary,
        description,source_url,apply_url,employer_id,source_reference,
        first_seen_at,updated_at,inventory_status,material_hash,
        material_hash_version,material_version,material_changed_at,
        source_posted_date,source_posted_date_provenance
      ) VALUES (?,?,?,?,?,'KR','Seoul','private salary',?,?,?,?,?,?,?,
        'active',?,1,1,?,'2026-07-01','board-published')`
    ).bind(
      listingId,
      input.source,
      title,
      `School ${input.index}`,
      `candidate-private-${input.index}`,
      `raw private description private-document-${input.index}.pdf private-gmail-thread-${input.index}`,
      sourceUrl,
      `https://apply-private.example.test/${input.index}`,
      `employer-private-${input.index}`,
      `reference-private-${input.index}`,
      timestamp,
      timestamp,
      hash(input.index),
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO job_listing_versions (
        listing_id,material_version,material_hash,material_hash_version,
        material_json,source_posted_date,source_posted_date_raw,
        source_posted_date_provenance,source_expiry_date,
        source_expiry_date_raw,source_expiry_date_provenance,created_at
      ) VALUES (?,1,?,1,?,'2026-07-01','','board-published',
        '2099-12-31','','board-published',?)`
    ).bind(listingId, hash(input.index), materialJson, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO organizations (
        id,country_code,country_name,name,identity_key,city,region,
        website_url,canonical_domain,market_segment,status,
        outreach_eligibility,evidence_url,last_verified_at,created_at,updated_at
      ) VALUES (?,'KR','South Korea',?,?,'Seoul','',?,'','school','active',
        'eligible','',?,?,?)`
    ).bind(
      organizationId,
      `School ${input.index}`,
      `organization-key-${input.index}`,
      `https://organization-private-${input.index}.example.test`,
      timestamp,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO application_routes (
        id,job_id,kind,destination,source_evidence,last_verified_at,status,
        created_at,updated_at
      ) VALUES (?,?,'email',?,'private evidence',?,'active',?,?)`
    ).bind(
      routeId,
      listingId,
      `recipient-private-${input.index}@example.test`,
      timestamp,
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO canonical_locations (
        id,resolution_state,input_label,display_name,country_code,region,
        locality,provider,provider_place_id,latitude,longitude,
        resolution_evidence_json,created_at,updated_at
      ) VALUES (?,'resolved','Seoul','Seoul, South Korea','KR','Seoul',
        'Seoul','mapbox',?,37.5665,126.978,'{}',?,?)`
    ).bind(locationId, `mapbox-private-${input.index}`, timestamp, timestamp),
    testEnv.DB.prepare(
      "INSERT INTO public_jobs(id,created_at) VALUES (?,?)"
    ).bind(publicJobId, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_aliases(public_job_id,slug,created_at)
       VALUES (?,?,?)`
    ).bind(publicJobId, slug, timestamp),
    ...(input.aliases ?? []).map((alias) =>
      testEnv.DB.prepare(
        `INSERT INTO public_job_aliases(public_job_id,slug,created_at)
         VALUES (?,?,?)`
      ).bind(publicJobId, alias, timestamp)
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_job_versions (
        public_job_id,version,predecessor_version,canonical_slug,title,
        organization_id,organization_name,organization_resolution_state,
        workplace_type,date_posted,date_posted_provenance,valid_through,
        valid_through_provenance,employment_types_json,compensation_json,
        description_html,public_content_hash,public_content_hash_version,
        material_changed_at,content_schema_version,producer_kind,producer_id,
        idempotency_key,created_at
      ) VALUES (?,1,NULL,?,?,? ,?,'resolved','onsite','2026-07-01',
        'employer-original','2099-12-31','employer-original',?,?,?, ?,1,?,1,
        'deterministic','integration','content-v1',?)`
    ).bind(
      publicJobId,
      slug,
      title,
      organizationId,
      `School ${input.index}`,
      input.employmentTypesJson ?? '["fullTime"]',
      JSON.stringify(compensation),
      `<section><h2>Overview</h2><p>Teach English in Seoul ${input.index}.</p></section>`,
      hash(input.index + 1),
      timestamp,
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_job_version_locations (
        public_job_id,public_job_version,ordinal,location_role,location_id,
        resolution_state,display_name,country_code,region,locality,postal_code,
        location_json,created_at
      ) VALUES (?,1,0,'worksite',?,'resolved','Seoul, South Korea','KR',
        'Seoul','Seoul','',? ,?)`
    ).bind(
      publicJobId,
      locationId,
      JSON.stringify({
        bounds: [126.8, 37.4, 127.1, 37.7],
        coordinateKind: "point",
        coordinates: { latitude: 37.5665, longitude: 126.978 },
        routing: { citySlug: "seoul", countrySlug: "south-korea" },
        scope: "locality",
      }),
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_job_heads(public_job_id,current_version,updated_at)
       VALUES (?,1,?)`
    ).bind(publicJobId, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO job_source_positions (
        id,listing_id,source_key,position_key,position_kind,created_at
      ) VALUES (?,?,?,'direct','direct',?)`
    ).bind(positionId, listingId, input.source, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO job_source_position_mapping_versions (
        source_position_id,version,predecessor_version,listing_id,
        listing_material_version,mapping_state,public_job_id,reason_code,
        mapping_hash,idempotency_key,created_at
      ) VALUES (?,1,NULL,?,1,'mapped',?,'initial',?,'mapping-v1',?)`
    ).bind(
      positionId,
      listingId,
      publicJobId,
      hash(input.index + 2),
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO job_source_position_mapping_heads (
        source_position_id,current_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(positionId, timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_eligibility_decisions (
        public_job_id,decision_version,predecessor_version,public_job_version,
        publication_state,route_disposition,browse_eligible,
        organic_index_eligible,job_posting_eligible,source_open_state,
        application_route_id,application_route_state,content_review_state,
        privacy_state,verified_at,redirect_public_job_id,reason_codes_json,
        decision_note,evaluator_kind,evaluator_version,decision_hash,
        idempotency_key,decided_at
      ) VALUES (?,1,NULL,1,'published','serve',1,1,1,'open',?,'valid',
        'approved','passed',?,NULL,'["integration"]','integration','system',
        'v1',?,'decision-v1',?)`
    ).bind(publicJobId, routeId, timestamp, hash(input.index + 3), timestamp),
    testEnv.DB.prepare(
      `INSERT INTO public_job_decision_sources (
        public_job_id,decision_version,source_position_id,
        source_mapping_version,source_key,policy_version,contribution_kind,
        fields_used_json,created_at
      ) VALUES (?,1,?,1,?,1,'public_content',?,?)`
    ).bind(
      publicJobId,
      positionId,
      input.source,
      JSON.stringify(fields),
      timestamp
    ),
    testEnv.DB.prepare(
      `INSERT INTO public_job_eligibility_heads (
        public_job_id,current_decision_version,updated_at
      ) VALUES (?,1,?)`
    ).bind(publicJobId, timestamp),
  ]);
  return { publicId: publicJobId, slug };
}
