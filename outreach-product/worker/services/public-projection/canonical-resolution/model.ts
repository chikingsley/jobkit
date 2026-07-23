import { getCountries } from "libphonenumber-js";
import { z } from "zod";
import type { readExactProjectionListingSnapshot } from "../listing-snapshot";
import type {
  MapboxFeature,
  PermanentLocationQuery,
} from "../mapbox-location-resolver";
import type { readProjectionAnalysisPrerequisites } from "../prerequisites";
import { normalizeText } from "./support";

export const ORGANIZATION_RESOLVER_VERSION = "organization-resolver-v1";

export const LOCATION_RESOLVER_VERSION = "mapbox-location-resolver-v1-us";

export const MAX_LOCATION_ASSERTIONS_PER_POSITION = 10;

export const MAX_ORGANIZATION_CANDIDATES = 50;

export const MAX_D1_BOUND_JSON_BYTES = 1_000_000;

export const MAX_D3_BATCH_STATEMENTS = 50;

export const PUBLIC_SUFFIX_LIST_VERSION = "tldts-7.4.8-icann";

export const COUNTRY_CODE_PATTERN = /^[a-z]{2}$/u;

export const TRAILING_PATH_SEPARATOR_PATTERN = /\/+$/u;

export const TRAILING_PERIOD_PATTERN = /\.$/u;

export const SealedResolutionCheckpointSchema = z
  .object({
    analysisHashes: z
      .object({
        content: z.string().length(64),
        matchFacts: z.string().length(64),
        position: z.string().length(64),
      })
      .strict(),
    identity: z
      .object({
        contractVersion: z.literal(1),
        signals: z.array(
          z.object({
            hash: z.string().length(64),
            kind: z.enum(["material_clone_v1", "source_reference_v1"]),
          })
        ),
        sourcePosition: z.object({
          id: z.string().min(1),
          positionKey: z.string().min(1),
          positionKind: z.enum(["direct", "extracted"]),
          sourceOrdinal: z.number().int().nonnegative(),
        }),
        state: z.literal("derived"),
      })
      .passthrough(),
    listingInputHash: z.string().length(64),
    materialHash: z.string().length(64),
    materialVersion: z.number().int().positive(),
    positionPayloadHash: z.string().length(64),
    sourceOrdinal: z.number().int().nonnegative(),
    sourcePositionId: z.string().min(1),
    state: z.literal("sealed"),
  })
  .passthrough();

export interface DuplicateBatchRow {
  canonical_identity_state: "pending";
  input_hash: string;
  member_input_hash: string;
  member_source_position_id: string;
}

export interface OrganizationRow {
  accepted_opportunity_link: number;
  canonical_domain: string;
  city: string;
  country_code: string;
  country_name: string;
  id: string;
  name: string;
  opportunity_link: number;
  region: string;
  source_employer_link: number;
  status: "active" | "closed" | "invalid" | "stale" | "unverified";
}

export interface OrganizationEvidenceRow {
  evidence_status: string;
  id: string;
  observed_at: string;
  organization_id: string;
  source_url: string;
}

export interface OrganizationDomainMappingRow {
  accepted_at: string;
  evidence_url: string;
  id: string;
  mapping_kind:
    | "employer_host"
    | "employer_registrable_domain"
    | "hosted_ats_tenant";
  normalized_host: string;
  organization_id: string;
  path_prefix: string;
  public_suffix_list_version: string;
  registrable_domain: string;
}

export interface OrganizationRouteIdentity {
  host: string;
  path: string;
  registrableDomain: string;
}

export interface OrganizationResolutionCandidate {
  acceptedOpportunityLink: boolean;
  exactCountry: boolean;
  exactDomain: boolean;
  exactLocality: boolean;
  exactName: boolean;
  row: OrganizationRow;
  rowEvidence: OrganizationEvidenceRow[];
  sourceEmployerLink: boolean;
  tier: number;
  verifiedDomainMappings: OrganizationDomainMappingRow[];
}

export interface OrganizationEvidenceArtifact {
  createdAt: string;
  evidenceHash: string;
  evidenceKind:
    | "employer_domain"
    | "explicit_opportunity_link"
    | "name_country_candidate"
    | "name_country_locality"
    | "organization_record"
    | "organization_status"
    | "source_employer_id";
  evidenceTier: number;
  observedAt: string;
  ordinal: number;
  organizationId: string | null;
  polarity: "candidate" | "conflicting" | "positive";
  resolutionId: string;
  runId: string;
  sourceKey: string;
  sourceReference: string;
}

export interface OrganizationCandidateArtifact {
  candidateHash: string;
  countryCode: string;
  createdAt: string;
  evidenceTier: number;
  normalizedDomain: string;
  normalizedLocality: string;
  normalizedName: string;
  ordinal: number;
  organizationId: string;
  organizationStatus: OrganizationRow["status"];
  resolutionId: string;
  runId: string;
  selected: number;
}

export type OrganizationReasonCode =
  | "organization_candidate_only"
  | "organization_employer_domain"
  | "organization_evidence_conflict"
  | "organization_explicit_link"
  | "organization_input_schema_invalid"
  | "organization_input_snapshot_changed"
  | "organization_intermediary_only"
  | "organization_invalid_candidate"
  | "organization_name_country_locality"
  | "organization_no_candidate"
  | "organization_source_employer_id";

export type ResolutionState =
  | "ambiguous"
  | "blocked"
  | "resolved"
  | "unresolved";

export interface OrganizationResolutionArtifact {
  assertedCountryCode: string | null;
  candidateCount: number;
  candidateDigest: string;
  candidates: OrganizationCandidateArtifact[];
  evidence: OrganizationEvidenceArtifact[];
  evidenceCount: number;
  evidenceDigest: string;
  normalizedCompanyName: string;
  reasonCode: OrganizationReasonCode;
  resolutionHash: string;
  resolutionId: string;
  resolvedLocality: string;
  selectedDisplayName: string;
  selectedOrganizationId: string | null;
  state: ResolutionState;
}

export interface LocationCandidateArtifact {
  boundsJson: string | null;
  candidateHash: string;
  contextJson: string;
  coordinateAccuracy: string;
  countryCode: string | null;
  createdAt: string;
  featureType: MapboxFeature["properties"]["feature_type"];
  fullName: string;
  latitude: number;
  locality: string;
  longitude: number;
  matchCodeJson: string;
  ordinal: number;
  postalCode: string;
  preferredName: string;
  providerOrder: number;
  providerPlaceId: string;
  region: string;
  resolutionId: string;
  runId: string;
  viable: number;
}

export interface LocationEvidenceArtifact {
  createdAt: string;
  evidenceHash: string;
  evidenceJson: string;
  evidenceKind:
    | "address_match_code"
    | "country_context"
    | "parent_context"
    | "provider_candidate"
    | "source_assertion";
  ordinal: number;
  resolutionId: string;
  runId: string;
  sourceReference: string;
}

export interface LocationResolutionArtifact {
  assertedCountryCode: string | null;
  boundsJson: string | null;
  candidateCount: number;
  candidateDigest: string;
  candidates: LocationCandidateArtifact[];
  coordinateKind: string;
  countryCode: string | null;
  createdAt: string;
  displayName: string;
  evidence: LocationEvidenceArtifact[];
  evidenceDigest: string;
  featureType: string;
  latitude: number | null;
  literalEvidence: string;
  literalLabel: string;
  locality: string;
  locationRole: "applicant_area" | "unknown" | "worksite";
  longitude: number | null;
  normalizedLabel: string;
  ordinal: number;
  postalCode: string;
  proposedCanonicalLocationId: string;
  provider: string;
  providerEvidence: ProviderEvidenceArtifact | null;
  queriedAt: string | null;
  reasonCode: LocationReasonCode;
  region: string;
  requestHash: string | null;
  resolutionHash: string;
  resolutionId: string;
  responseHash: string | null;
  runId: string;
  scope:
    | "address"
    | "countrywide"
    | "locality"
    | "region"
    | "unknown"
    | "worldwide";
  selectedProviderPlaceId: string;
  semanticKind: PermanentLocationQuery["semanticKind"];
  state: ResolutionState;
  viableCandidateCount: number;
  workplaceType: "hybrid" | "onsite" | "remote" | "unknown";
}

export type LocationReasonCode =
  | "location_assertion_limit_exceeded"
  | "location_country_conflict"
  | "location_countrywide_match"
  | "location_exact_provider_match"
  | "location_invalid_assertion"
  | "location_multiple_viable_candidates"
  | "location_no_viable_candidate"
  | "location_parent_conflict"
  | "location_permanent_storage_required"
  | "location_provider_auth"
  | "location_provider_rate_limit"
  | "location_provider_schema"
  | "location_provider_timeout"
  | "location_provider_transport"
  | "remote_applicant_area_unbounded";

export interface ProviderEvidenceArtifact {
  createdAt: string;
  orderedCandidateIdsJson: string;
  permanent: number;
  provider: "mapbox-geocoding-v6";
  queriedAt: string;
  requestHash: string;
  requestJson: string;
  resolutionId: string;
  responseHash: string;
  responseJson: string;
  runId: string;
}

export interface ResolutionInputs {
  analysisGuard: NonNullable<
    Awaited<ReturnType<typeof readProjectionAnalysisPrerequisites>>["guard"]
  >;
  batch: DuplicateBatchRow;
  checkpoint: z.infer<typeof SealedResolutionCheckpointSchema>;
  listing: Awaited<ReturnType<typeof readExactProjectionListingSnapshot>>;
  position: NonNullable<
    Awaited<ReturnType<typeof readProjectionAnalysisPrerequisites>>["position"]
  >["positions"][number];
}

export interface CanonicalResolutionResult {
  blocked: number;
  resolved: number;
  retried: number;
  sealed: number;
  state: ResolutionState | "retry";
}

export class CanonicalResolutionInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CanonicalResolutionInputError";
  }
}

const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });

export const countryCodeByName = new Map(
  getCountries().flatMap((code) => {
    const displayName = countryDisplayNames.of(code);
    return displayName ? [[normalizeText(displayName), code] as const] : [];
  })
);

export const countryAliases = new Map([
  ["czech republic", "CZ"],
  ["iran", "IR"],
  ["russia", "RU"],
  ["south korea", "KR"],
  ["taiwan", "TW"],
]);
