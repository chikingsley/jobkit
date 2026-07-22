import { getCountries } from "libphonenumber-js";
import { getDomain } from "tldts";
import { z } from "zod";
import { canonicalIdentitySignal } from "../../../src/features/public/identity-signals";
import { normalizeIdentityText } from "../../../src/features/public/source-position-identity";
import {
  EXACT_PROJECTION_ANALYSIS_GUARD_SQL,
  exactProjectionAnalysisGuardBindings,
} from "./analysis-guard";
import {
  canonicalJson,
  canonicalSha256,
  compareUtf8Bytes,
  sha256Hex,
} from "./hash";
import { projectionRunCounterStatement } from "./listing-items";
import {
  ProjectionListingSnapshotError,
  readExactProjectionListingSnapshot,
} from "./listing-snapshot";
import {
  LocationProviderError,
  type LocationProviderErrorCode,
  type MapboxBoundingBox,
  type MapboxFeature,
  type PermanentLocationQuery,
  type PermanentLocationResolver,
  type PermanentLocationResponse,
} from "./mapbox-location-resolver";
import {
  assertClaimedPositionUpdate,
  assertPositionClaimLease,
  type ClaimedProjectionPosition,
  claimedPositionUpdateStatement,
} from "./position-items";
import { readProjectionAnalysisPrerequisites } from "./prerequisites";

const ORGANIZATION_RESOLVER_VERSION = "organization-resolver-v1";
const LOCATION_RESOLVER_VERSION = "mapbox-location-resolver-v1-us";
const MAX_LOCATION_ASSERTIONS_PER_POSITION = 10;
const MAX_ORGANIZATION_CANDIDATES = 50;
const MAX_D1_BOUND_JSON_BYTES = 1_000_000;
const MAX_D3_BATCH_STATEMENTS = 50;
const PUBLIC_SUFFIX_LIST_VERSION = "tldts-7.4.8-icann";
const COUNTRY_CODE_PATTERN = /^[a-z]{2}$/u;
const TRAILING_PATH_SEPARATOR_PATTERN = /\/+$/u;
const TRAILING_PERIOD_PATTERN = /\.$/u;

const SealedResolutionCheckpointSchema = z
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

interface DuplicateBatchRow {
  canonical_identity_state: "pending";
  input_hash: string;
  member_input_hash: string;
  member_source_position_id: string;
}

interface OrganizationRow {
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

interface OrganizationEvidenceRow {
  evidence_status: string;
  id: string;
  observed_at: string;
  organization_id: string;
  source_url: string;
}

interface OrganizationDomainMappingRow {
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

interface OrganizationRouteIdentity {
  host: string;
  path: string;
  registrableDomain: string;
}

interface OrganizationResolutionCandidate {
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

interface OrganizationEvidenceArtifact {
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

interface OrganizationCandidateArtifact {
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

type OrganizationReasonCode =
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

type ResolutionState = "ambiguous" | "blocked" | "resolved" | "unresolved";

interface OrganizationResolutionArtifact {
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

interface LocationCandidateArtifact {
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

interface LocationEvidenceArtifact {
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

interface LocationResolutionArtifact {
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

type LocationReasonCode =
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

interface ProviderEvidenceArtifact {
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

interface ResolutionInputs {
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

interface CanonicalResolutionResult {
  blocked: number;
  resolved: number;
  retried: number;
  sealed: number;
  state: ResolutionState | "retry";
}

class CanonicalResolutionInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CanonicalResolutionInputError";
  }
}

const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryCodeByName = new Map(
  getCountries().flatMap((code) => {
    const displayName = countryDisplayNames.of(code);
    return displayName ? [[normalizeText(displayName), code] as const] : [];
  })
);
const countryAliases = new Map([
  ["czech republic", "CZ"],
  ["iran", "IR"],
  ["russia", "RU"],
  ["south korea", "KR"],
  ["taiwan", "TW"],
]);

export async function processProjectionCanonicalResolutionClaim(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  timestamp: string,
  locationResolver: PermanentLocationResolver
): Promise<CanonicalResolutionResult> {
  const rawCheckpoint = parseJsonObject(claim.checkpointJson);
  const checkpoint = SealedResolutionCheckpointSchema.safeParse(rawCheckpoint);
  if (!checkpoint.success) {
    return blockInputClaim(
      db,
      claim,
      timestamp,
      "canonical_resolution_checkpoint_invalid",
      "The sealed canonical-resolution checkpoint is invalid",
      rawCheckpoint
    );
  }

  try {
    const inputs = await readResolutionInputs(db, claim, checkpoint.data);
    let locations: LocationResolutionArtifact[];
    try {
      locations = await resolveLocations(
        claim,
        inputs,
        timestamp,
        locationResolver
      );
    } catch (error) {
      if (!(error instanceof LocationProviderError)) {
        throw error;
      }
      if (providerFailureShouldRetry(error.code, claim)) {
        return retryProviderFailure(db, claim, error, rawCheckpoint);
      }
      locations = await blockedProviderLocations(
        claim,
        inputs,
        timestamp,
        error.code
      );
    }
    const organization = await resolveOrganization(
      db,
      claim,
      inputs,
      locations,
      timestamp
    );
    const result = await sealResolution(
      db,
      claim,
      inputs,
      organization,
      locations,
      rawCheckpoint,
      timestamp
    );
    return result;
  } catch (error) {
    if (error instanceof CanonicalResolutionInputError) {
      return blockInputClaim(
        db,
        claim,
        timestamp,
        error.code,
        error.message,
        rawCheckpoint
      );
    }
    if (error instanceof ProjectionListingSnapshotError) {
      return blockInputClaim(
        db,
        claim,
        timestamp,
        error.code,
        error.message,
        rawCheckpoint
      );
    }
    throw error;
  }
}

async function readResolutionInputs(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  checkpoint: z.infer<typeof SealedResolutionCheckpointSchema>
): Promise<ResolutionInputs> {
  const [listing, batch] = await Promise.all([
    readExactProjectionListingSnapshot(db, claim.listingItemId),
    db
      .prepare(
        `SELECT batch.input_hash,batch.canonical_identity_state,
                member.source_position_id member_source_position_id,
                member.input_hash member_input_hash
           FROM public_projection_duplicate_batches batch
           JOIN public_projection_duplicate_batch_members member
             ON member.run_id=batch.run_id
          WHERE batch.run_id=? AND member.position_item_id=? LIMIT 1`
      )
      .bind(claim.runId, claim.id)
      .first<DuplicateBatchRow>(),
  ]);
  if (batch?.canonical_identity_state !== "pending") {
    throw new CanonicalResolutionInputError(
      "canonical_resolution_d2_missing",
      "The sealed D2 duplicate batch is unavailable"
    );
  }
  const prerequisites = await readProjectionAnalysisPrerequisites(db, listing);
  if (!(prerequisites.ready && prerequisites.position && prerequisites.guard)) {
    throw new CanonicalResolutionInputError(
      "canonical_resolution_analysis_snapshot_changed",
      "The exact analysis snapshot is no longer ready"
    );
  }
  const position = prerequisites.position.positions[checkpoint.sourceOrdinal];
  if (!position) {
    throw new CanonicalResolutionInputError(
      "canonical_resolution_position_missing",
      "The sealed source ordinal is outside the position analysis"
    );
  }
  const positionPayloadHash = await canonicalSha256(position);
  if (
    checkpoint.sourcePositionId !== claim.sourcePositionId ||
    checkpoint.identity.sourcePosition.id !== claim.sourcePositionId ||
    checkpoint.identity.sourcePosition.sourceOrdinal !==
      checkpoint.sourceOrdinal ||
    batch.member_source_position_id !== claim.sourcePositionId ||
    batch.member_input_hash !== claim.inputHash ||
    checkpoint.listingInputHash !== listing.inputHash ||
    checkpoint.materialHash !== listing.materialHash ||
    checkpoint.materialVersion !== listing.materialVersion ||
    checkpoint.positionPayloadHash !== positionPayloadHash ||
    checkpoint.analysisHashes.content !==
      prerequisites.checkpoint.content.payloadHash ||
    checkpoint.analysisHashes.matchFacts !==
      prerequisites.checkpoint.matchFacts.payloadHash ||
    checkpoint.analysisHashes.position !==
      prerequisites.checkpoint.position.payloadHash
  ) {
    throw new CanonicalResolutionInputError(
      "canonical_resolution_input_snapshot_changed",
      "The canonical-resolution inputs no longer match their exact seals"
    );
  }
  return {
    analysisGuard: prerequisites.guard,
    batch,
    checkpoint,
    listing,
    position,
  };
}

async function resolveLocations(
  claim: ClaimedProjectionPosition,
  inputs: ResolutionInputs,
  timestamp: string,
  resolver: PermanentLocationResolver
) {
  const assertions = locationAssertions(inputs);
  if (assertions.length === 0) {
    return [
      await unresolvedLocation(
        claim,
        timestamp,
        0,
        "",
        "",
        countryCodeForLabel(inputs.listing.material.country),
        "location_invalid_assertion"
      ),
    ];
  }
  if (assertions.length > MAX_LOCATION_ASSERTIONS_PER_POSITION) {
    return [
      await unresolvedLocation(
        claim,
        timestamp,
        0,
        `${assertions.length} location assertions`,
        assertions.map((assertion) => assertion.evidence).join("\n"),
        countryCodeForLabel(inputs.listing.material.country),
        "location_assertion_limit_exceeded",
        "blocked"
      ),
    ];
  }
  const results: LocationResolutionArtifact[] = [];
  const resolvedBoundsByLabel = new Map<string, MapboxBoundingBox>();
  for (const [ordinal, assertion] of assertions.entries()) {
    if (assertion.sourceConflict) {
      results.push(
        // biome-ignore lint/performance/noAwaitInLoops: Resolution artifacts retain deterministic canonical order.
        await unresolvedLocation(
          claim,
          timestamp,
          ordinal,
          assertion.label,
          assertion.evidence,
          assertion.countryCode,
          assertion.sourceConflict,
          "ambiguous",
          assertion
        )
      );
      continue;
    }
    if (
      assertion.locationRole === "applicant_area" &&
      assertion.scope === "worldwide" &&
      assertion.workplaceType === "remote"
    ) {
      results.push(
        await unresolvedLocation(
          claim,
          timestamp,
          ordinal,
          assertion.label,
          assertion.evidence,
          assertion.countryCode,
          "remote_applicant_area_unbounded",
          "unresolved",
          assertion
        )
      );
      continue;
    }
    const parentBounds = assertion.parentGeographies
      .map((parent) => resolvedBoundsByLabel.get(normalizeText(parent.value)))
      .find((bounds): bounds is MapboxBoundingBox => Boolean(bounds));
    const response = await resolver.resolve({
      bbox: parentBounds ?? null,
      countryCode: assertion.countryCode,
      literalLabel: assertion.label,
      semanticKind: assertion.semanticKind,
    });
    const result = await normalizeLocationResponse(
      claim,
      timestamp,
      ordinal,
      assertion,
      response
    );
    results.push(result);
    const resolvedBounds = parseBoundingBox(result.boundsJson);
    if (result.state === "resolved" && resolvedBounds) {
      resolvedBoundsByLabel.set(normalizeText(assertion.label), resolvedBounds);
    }
  }
  return finalizeLocationOrdinals(claim, results);
}

function finalizeLocationOrdinals(
  claim: ClaimedProjectionPosition,
  locations: LocationResolutionArtifact[]
) {
  const ordered = [...locations].sort(compareLocationOrdinal);
  return Promise.all(
    ordered.map((location, ordinal) =>
      resealLocationOrdinal(claim, location, ordinal)
    )
  );
}

function compareLocationOrdinal(
  left: LocationResolutionArtifact,
  right: LocationResolutionArtifact
) {
  const roleOrder = { applicant_area: 1, unknown: 2, worksite: 0 } as const;
  const scopeOrder = {
    address: 0,
    countrywide: 3,
    locality: 1,
    region: 2,
    unknown: 5,
    worldwide: 4,
  } as const;
  return (
    roleOrder[left.locationRole] - roleOrder[right.locationRole] ||
    scopeOrder[left.scope] - scopeOrder[right.scope] ||
    compareUtf8Bytes(
      normalizeText(left.countryCode ?? left.assertedCountryCode ?? ""),
      normalizeText(right.countryCode ?? right.assertedCountryCode ?? "")
    ) ||
    compareUtf8Bytes(normalizeText(left.region), normalizeText(right.region)) ||
    compareUtf8Bytes(
      normalizeText(left.locality),
      normalizeText(right.locality)
    ) ||
    compareUtf8Bytes(
      normalizeText(left.displayName),
      normalizeText(right.displayName)
    ) ||
    compareUtf8Bytes(
      left.proposedCanonicalLocationId,
      right.proposedCanonicalLocationId
    ) ||
    compareUtf8Bytes(
      locationOrdinalFallback(left),
      locationOrdinalFallback(right)
    )
  );
}

function locationOrdinalFallback(location: LocationResolutionArtifact) {
  return canonicalJson({
    literalEvidence: location.literalEvidence,
    literalLabel: location.normalizedLabel,
    reasonCode: location.reasonCode,
    requestHash: location.requestHash,
    responseHash: location.responseHash,
    selectedProviderPlaceId: location.selectedProviderPlaceId,
    semanticKind: location.semanticKind,
    state: location.state,
    workplaceType: location.workplaceType,
  });
}

async function resealLocationOrdinal(
  claim: ClaimedProjectionPosition,
  location: LocationResolutionArtifact,
  ordinal: number
): Promise<LocationResolutionArtifact> {
  const resolutionId = await sha256Id(
    "location-resolution-v1_",
    `jobkit-projection-location-resolution/v1\0${claim.runId}\0${claim.id}\0${ordinal}\0${claim.inputHash}`
  );
  const candidates = location.candidates.map((candidate) => ({
    ...candidate,
    resolutionId,
  }));
  const evidence = await Promise.all(
    location.evidence.map(async (item) => {
      const {
        createdAt,
        evidenceHash: _evidenceHash,
        ordinal: evidenceOrdinal,
        ...withoutHash
      } = item;
      const rekeyed = { ...withoutHash, resolutionId };
      return {
        ...rekeyed,
        createdAt,
        evidenceHash: await canonicalSha256(rekeyed),
        ordinal: evidenceOrdinal,
      };
    })
  );
  const candidateDigest = await canonicalSha256(
    candidates.map(({ createdAt: _createdAt, ...candidate }) => candidate)
  );
  const evidenceDigest = await canonicalSha256(
    evidence.map(({ createdAt: _createdAt, ...item }) => item)
  );
  const providerEvidence = location.providerEvidence
    ? { ...location.providerEvidence, resolutionId }
    : null;
  const {
    candidates: _candidates,
    createdAt,
    evidence: _evidence,
    providerEvidence: _providerEvidence,
    resolutionHash: _resolutionHash,
    resolutionId: _resolutionId,
    ...withoutHash
  } = location;
  const resealed = {
    ...withoutHash,
    candidateDigest,
    evidenceDigest,
    ordinal,
  };
  return {
    ...resealed,
    candidates,
    createdAt,
    evidence,
    providerEvidence,
    resolutionHash: await canonicalSha256(resealed),
    resolutionId,
  };
}

function locationAssertions(inputs: ResolutionInputs) {
  const assertedCountry = countryCodeForLabel(inputs.listing.material.country);
  const fromPosition = inputs.position.locations.map((location) => ({
    addressComponents: [...location.addressComponents].sort((left, right) =>
      compareUtf8Bytes(
        canonicalJson({
          evidence: left.evidence,
          kind: left.kind,
          value: normalizeText(left.value),
        }),
        canonicalJson({
          evidence: right.evidence,
          kind: right.kind,
          value: normalizeText(right.value),
        })
      )
    ),
    evidence: location.evidence,
    label: location.value.trim(),
    locationRole: location.role,
    parentGeographies: [...location.parentGeographies].sort((left, right) =>
      compareUtf8Bytes(
        canonicalJson({
          evidence: left.evidence,
          semanticKind: left.semanticKind,
          value: normalizeText(left.value),
        }),
        canonicalJson({
          evidence: right.evidence,
          semanticKind: right.semanticKind,
          value: normalizeText(right.value),
        })
      )
    ),
    scope: location.scope,
    semanticKind: location.semanticKind,
    workplaceType: location.workplaceType,
  }));
  let candidates = fromPosition;
  const listingLocation = inputs.listing.material.location.trim();
  if (candidates.length === 0 && listingLocation) {
    candidates = [
      {
        addressComponents: [],
        evidence: inputs.listing.material.location,
        label: listingLocation,
        locationRole: "unknown" as const,
        parentGeographies: [],
        scope: "unknown" as const,
        semanticKind: "unknown" as const,
        workplaceType: "unknown" as const,
      },
    ];
  }
  const kindOrder = new Map([
    ["country", 0],
    ["region", 1],
    ["city", 2],
    ["postal_code", 3],
    ["address", 4],
    ["unknown", 5],
  ]);
  const ordered = [...candidates].sort(
    (left, right) =>
      (kindOrder.get(left.semanticKind) ?? 5) -
        (kindOrder.get(right.semanticKind) ?? 5) ||
      compareUtf8Bytes(
        locationAssertionCanonicalKey(left),
        locationAssertionCanonicalKey(right)
      )
  );
  const unique = new Map<string, (typeof candidates)[number]>();
  for (const candidate of ordered) {
    const key = locationAssertionCanonicalKey(candidate);
    if (!unique.has(key)) {
      unique.set(key, candidate);
    }
  }
  return [...unique.values()].map((candidate) => {
    const parentCountries = [
      ...new Set(
        candidate.parentGeographies
          .filter((parent) => parent.semanticKind === "country")
          .map((parent) => countryCodeForLabel(parent.value))
          .filter((country): country is string => Boolean(country))
      ),
    ].sort(compareUtf8Bytes);
    const assertedCountries = [
      ...new Set(
        [
          assertedCountry,
          ...parentCountries,
          candidate.semanticKind === "country"
            ? countryCodeForLabel(candidate.label)
            : null,
        ].filter((country): country is string => Boolean(country))
      ),
    ];
    const parentConflict = ["city", "country", "region"].some(
      (semanticKind) =>
        new Set(
          candidate.parentGeographies
            .filter((parent) => parent.semanticKind === semanticKind)
            .map((parent) => normalizeText(parent.value))
        ).size > 1
    );
    let sourceConflict:
      | "location_country_conflict"
      | "location_parent_conflict"
      | null = null;
    if (assertedCountries.length > 1) {
      sourceConflict = "location_country_conflict";
    } else if (parentConflict) {
      sourceConflict = "location_parent_conflict";
    }
    return {
      ...candidate,
      countryCode:
        assertedCountry ??
        parentCountries[0] ??
        (candidate.semanticKind === "country"
          ? countryCodeForLabel(candidate.label)
          : null),
      sourceConflict,
    };
  });
}

function locationAssertionCanonicalKey(candidate: {
  addressComponents: Array<{
    evidence: string;
    kind: string;
    value: string;
  }>;
  evidence: string;
  label: string;
  locationRole: string;
  parentGeographies: Array<{
    evidence: string;
    semanticKind: string;
    value: string;
  }>;
  scope: string;
  semanticKind: string;
  workplaceType: string;
}) {
  return canonicalJson({
    addressComponents: candidate.addressComponents.map((component) => ({
      evidence: component.evidence,
      kind: component.kind,
      value: normalizeText(component.value),
    })),
    evidence: candidate.evidence,
    label: normalizeText(candidate.label),
    locationRole: candidate.locationRole,
    parentGeographies: candidate.parentGeographies.map((parent) => ({
      evidence: parent.evidence,
      semanticKind: parent.semanticKind,
      value: normalizeText(parent.value),
    })),
    scope: candidate.scope,
    semanticKind: candidate.semanticKind,
    workplaceType: candidate.workplaceType,
  });
}

async function normalizeLocationResponse(
  claim: ClaimedProjectionPosition,
  timestamp: string,
  ordinal: number,
  assertion: ReturnType<typeof locationAssertions>[number],
  response: PermanentLocationResponse
): Promise<LocationResolutionArtifact> {
  const resolutionId = await sha256Id(
    "location-resolution-v1_",
    `jobkit-projection-location-resolution/v1\0${claim.runId}\0${claim.id}\0${ordinal}\0${claim.inputHash}`
  );
  const candidates = await Promise.all(
    response.features.map((feature, providerOrder) =>
      normalizeLocationCandidate(
        claim.runId,
        resolutionId,
        feature,
        providerOrder,
        assertion,
        timestamp
      )
    )
  );
  candidates.sort((left, right) =>
    compareUtf8Bytes(left.providerPlaceId, right.providerPlaceId)
  );
  candidates.forEach((candidate, candidateOrdinal) => {
    candidate.ordinal = candidateOrdinal;
  });
  const viable = candidates.filter((candidate) => candidate.viable === 1);
  const uniqueViable = viable.length === 1 ? viable[0] : undefined;
  const { reasonCode, state } = locationResolutionOutcome(
    assertion,
    candidates,
    uniqueViable,
    response.features
  );
  const selected = state === "resolved" ? uniqueViable : undefined;
  const evidence = await locationEvidence(
    claim.runId,
    resolutionId,
    assertion,
    candidates,
    timestamp
  );
  const candidateDigest = await canonicalSha256(
    candidates.map(({ createdAt: _createdAt, ...candidate }) => candidate)
  );
  const evidenceDigest = await canonicalSha256(
    evidence.map(({ createdAt: _createdAt, ...item }) => item)
  );
  const providerEvidence: ProviderEvidenceArtifact = {
    createdAt: timestamp,
    orderedCandidateIdsJson: canonicalJson(
      response.features.map((feature) => feature.properties.mapbox_id)
    ),
    permanent: 1,
    provider: "mapbox-geocoding-v6",
    queriedAt: response.queriedAt,
    requestHash: response.requestHash,
    requestJson: canonicalJson(response.requestParameters),
    resolutionId,
    responseHash: response.responseHash,
    responseJson: canonicalJson(
      JSON.parse(JSON.stringify(response.normalizedResponse)) as unknown
    ),
    runId: claim.runId,
  };
  const artifactWithoutHash = {
    assertedCountryCode: assertion.countryCode,
    boundsJson: selected?.boundsJson ?? null,
    candidateCount: candidates.length,
    candidateDigest,
    coordinateKind: locationCoordinateKind(assertion.scope, selected),
    countryCode: selected?.countryCode ?? null,
    displayName: selected?.fullName ?? "",
    evidenceDigest,
    featureType: selected?.featureType ?? "",
    latitude: selected?.latitude ?? null,
    literalEvidence: assertion.evidence,
    literalLabel: assertion.label,
    locality: selected?.locality ?? "",
    locationRole: assertion.locationRole,
    longitude: selected?.longitude ?? null,
    normalizedLabel: normalizeText(assertion.label),
    ordinal,
    postalCode: selected?.postalCode ?? "",
    proposedCanonicalLocationId: selected
      ? await canonicalLocationId(selected.providerPlaceId)
      : "",
    provider: selected ? "mapbox-geocoding-v6" : "",
    queriedAt: response.queriedAt,
    reasonCode,
    region: selected?.region ?? "",
    requestHash: response.requestHash,
    responseHash: response.responseHash,
    runId: claim.runId,
    scope: assertion.scope,
    selectedProviderPlaceId: selected?.providerPlaceId ?? "",
    semanticKind: assertion.semanticKind,
    state,
    viableCandidateCount: viable.length,
    workplaceType: assertion.workplaceType,
  };
  return {
    ...artifactWithoutHash,
    candidates,
    createdAt: timestamp,
    evidence,
    providerEvidence,
    resolutionHash: await canonicalSha256(artifactWithoutHash),
    resolutionId,
  };
}

function locationResolutionOutcome(
  assertion: ReturnType<typeof locationAssertions>[number],
  candidates: LocationCandidateArtifact[],
  selected: LocationCandidateArtifact | undefined,
  providerFeatures: MapboxFeature[]
): { reasonCode: LocationReasonCode; state: ResolutionState } {
  if (selected) {
    return {
      reasonCode:
        assertion.semanticKind === "country"
          ? "location_countrywide_match"
          : "location_exact_provider_match",
      state: "resolved",
    };
  }
  const viableCount = candidates.filter(
    (candidate) => candidate.viable === 1
  ).length;
  if (viableCount > 1) {
    return {
      reasonCode: "location_multiple_viable_candidates",
      state: "ambiguous",
    };
  }
  if (
    assertion.countryCode &&
    candidates.some(
      (candidate) =>
        candidate.countryCode && candidate.countryCode !== assertion.countryCode
    )
  ) {
    return { reasonCode: "location_country_conflict", state: "ambiguous" };
  }
  if (
    assertion.parentGeographies.length > 0 &&
    providerFeatures.length > 0 &&
    providerFeatures.every((feature) =>
      assertion.parentGeographies.some(
        (parent) => !featureMatchesParentGeography(feature, parent)
      )
    )
  ) {
    return { reasonCode: "location_parent_conflict", state: "ambiguous" };
  }
  return { reasonCode: "location_no_viable_candidate", state: "unresolved" };
}

function locationCoordinateKind(
  scope: ReturnType<typeof locationAssertions>[number]["scope"],
  selected: LocationCandidateArtifact | undefined
) {
  if (!selected) {
    return "";
  }
  return scope === "countrywide" ? "centroid" : "provider_point";
}

async function normalizeLocationCandidate(
  runId: string,
  resolutionId: string,
  feature: MapboxFeature,
  providerOrder: number,
  assertion: ReturnType<typeof locationAssertions>[number],
  timestamp: string
): Promise<LocationCandidateArtifact> {
  const { properties } = feature;
  const { context } = properties;
  const preferredName =
    properties.name_preferred?.trim() || properties.name.trim();
  const fullName =
    properties.full_address?.trim() ||
    [preferredName, properties.place_formatted?.trim()]
      .filter(Boolean)
      .join(", ");
  const countryCode = context.country?.country_code?.toUpperCase() ?? null;
  const region =
    properties.feature_type === "region"
      ? preferredName
      : (context.region?.name ?? "");
  const locality = ["district", "locality", "place"].includes(
    properties.feature_type
  )
    ? preferredName
    : (context.place?.name ?? context.locality?.name ?? "");
  const postalCode =
    properties.feature_type === "postcode"
      ? preferredName
      : (context.postcode?.name ?? "");
  const longitude =
    properties.coordinates?.longitude ?? feature.geometry.coordinates[0];
  const latitude =
    properties.coordinates?.latitude ?? feature.geometry.coordinates[1];
  const candidateWithoutHash = {
    boundsJson: feature.bbox ? canonicalJson(feature.bbox) : null,
    contextJson: canonicalJson(JSON.parse(JSON.stringify(context)) as unknown),
    coordinateAccuracy: properties.coordinates?.accuracy ?? "",
    countryCode,
    featureType: properties.feature_type,
    fullName,
    latitude,
    locality,
    longitude,
    matchCodeJson: canonicalJson(properties.match_code),
    postalCode,
    preferredName,
    providerOrder,
    providerPlaceId: properties.mapbox_id,
    region,
    viable: locationCandidateIsViable(assertion, feature) ? 1 : 0,
  };
  return {
    ...candidateWithoutHash,
    candidateHash: await canonicalSha256(candidateWithoutHash),
    createdAt: timestamp,
    ordinal: providerOrder,
    resolutionId,
    runId,
  };
}

function locationCandidateIsViable(
  assertion: ReturnType<typeof locationAssertions>[number],
  feature: MapboxFeature
) {
  const { properties } = feature;
  const featureType = properties.feature_type;
  const preferredName =
    properties.name_preferred?.trim() || properties.name.trim();
  const fullName =
    properties.full_address?.trim() ||
    [preferredName, properties.place_formatted?.trim()]
      .filter(Boolean)
      .join(", ");
  const countryCode =
    properties.context.country?.country_code?.toUpperCase() ?? null;
  const allowedTypes = {
    address: ["address"],
    city: ["district", "locality", "place"],
    country: ["country"],
    postal_code: ["postcode"],
    region: ["region"],
    unknown: [
      "address",
      "country",
      "district",
      "locality",
      "place",
      "postcode",
      "region",
    ],
  }[assertion.semanticKind];
  if (!allowedTypes.includes(featureType)) {
    return false;
  }
  if (assertion.locationRole === "unknown" || assertion.scope === "unknown") {
    return false;
  }
  if (
    assertion.countryCode &&
    assertion.countryCode !== countryCode?.toUpperCase()
  ) {
    return false;
  }
  if (
    !assertion.parentGeographies.every((parent) =>
      featureMatchesParentGeography(feature, parent)
    )
  ) {
    return false;
  }
  if (
    assertion.semanticKind === "address" &&
    (assertion.addressComponents.length === 0 ||
      !assertion.addressComponents.every((component) =>
        addressMatchCodeSupports(properties.match_code, component.kind)
      ))
  ) {
    return false;
  }
  const label = normalizeText(assertion.label);
  const firstComponent = normalizeText(assertion.label.split(",")[0] ?? "");
  return (
    label === normalizeText(preferredName) ||
    label === normalizeText(fullName) ||
    firstComponent === normalizeText(preferredName)
  );
}

function locationEvidence(
  runId: string,
  resolutionId: string,
  assertion: ReturnType<typeof locationAssertions>[number],
  candidates: LocationCandidateArtifact[],
  timestamp: string
) {
  const rows: Omit<
    LocationEvidenceArtifact,
    "createdAt" | "evidenceHash" | "ordinal"
  >[] = [
    {
      evidenceJson: canonicalJson({
        addressComponents: assertion.addressComponents,
        assertedCountryCode: assertion.countryCode,
        evidence: assertion.evidence,
        literalLabel: assertion.label,
        locationRole: assertion.locationRole,
        parentGeographies: assertion.parentGeographies,
        scope: assertion.scope,
        semanticKind: assertion.semanticKind,
        workplaceType: assertion.workplaceType,
      }),
      evidenceKind: "source_assertion",
      resolutionId,
      runId,
      sourceReference: assertion.evidence,
    },
    ...assertion.parentGeographies.map((parent) => ({
      evidenceJson: canonicalJson(parent),
      evidenceKind: "parent_context" as const,
      resolutionId,
      runId,
      sourceReference: parent.evidence,
    })),
    ...assertion.addressComponents.map((component) => ({
      evidenceJson: canonicalJson({
        component,
        providerMatchCodes: candidates.map((candidate) => ({
          matchCodeJson: candidate.matchCodeJson,
          providerPlaceId: candidate.providerPlaceId,
        })),
      }),
      evidenceKind: "address_match_code" as const,
      resolutionId,
      runId,
      sourceReference: component.evidence,
    })),
    ...candidates.map((candidate) => ({
      evidenceJson: canonicalJson({
        candidateHash: candidate.candidateHash,
        providerOrder: candidate.providerOrder,
        viable: candidate.viable,
      }),
      evidenceKind: "provider_candidate" as const,
      resolutionId,
      runId,
      sourceReference: candidate.providerPlaceId,
    })),
  ];
  rows.sort((left, right) =>
    compareUtf8Bytes(
      `${left.evidenceKind}\0${left.sourceReference}`,
      `${right.evidenceKind}\0${right.sourceReference}`
    )
  );
  return Promise.all(
    rows.map(async (row, ordinal) => ({
      ...row,
      createdAt: timestamp,
      evidenceHash: await canonicalSha256(row),
      ordinal,
    }))
  );
}

async function blockedProviderLocations(
  claim: ClaimedProjectionPosition,
  inputs: ResolutionInputs,
  timestamp: string,
  reasonCode: LocationProviderErrorCode
) {
  const assertions = locationAssertions(inputs);
  const bounded = assertions.length > 0 ? assertions.slice(0, 1) : [];
  if (bounded.length === 0) {
    return [
      await unresolvedLocation(
        claim,
        timestamp,
        0,
        "",
        "",
        countryCodeForLabel(inputs.listing.material.country),
        reasonCode,
        "blocked"
      ),
    ];
  }
  return Promise.all(
    bounded.map((assertion, ordinal) =>
      unresolvedLocation(
        claim,
        timestamp,
        ordinal,
        assertion.label,
        assertion.evidence,
        assertion.countryCode,
        reasonCode,
        "blocked",
        assertion
      )
    )
  );
}

async function unresolvedLocation(
  claim: ClaimedProjectionPosition,
  timestamp: string,
  ordinal: number,
  label: string,
  evidenceText: string,
  countryCode: string | null,
  reasonCode: LocationReasonCode,
  state: "ambiguous" | "blocked" | "unresolved" = "unresolved",
  assertion?: ReturnType<typeof locationAssertions>[number]
): Promise<LocationResolutionArtifact> {
  const resolutionId = await sha256Id(
    "location-resolution-v1_",
    `jobkit-projection-location-resolution/v1\0${claim.runId}\0${claim.id}\0${ordinal}\0${claim.inputHash}`
  );
  const sourceEvidence = {
    evidenceJson: canonicalJson({
      addressComponents: assertion?.addressComponents ?? [],
      countryCode,
      evidenceText,
      label,
      locationRole: assertion?.locationRole ?? "unknown",
      parentGeographies: assertion?.parentGeographies ?? [],
      scope: assertion?.scope ?? "unknown",
      semanticKind: assertion?.semanticKind ?? "unknown",
      workplaceType: assertion?.workplaceType ?? "unknown",
    }),
    evidenceKind: "source_assertion" as const,
    resolutionId,
    runId: claim.runId,
    sourceReference: evidenceText,
  };
  const evidence: LocationEvidenceArtifact[] = [
    {
      ...sourceEvidence,
      createdAt: timestamp,
      evidenceHash: await canonicalSha256(sourceEvidence),
      ordinal: 0,
    },
  ];
  const candidateDigest = await canonicalSha256([]);
  const evidenceDigest = await canonicalSha256(
    evidence.map(({ createdAt: _createdAt, ...item }) => item)
  );
  const withoutHash = {
    assertedCountryCode: countryCode,
    candidateCount: 0,
    candidateDigest,
    evidenceDigest,
    literalEvidence: evidenceText,
    literalLabel: label,
    locationRole: assertion?.locationRole ?? "unknown",
    normalizedLabel: normalizeText(label),
    ordinal,
    reasonCode,
    runId: claim.runId,
    scope: assertion?.scope ?? "unknown",
    semanticKind: assertion?.semanticKind ?? "unknown",
    state,
    workplaceType: assertion?.workplaceType ?? "unknown",
  };
  return {
    assertedCountryCode: countryCode,
    boundsJson: null,
    candidateCount: 0,
    candidateDigest,
    candidates: [],
    coordinateKind: "",
    countryCode: null,
    createdAt: timestamp,
    displayName: "",
    evidence,
    evidenceDigest,
    featureType: "",
    latitude: null,
    literalEvidence: evidenceText,
    literalLabel: label,
    locality: "",
    locationRole: assertion?.locationRole ?? "unknown",
    longitude: null,
    normalizedLabel: normalizeText(label),
    ordinal,
    postalCode: "",
    proposedCanonicalLocationId: "",
    provider: "",
    providerEvidence: null,
    queriedAt: null,
    reasonCode,
    region: "",
    requestHash: null,
    resolutionHash: await canonicalSha256(withoutHash),
    resolutionId,
    responseHash: null,
    runId: claim.runId,
    scope: assertion?.scope ?? "unknown",
    selectedProviderPlaceId: "",
    semanticKind: assertion?.semanticKind ?? "unknown",
    state,
    viableCandidateCount: 0,
    workplaceType: assertion?.workplaceType ?? "unknown",
  };
}

function featureMatchesParentGeography(
  feature: MapboxFeature,
  parent: ReturnType<
    typeof locationAssertions
  >[number]["parentGeographies"][number]
) {
  const { context, feature_type: featureType } = feature.properties;
  const parentNames = {
    city: [
      context.place?.name,
      context.locality?.name,
      context.district?.name,
      ["district", "locality", "place"].includes(featureType)
        ? feature.properties.name
        : undefined,
    ],
    country: [
      context.country?.name,
      featureType === "country" ? feature.properties.name : undefined,
      context.country?.country_code,
    ],
    region: [
      context.region?.name,
      featureType === "region" ? feature.properties.name : undefined,
      context.region?.region_code,
      context.region?.region_code_full,
    ],
  }[parent.semanticKind];
  const expected = normalizeText(parent.value);
  return parentNames.some(
    (value) => typeof value === "string" && normalizeText(value) === expected
  );
}

function addressMatchCodeSupports(
  matchCode: Record<string, string>,
  componentKind: ReturnType<
    typeof locationAssertions
  >[number]["addressComponents"][number]["kind"]
) {
  const keys = {
    address_number: ["address_number"],
    country: ["country"],
    locality: ["place", "locality", "district"],
    postcode: ["postcode"],
    region: ["region"],
    street: ["street"],
  }[componentKind];
  return keys.some((key) =>
    ["inferred", "matched", "plausible"].includes(matchCode[key] ?? "")
  );
}

function parseBoundingBox(value: string | null): MapboxBoundingBox | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) &&
      parsed.length === 4 &&
      parsed.every((coordinate) => typeof coordinate === "number")
      ? (parsed as MapboxBoundingBox)
      : null;
  } catch {
    return null;
  }
}

async function resolveOrganization(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  inputs: ResolutionInputs,
  locations: LocationResolutionArtifact[],
  timestamp: string
): Promise<OrganizationResolutionArtifact> {
  const resolutionId = await sha256Id(
    "organization-resolution-v1_",
    `jobkit-projection-organization-resolution/v1\0${claim.runId}\0${claim.id}\0${claim.inputHash}`
  );
  const normalizedCompanyName = normalizeText(inputs.listing.material.company);
  const assertedCountryCode = countryCodeForLabel(
    inputs.listing.material.country
  );
  const resolvedLocalities = locations
    .filter((location) => location.state === "resolved")
    .map((location) => normalizeText(location.locality))
    .filter(Boolean)
    .sort(compareUtf8Bytes);
  const resolvedLocality = resolvedLocalities[0] ?? "";
  const routeIdentities = organizationRouteIdentities([
    inputs.listing.material.applyUrl,
    inputs.listing.material.sourceUrl,
  ]);
  const hosts = routeIdentities.map((route) => route.host);
  const registrableDomains = [
    ...new Set(
      routeIdentities.map((route) => route.registrableDomain).filter(Boolean)
    ),
  ].sort(compareUtf8Bytes);
  const rows = await db
    .prepare(
      `SELECT organization.id,organization.name,organization.country_code,
              organization.country_name,organization.city,
              organization.region,organization.canonical_domain,
              organization.status,
              EXISTS (
                SELECT 1 FROM organization_opportunities opportunity
                 WHERE opportunity.organization_id=organization.id
                   AND opportunity.job_id=?
              ) opportunity_link,
              EXISTS (
                SELECT 1
                  FROM organization_opportunities opportunity
                  JOIN organization_opportunity_acceptances acceptance
                    ON acceptance.organization_id=opportunity.organization_id
                   AND acceptance.job_id=opportunity.job_id
                 WHERE opportunity.organization_id=organization.id
                   AND opportunity.job_id=?
              ) accepted_opportunity_link,
              EXISTS (
                SELECT 1 FROM organization_source_employer_mappings mapping
                 WHERE mapping.organization_id=organization.id
                   AND mapping.source_key=? AND mapping.employer_id=?
                   AND ?<>''
              ) source_employer_link
         FROM organizations organization
        WHERE EXISTS (
                SELECT 1 FROM organization_opportunities opportunity
                 WHERE opportunity.organization_id=organization.id
                   AND opportunity.job_id=?
              )
           OR EXISTS (
                SELECT 1 FROM organization_source_employer_mappings mapping
                 WHERE mapping.organization_id=organization.id
                   AND mapping.source_key=? AND mapping.employer_id=?
                   AND ?<>''
              )
           OR (
              (? IS NULL OR organization.country_code=?)
              AND EXISTS (
                SELECT 1 FROM organization_domain_mappings mapping
                 WHERE mapping.organization_id=organization.id
                   AND mapping.public_suffix_list_version=?
                   AND (
                     (mapping.mapping_kind IN (
                        'employer_host','hosted_ats_tenant'
                      ) AND mapping.normalized_host IN (
                        SELECT CAST(value AS TEXT) FROM json_each(?)
                      ))
                     OR (
                       mapping.mapping_kind='employer_registrable_domain'
                       AND mapping.registrable_domain IN (
                         SELECT CAST(value AS TEXT) FROM json_each(?)
                       )
                     )
                   )
              ))
           OR (
             (? IS NULL OR organization.country_code=?)
             AND (
               lower(organization.name)=lower(?)
               OR lower(organization.canonical_domain)=lower(?)
               OR lower(organization.canonical_domain)=lower(?)
             )
           )
        ORDER BY organization.id LIMIT ?`
    )
    .bind(
      inputs.listing.listingId,
      inputs.listing.listingId,
      inputs.listing.board,
      inputs.listing.material.employerId,
      inputs.listing.material.employerId,
      inputs.listing.listingId,
      inputs.listing.board,
      inputs.listing.material.employerId,
      inputs.listing.material.employerId,
      assertedCountryCode,
      assertedCountryCode,
      PUBLIC_SUFFIX_LIST_VERSION,
      canonicalJson(hosts),
      canonicalJson(registrableDomains),
      assertedCountryCode,
      assertedCountryCode,
      inputs.listing.material.company.trim(),
      hosts[0] ?? "",
      hosts[1] ?? "",
      MAX_ORGANIZATION_CANDIDATES + 1
    )
    .all<OrganizationRow>();
  if (rows.results.length > MAX_ORGANIZATION_CANDIDATES) {
    return blockedOrganizationResolution(
      resolutionId,
      normalizedCompanyName,
      assertedCountryCode,
      resolvedLocality
    );
  }
  const organizationIds = rows.results.map((row) => row.id);
  const evidenceRows =
    organizationIds.length === 0
      ? []
      : (
          await db
            .prepare(
              `SELECT id,organization_id,evidence_status,source_url,observed_at
                 FROM organization_evidence
                WHERE organization_id IN (
                  SELECT CAST(value AS TEXT) FROM json_each(?)
                )
                ORDER BY organization_id,observed_at,id LIMIT 500`
            )
            .bind(canonicalJson(organizationIds))
            .all<OrganizationEvidenceRow>()
        ).results;
  const evidenceByOrganization = groupOrganizationEvidence(evidenceRows);
  const domainMappingRows =
    organizationIds.length === 0
      ? []
      : (
          await db
            .prepare(
              `SELECT id,organization_id,mapping_kind,normalized_host,
                      registrable_domain,path_prefix,
                      public_suffix_list_version,accepted_at,evidence_url
                 FROM organization_domain_mappings
                WHERE organization_id IN (
                  SELECT CAST(value AS TEXT) FROM json_each(?)
                )
                  AND public_suffix_list_version=?
                ORDER BY organization_id,mapping_kind,normalized_host,
                         path_prefix,id LIMIT 500`
            )
            .bind(canonicalJson(organizationIds), PUBLIC_SUFFIX_LIST_VERSION)
            .all<OrganizationDomainMappingRow>()
        ).results;
  const domainMappingsByOrganization =
    groupOrganizationDomainMappings(domainMappingRows);
  const preliminary = rows.results.map((row) =>
    organizationResolutionCandidate({
      assertedCountryCode,
      domainMappingsByOrganization,
      evidenceByOrganization,
      hosts,
      normalizedCompanyName,
      resolvedLocality,
      routeIdentities,
      row,
    })
  );
  const activePositive = preliminary.filter(
    (candidate) => candidate.row.status === "active" && candidate.tier <= 3
  );
  const tierOneIds = new Set(
    activePositive
      .filter((candidate) => candidate.tier === 1)
      .map((candidate) => candidate.row.id)
  );
  const tierTwoIds = new Set(
    preliminary
      .filter(
        (candidate) =>
          candidate.row.status === "active" &&
          (assertedCountryCode === null ||
            candidate.row.country_code === assertedCountryCode) &&
          candidate.verifiedDomainMappings.length > 0
      )
      .map((candidate) => candidate.row.id)
  );
  const tierConflict =
    tierOneIds.size > 0 &&
    [...tierTwoIds].some((organizationId) => !tierOneIds.has(organizationId));
  const highestTier = Math.min(
    ...activePositive.map((candidate) => candidate.tier),
    Number.POSITIVE_INFINITY
  );
  const highest = activePositive.filter(
    (candidate) => candidate.tier === highestTier
  );
  const selected = !tierConflict && highest.length === 1 ? highest[0] : null;
  const { reasonCode, state } = organizationResolutionOutcome(
    preliminary,
    selected ?? null,
    tierConflict || highest.length > 1
  );
  const candidates = await Promise.all(
    preliminary
      .sort(
        (left, right) =>
          left.tier - right.tier || compareUtf8Bytes(left.row.id, right.row.id)
      )
      .map(async (candidate, ordinal) => {
        const candidateWithoutHash = {
          countryCode: candidate.row.country_code,
          evidenceTier: candidate.tier,
          normalizedDomain: normalizeDomain(candidate.row.canonical_domain),
          normalizedLocality: normalizeText(candidate.row.city),
          normalizedName: normalizeText(candidate.row.name),
          organizationId: candidate.row.id,
          organizationStatus: candidate.row.status,
          selected: selected?.row.id === candidate.row.id ? 1 : 0,
        };
        return {
          ...candidateWithoutHash,
          candidateHash: await canonicalSha256(candidateWithoutHash),
          createdAt: timestamp,
          ordinal,
          resolutionId,
          runId: claim.runId,
        } satisfies OrganizationCandidateArtifact;
      })
  );
  const evidence = await organizationEvidenceArtifacts(
    claim,
    resolutionId,
    preliminary,
    inputs.listing.material.employerId,
    timestamp
  );
  const candidateDigest = await canonicalSha256(
    candidates.map(({ createdAt: _createdAt, ...candidate }) => candidate)
  );
  const evidenceDigest = await canonicalSha256(
    evidence.map(({ createdAt: _createdAt, ...item }) => item)
  );
  const withoutHash = {
    assertedCountryCode,
    candidateCount: candidates.length,
    candidateDigest,
    evidenceCount: evidence.length,
    evidenceDigest,
    normalizedCompanyName,
    reasonCode,
    resolvedLocality,
    selectedDisplayName: selected?.row.name ?? "",
    selectedOrganizationId: selected?.row.id ?? null,
    state,
  };
  return {
    ...withoutHash,
    candidates,
    evidence,
    resolutionHash: await canonicalSha256(withoutHash),
    resolutionId,
  };
}

function groupOrganizationEvidence(rows: OrganizationEvidenceRow[]) {
  const grouped = new Map<string, OrganizationEvidenceRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.organization_id) ?? [];
    group.push(row);
    grouped.set(row.organization_id, group);
  }
  return grouped;
}

function groupOrganizationDomainMappings(rows: OrganizationDomainMappingRow[]) {
  const grouped = new Map<string, OrganizationDomainMappingRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.organization_id) ?? [];
    group.push(row);
    grouped.set(row.organization_id, group);
  }
  return grouped;
}

function organizationResolutionCandidate(input: {
  assertedCountryCode: string | null;
  domainMappingsByOrganization: Map<string, OrganizationDomainMappingRow[]>;
  evidenceByOrganization: Map<string, OrganizationEvidenceRow[]>;
  hosts: string[];
  normalizedCompanyName: string;
  resolvedLocality: string;
  routeIdentities: OrganizationRouteIdentity[];
  row: OrganizationRow;
}): OrganizationResolutionCandidate {
  const { row } = input;
  const rowEvidence = input.evidenceByOrganization.get(row.id) ?? [];
  const evidenceActive = rowEvidence.some((item) =>
    ["active", "outreach"].includes(item.evidence_status)
  );
  const normalizedDomain = normalizeDomain(row.canonical_domain);
  const exactDomain =
    Boolean(normalizedDomain) &&
    input.hosts.includes(normalizedDomain) &&
    rowEvidence.some(
      (item) =>
        ["active", "outreach"].includes(item.evidence_status) &&
        normalizedHost(item.source_url) === normalizedDomain
    );
  const exactName = normalizeText(row.name) === input.normalizedCompanyName;
  const exactCountry =
    input.assertedCountryCode !== null &&
    row.country_code === input.assertedCountryCode;
  const exactLocality =
    Boolean(input.resolvedLocality) &&
    normalizeText(row.city) === input.resolvedLocality;
  const verifiedDomainMappings = (
    input.domainMappingsByOrganization.get(row.id) ?? []
  ).filter((mapping) =>
    organizationDomainMappingMatches(mapping, row, input.routeIdentities)
  );
  return {
    acceptedOpportunityLink: row.accepted_opportunity_link === 1,
    exactCountry,
    exactDomain,
    exactLocality,
    exactName,
    row,
    rowEvidence,
    sourceEmployerLink: row.source_employer_link === 1,
    tier: organizationEvidenceTier({
      acceptedOpportunityLink: row.accepted_opportunity_link === 1,
      evidenceActive,
      exactCountry,
      exactDomain,
      exactLocality,
      exactName,
      sourceEmployerLink: row.source_employer_link === 1,
      verifiedDomainMapping: verifiedDomainMappings.length > 0,
    }),
    verifiedDomainMappings,
  };
}

function organizationEvidenceTier(input: {
  acceptedOpportunityLink: boolean;
  evidenceActive: boolean;
  exactCountry: boolean;
  exactDomain: boolean;
  exactLocality: boolean;
  exactName: boolean;
  sourceEmployerLink: boolean;
  verifiedDomainMapping: boolean;
}) {
  if (input.acceptedOpportunityLink || input.sourceEmployerLink) {
    return 1;
  }
  if (input.verifiedDomainMapping) {
    return 2;
  }
  if (
    input.exactName &&
    input.exactCountry &&
    input.exactLocality &&
    input.evidenceActive
  ) {
    return 3;
  }
  return 4;
}

function organizationDomainMappingMatches(
  mapping: OrganizationDomainMappingRow,
  organization: OrganizationRow,
  routes: OrganizationRouteIdentity[]
) {
  if (mapping.public_suffix_list_version !== PUBLIC_SUFFIX_LIST_VERSION) {
    return false;
  }
  const mappingHost = normalizeDomain(mapping.normalized_host);
  const mappingRegistrableDomain = normalizeDomain(mapping.registrable_domain);
  const derivedMappingDomain = registrableDomainForHost(mappingHost);
  const canonicalOrganizationDomain = registrableDomainForHost(
    normalizeDomain(organization.canonical_domain)
  );
  if (
    !(mappingHost && mappingRegistrableDomain) ||
    mappingRegistrableDomain !== derivedMappingDomain ||
    !canonicalOrganizationDomain
  ) {
    return false;
  }
  if (mapping.mapping_kind === "employer_host") {
    return (
      mappingRegistrableDomain === canonicalOrganizationDomain &&
      routes.some((route) => route.host === mappingHost)
    );
  }
  if (mapping.mapping_kind === "employer_registrable_domain") {
    return (
      mappingHost === mappingRegistrableDomain &&
      mappingRegistrableDomain === canonicalOrganizationDomain &&
      routes.some(
        (route) => route.registrableDomain === mappingRegistrableDomain
      )
    );
  }
  const prefix = normalizedPathPrefix(mapping.path_prefix);
  return (
    Boolean(prefix) &&
    routes.some(
      (route) =>
        route.host === mappingHost &&
        (route.path === prefix || route.path.startsWith(`${prefix}/`))
    )
  );
}

function organizationResolutionOutcome(
  candidates: OrganizationResolutionCandidate[],
  selected: OrganizationResolutionCandidate | null,
  conflict: boolean
): { reasonCode: OrganizationReasonCode; state: ResolutionState } {
  if (conflict) {
    return {
      reasonCode: "organization_evidence_conflict",
      state: "ambiguous",
    };
  }
  if (selected?.tier === 1) {
    return {
      reasonCode: selected.sourceEmployerLink
        ? "organization_source_employer_id"
        : "organization_explicit_link",
      state: "resolved",
    };
  }
  if (selected?.tier === 2) {
    return { reasonCode: "organization_employer_domain", state: "resolved" };
  }
  if (selected?.tier === 3) {
    return {
      reasonCode: "organization_name_country_locality",
      state: "resolved",
    };
  }
  const invalidCandidate = candidates.some((candidate) =>
    ["closed", "invalid", "stale", "unverified"].includes(candidate.row.status)
  );
  if (invalidCandidate) {
    return {
      reasonCode: "organization_invalid_candidate",
      state: "unresolved",
    };
  }
  return {
    reasonCode:
      candidates.length > 0
        ? "organization_candidate_only"
        : "organization_no_candidate",
    state: "unresolved",
  };
}

function organizationEvidenceArtifacts(
  claim: ClaimedProjectionPosition,
  resolutionId: string,
  preliminary: OrganizationResolutionCandidate[],
  sourceEmployerId: string,
  timestamp: string
) {
  const raw: Omit<
    OrganizationEvidenceArtifact,
    "createdAt" | "evidenceHash" | "ordinal"
  >[] = preliminary.flatMap((candidate) =>
    organizationCandidateEvidence(
      claim,
      resolutionId,
      candidate,
      sourceEmployerId,
      timestamp
    )
  );
  raw.sort(
    (left, right) =>
      left.evidenceTier - right.evidenceTier ||
      compareUtf8Bytes(
        `${left.sourceKey}\0${left.evidenceKind}\0${left.observedAt}\0${left.organizationId ?? ""}`,
        `${right.sourceKey}\0${right.evidenceKind}\0${right.observedAt}\0${right.organizationId ?? ""}`
      )
  );
  return Promise.all(
    raw.map(async (row, ordinal) => ({
      ...row,
      createdAt: timestamp,
      evidenceHash: await canonicalSha256(row),
      ordinal,
    }))
  );
}

function organizationCandidateEvidence(
  claim: ClaimedProjectionPosition,
  resolutionId: string,
  candidate: OrganizationResolutionCandidate,
  sourceEmployerId: string,
  timestamp: string
) {
  const raw: Omit<
    OrganizationEvidenceArtifact,
    "createdAt" | "evidenceHash" | "ordinal"
  >[] = [];
  if (candidate.sourceEmployerLink) {
    raw.push({
      evidenceKind: "source_employer_id",
      evidenceTier: 1,
      observedAt: timestamp,
      organizationId: candidate.row.id,
      polarity: "positive",
      resolutionId,
      runId: claim.runId,
      sourceKey: "organization_source_employer_mappings",
      sourceReference: sourceEmployerId,
    });
  }
  if (candidate.row.opportunity_link) {
    raw.push({
      evidenceKind: "explicit_opportunity_link",
      evidenceTier: candidate.acceptedOpportunityLink ? 1 : 4,
      observedAt: timestamp,
      organizationId: candidate.row.id,
      polarity: candidate.acceptedOpportunityLink ? "positive" : "candidate",
      resolutionId,
      runId: claim.runId,
      sourceKey: "organization_opportunities",
      sourceReference: candidate.row.id,
    });
  }
  for (const mapping of candidate.verifiedDomainMappings) {
    raw.push({
      evidenceKind: "employer_domain",
      evidenceTier: 2,
      observedAt: mapping.accepted_at,
      organizationId: candidate.row.id,
      polarity: "positive",
      resolutionId,
      runId: claim.runId,
      sourceKey: "organization_domain_mappings",
      sourceReference: mapping.id,
    });
  }
  if (candidate.exactDomain && candidate.verifiedDomainMappings.length === 0) {
    raw.push({
      evidenceKind: "employer_domain",
      evidenceTier: 4,
      observedAt: candidate.rowEvidence.at(-1)?.observed_at ?? timestamp,
      organizationId: candidate.row.id,
      polarity: "candidate",
      resolutionId,
      runId: claim.runId,
      sourceKey: "organization_evidence",
      sourceReference: normalizeDomain(candidate.row.canonical_domain),
    });
  }
  if (
    candidate.exactName &&
    candidate.exactCountry &&
    candidate.exactLocality
  ) {
    raw.push({
      evidenceKind: "name_country_locality",
      evidenceTier: 3,
      observedAt: candidate.rowEvidence.at(-1)?.observed_at ?? timestamp,
      organizationId: candidate.row.id,
      polarity: "positive",
      resolutionId,
      runId: claim.runId,
      sourceKey: "organizations",
      sourceReference: candidate.row.id,
    });
  } else {
    raw.push({
      evidenceKind: "name_country_candidate",
      evidenceTier: 4,
      observedAt: candidate.rowEvidence.at(-1)?.observed_at ?? timestamp,
      organizationId: candidate.row.id,
      polarity: "candidate",
      resolutionId,
      runId: claim.runId,
      sourceKey: "organizations",
      sourceReference: candidate.row.id,
    });
  }
  raw.push({
    evidenceKind: "organization_status",
    evidenceTier: candidate.tier,
    observedAt: timestamp,
    organizationId: candidate.row.id,
    polarity: candidate.row.status === "active" ? "positive" : "conflicting",
    resolutionId,
    runId: claim.runId,
    sourceKey: "organizations",
    sourceReference: candidate.row.status,
  });
  return raw;
}

async function blockedOrganizationResolution(
  resolutionId: string,
  normalizedCompanyName: string,
  assertedCountryCode: string | null,
  resolvedLocality: string
): Promise<OrganizationResolutionArtifact> {
  const candidateDigest = await canonicalSha256([]);
  const evidenceDigest = await canonicalSha256([]);
  const withoutHash = {
    assertedCountryCode,
    candidateCount: 0,
    candidateDigest,
    evidenceCount: 0,
    evidenceDigest,
    normalizedCompanyName,
    reasonCode: "organization_input_schema_invalid" as const,
    resolvedLocality,
    selectedDisplayName: "",
    selectedOrganizationId: null,
    state: "blocked" as const,
  };
  return {
    ...withoutHash,
    candidates: [],
    evidence: [],
    resolutionHash: await canonicalSha256(withoutHash),
    resolutionId,
  };
}

async function sealResolution(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  inputs: ResolutionInputs,
  organization: OrganizationResolutionArtifact,
  locations: LocationResolutionArtifact[],
  rawCheckpoint: Record<string, unknown>,
  timestamp: string
): Promise<CanonicalResolutionResult> {
  const { reasonCode, state } = canonicalResolutionOutcome(
    organization,
    locations
  );
  const locationIds = locations
    .map((location) => location.proposedCanonicalLocationId)
    .filter(Boolean)
    .sort(compareUtf8Bytes);
  const locationSetHash = await canonicalSha256(
    locations
      .map((location) => ({
        id: location.resolutionId,
        ordinal: location.ordinal,
        resolutionHash: location.resolutionHash,
      }))
      .sort((left, right) => left.ordinal - right.ordinal)
  );
  const normalizedSubjects = [
    ...new Set(
      inputs.position.subjects.map((subject) => normalizeText(subject.value))
    ),
  ]
    .filter(Boolean)
    .sort(compareUtf8Bytes);
  const normalizedTitle = normalizeIdentityText(inputs.position.title);
  const canonicalSignal =
    state === "resolved" && organization.selectedOrganizationId
      ? await canonicalIdentitySignal({
          locationIds,
          organizationId: organization.selectedOrganizationId,
          roleFamily: inputs.position.roleFamily,
          subjects: normalizedSubjects,
          title: inputs.position.title,
        })
      : null;
  const canonicalSignalHash = canonicalSignal ? canonicalSignal.hash : null;
  const signalPayload = {
    locationIds,
    locationSetHash,
    normalizedSubjects,
    normalizedTitle,
    organizationResolutionHash: organization.resolutionHash,
    organizationResolutionId: organization.resolutionId,
    roleFamily: inputs.position.roleFamily,
  };
  const signalPayloadHash = await canonicalSha256(signalPayload);
  const sealWithoutHash = {
    canonicalSignalHash,
    duplicateBatchInputHash: inputs.batch.input_hash,
    locationCount: locations.length,
    locationSetHash,
    organizationResolutionHash: organization.resolutionHash,
    organizationResolutionId: organization.resolutionId,
    positionInputHash: claim.inputHash,
    positionItemId: claim.id,
    reasonCode,
    runId: claim.runId,
    sourcePositionId: claim.sourcePositionId,
    state,
  };
  const sealHash = await canonicalSha256(sealWithoutHash);
  const resolutionGuardToken = crypto.randomUUID();
  await assertPositionClaimLease(db, claim);
  const statements = [
    resolutionGuardStatement(db, claim, inputs, resolutionGuardToken),
    transactionChangeAssertion(db),
    organizationResolutionInsert(
      db,
      claim,
      inputs,
      organization,
      resolutionGuardToken,
      timestamp
    ),
    ...organizationCandidatesInserts(db, organization.candidates),
    ...organizationEvidenceInserts(db, organization.evidence),
    ...locationResolutionInserts(db, claim, locations, resolutionGuardToken),
    ...locationProviderEvidenceInserts(
      db,
      locations.flatMap((location) =>
        location.providerEvidence ? [location.providerEvidence] : []
      )
    ),
    ...locationCandidateInserts(
      db,
      locations.flatMap((location) => location.candidates)
    ),
    ...locationEvidenceInserts(
      db,
      locations.flatMap((location) => location.evidence)
    ),
    canonicalSignalInsert(db, {
      createdAt: timestamp,
      locationIdsJson: canonicalJson(locationIds),
      locationSetHash,
      normalizedSubjectsJson: canonicalJson(normalizedSubjects),
      normalizedTitle,
      organizationResolutionHash: organization.resolutionHash,
      organizationResolutionId: organization.resolutionId,
      positionItemId: claim.id,
      roleFamily: inputs.position.roleFamily,
      runId: claim.runId,
      signalHash: canonicalSignalHash,
      signalPayloadHash,
      state: canonicalSignal ? "resolved" : "blocked",
    }),
    resolutionSealInsert(db, claim, {
      ...sealWithoutHash,
      createdAt: timestamp,
      sealHash,
    }),
    claimedPositionUpdateStatement(db, claim, {
      checkpoint: {
        ...rawCheckpoint,
        canonicalResolution: {
          canonicalSignalHash,
          locationCount: locations.length,
          locationSetHash,
          organizationResolutionHash: organization.resolutionHash,
          organizationResolutionId: organization.resolutionId,
          reasonCode,
          sealHash,
          state,
        },
      },
      checkpointGuardPath: "$.resolutionGuard",
      checkpointGuardToken: resolutionGuardToken,
      errorCode: state === "resolved" ? "" : reasonCode,
      errorDetail:
        state === "resolved"
          ? ""
          : "Canonical organization or location evidence stayed private",
      stage: "canonical_resolution",
      status: state === "resolved" ? "queued" : "blocked",
    }),
    transactionChangeAssertion(db),
    projectionRunCounterStatement(db, claim.runId, timestamp),
  ];
  if (statements.length > MAX_D3_BATCH_STATEMENTS) {
    throw new CanonicalResolutionInputError(
      "canonical_resolution_batch_limit_exceeded",
      `Canonical resolution requires ${statements.length} D1 statements`
    );
  }
  const results = await db.batch(statements);
  assertClaimedPositionUpdate(results.at(-3), "canonical resolution seal");
  return {
    blocked: state === "resolved" ? 0 : 1,
    resolved: state === "resolved" ? 1 : 0,
    retried: 0,
    sealed: 1,
    state,
  };
}

function canonicalResolutionOutcome(
  organization: OrganizationResolutionArtifact,
  locations: LocationResolutionArtifact[]
) {
  const locationStates = new Set(locations.map((location) => location.state));
  const state = highestResolutionState(organization.state, locationStates);
  if (state === "resolved") {
    return { reasonCode: "canonical_resolution_resolved", state };
  }
  if (organization.state === state) {
    return { reasonCode: organization.reasonCode, state };
  }
  return {
    reasonCode:
      locations.find((location) => location.state === state)?.reasonCode ??
      "canonical_resolution_blocked",
    state,
  };
}

function highestResolutionState(
  organizationState: ResolutionState,
  locationStates: Set<ResolutionState>
): ResolutionState {
  for (const state of ["blocked", "ambiguous", "unresolved"] as const) {
    if (organizationState === state || locationStates.has(state)) {
      return state;
    }
  }
  return "resolved";
}

function resolutionGuardStatement(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  inputs: ResolutionInputs,
  guardToken: string
) {
  return db
    .prepare(
      `UPDATE public_projection_position_items
          SET checkpoint_json=json_set(
            checkpoint_json,'$.resolutionGuard',?
          )
        WHERE id=? AND run_id=? AND status='processing'
          AND stage='canonical_resolution'
          AND lease_owner=? AND lease_token=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND input_hash=? AND listing_item_id=? AND source_position_id=?
          AND checkpoint_json=?
          AND EXISTS (
            SELECT 1
              FROM public_projection_duplicate_batches batch
              JOIN public_projection_duplicate_batch_members member
                ON member.run_id=batch.run_id
             WHERE batch.run_id=? AND batch.input_hash=?
               AND batch.canonical_identity_state='pending'
               AND member.position_item_id=?
               AND member.source_position_id=?
               AND member.input_hash=?
          )
          ${EXACT_PROJECTION_ANALYSIS_GUARD_SQL}`
    )
    .bind(
      guardToken,
      claim.id,
      claim.runId,
      claim.leaseOwner,
      claim.leaseToken,
      claim.inputHash,
      claim.listingItemId,
      claim.sourcePositionId,
      claim.checkpointJson,
      claim.runId,
      inputs.batch.input_hash,
      claim.id,
      claim.sourcePositionId,
      claim.inputHash,
      ...exactProjectionAnalysisGuardBindings(
        inputs.listing,
        inputs.analysisGuard
      )
    );
}

function organizationResolutionInsert(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  inputs: ResolutionInputs,
  resolution: OrganizationResolutionArtifact,
  resolutionGuardToken: string,
  timestamp: string
) {
  return db
    .prepare(
      `INSERT INTO public_projection_organization_resolutions (
        id,run_id,position_item_id,source_position_id,position_input_hash,
        duplicate_batch_input_hash,listing_id,material_version,material_hash,
        content_analysis_hash,match_facts_analysis_hash,position_analysis_hash,
        position_payload_hash,normalized_company_name,asserted_country_code,
        resolved_locality,state,selected_organization_id,
        selected_display_name,resolver_version,reason_code,candidate_count,
        evidence_count,candidate_digest,evidence_digest,resolution_hash,
        claim_lease_token,resolution_guard_token,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      resolution.resolutionId,
      claim.runId,
      claim.id,
      claim.sourcePositionId,
      claim.inputHash,
      inputs.batch.input_hash,
      inputs.listing.listingId,
      inputs.listing.materialVersion,
      inputs.listing.materialHash,
      inputs.checkpoint.analysisHashes.content,
      inputs.checkpoint.analysisHashes.matchFacts,
      inputs.checkpoint.analysisHashes.position,
      inputs.checkpoint.positionPayloadHash,
      resolution.normalizedCompanyName,
      resolution.assertedCountryCode,
      resolution.resolvedLocality,
      resolution.state,
      resolution.selectedOrganizationId,
      resolution.selectedDisplayName,
      ORGANIZATION_RESOLVER_VERSION,
      resolution.reasonCode,
      resolution.candidateCount,
      resolution.evidenceCount,
      resolution.candidateDigest,
      resolution.evidenceDigest,
      resolution.resolutionHash,
      claim.leaseToken,
      resolutionGuardToken,
      timestamp
    );
}

function organizationCandidatesInserts(
  db: D1Database,
  rows: OrganizationCandidateArtifact[]
) {
  return canonicalJsonPages(rows, "organization candidates").map((page) =>
    db
      .prepare(
        `INSERT INTO public_projection_organization_candidates (
        resolution_id,run_id,ordinal,organization_id,evidence_tier,
        organization_status,normalized_name,country_code,
        normalized_locality,normalized_domain,selected,candidate_hash,
        created_at
      )
      SELECT json_extract(value,'$.resolutionId'),
             json_extract(value,'$.runId'),json_extract(value,'$.ordinal'),
             json_extract(value,'$.organizationId'),
             json_extract(value,'$.evidenceTier'),
             json_extract(value,'$.organizationStatus'),
             json_extract(value,'$.normalizedName'),
             json_extract(value,'$.countryCode'),
             json_extract(value,'$.normalizedLocality'),
             json_extract(value,'$.normalizedDomain'),
             json_extract(value,'$.selected'),
             json_extract(value,'$.candidateHash'),
             json_extract(value,'$.createdAt')
        FROM json_each(?)`
      )
      .bind(page)
  );
}

function organizationEvidenceInserts(
  db: D1Database,
  rows: OrganizationEvidenceArtifact[]
) {
  return canonicalJsonPages(rows, "organization evidence").map((page) =>
    db
      .prepare(
        `INSERT INTO public_projection_organization_evidence (
        resolution_id,run_id,ordinal,organization_id,evidence_tier,
        evidence_kind,polarity,source_key,source_reference,observed_at,
        evidence_hash,created_at
      )
      SELECT json_extract(value,'$.resolutionId'),
             json_extract(value,'$.runId'),json_extract(value,'$.ordinal'),
             json_extract(value,'$.organizationId'),
             json_extract(value,'$.evidenceTier'),
             json_extract(value,'$.evidenceKind'),
             json_extract(value,'$.polarity'),
             json_extract(value,'$.sourceKey'),
             json_extract(value,'$.sourceReference'),
             json_extract(value,'$.observedAt'),
             json_extract(value,'$.evidenceHash'),
             json_extract(value,'$.createdAt')
        FROM json_each(?)`
      )
      .bind(page)
  );
}

function locationResolutionInserts(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  rows: LocationResolutionArtifact[],
  resolutionGuardToken: string
) {
  const persistedRows = rows.map(
    ({
      candidates: _candidates,
      evidence: _evidence,
      providerEvidence: _providerEvidence,
      ...row
    }) => row
  );
  return canonicalJsonPages(persistedRows, "location resolutions").map((page) =>
    db
      .prepare(
        `INSERT INTO public_projection_location_resolutions (
        id,run_id,position_item_id,ordinal,position_input_hash,literal_label,
        literal_evidence,normalized_label,semantic_kind,location_role,scope,
        workplace_type,asserted_country_code,state,reason_code,provider,
        selected_provider_place_id,proposed_canonical_location_id,
        display_name,country_code,region,locality,postal_code,latitude,
        longitude,bounds_json,feature_type,coordinate_kind,resolver_version,
        request_hash,response_hash,candidate_count,viable_candidate_count,
        candidate_digest,evidence_digest,resolution_hash,claim_lease_token,
        resolution_guard_token,queried_at,created_at
      )
      SELECT json_extract(value,'$.resolutionId'),
             json_extract(value,'$.runId'),?,json_extract(value,'$.ordinal'),?,
             json_extract(value,'$.literalLabel'),
             json_extract(value,'$.literalEvidence'),
             json_extract(value,'$.normalizedLabel'),
             json_extract(value,'$.semanticKind'),
             json_extract(value,'$.locationRole'),
             json_extract(value,'$.scope'),
             json_extract(value,'$.workplaceType'),
             json_extract(value,'$.assertedCountryCode'),
             json_extract(value,'$.state'),json_extract(value,'$.reasonCode'),
             json_extract(value,'$.provider'),
             json_extract(value,'$.selectedProviderPlaceId'),
             json_extract(value,'$.proposedCanonicalLocationId'),
             json_extract(value,'$.displayName'),
             json_extract(value,'$.countryCode'),json_extract(value,'$.region'),
             json_extract(value,'$.locality'),
             json_extract(value,'$.postalCode'),
             json_extract(value,'$.latitude'),
             json_extract(value,'$.longitude'),
             json_extract(value,'$.boundsJson'),
             json_extract(value,'$.featureType'),
             json_extract(value,'$.coordinateKind'),?,
             json_extract(value,'$.requestHash'),
             json_extract(value,'$.responseHash'),
             json_extract(value,'$.candidateCount'),
             json_extract(value,'$.viableCandidateCount'),
             json_extract(value,'$.candidateDigest'),
             json_extract(value,'$.evidenceDigest'),
             json_extract(value,'$.resolutionHash'),?,?,
             json_extract(value,'$.queriedAt'),json_extract(value,'$.createdAt')
        FROM json_each(?)`
      )
      .bind(
        claim.id,
        claim.inputHash,
        LOCATION_RESOLVER_VERSION,
        claim.leaseToken,
        resolutionGuardToken,
        page
      )
  );
}

function locationProviderEvidenceInserts(
  db: D1Database,
  rows: ProviderEvidenceArtifact[]
) {
  return canonicalJsonPages(rows, "location provider evidence").map((page) =>
    db
      .prepare(
        `INSERT INTO public_projection_location_provider_evidence (
        resolution_id,run_id,provider,permanent,request_json,request_hash,
        response_json,response_hash,ordered_candidate_ids_json,queried_at,
        created_at
      )
      SELECT json_extract(value,'$.resolutionId'),
             json_extract(value,'$.runId'),json_extract(value,'$.provider'),
             json_extract(value,'$.permanent'),
             json_extract(value,'$.requestJson'),
             json_extract(value,'$.requestHash'),
             json_extract(value,'$.responseJson'),
             json_extract(value,'$.responseHash'),
             json_extract(value,'$.orderedCandidateIdsJson'),
             json_extract(value,'$.queriedAt'),json_extract(value,'$.createdAt')
        FROM json_each(?)`
      )
      .bind(page)
  );
}

function locationCandidateInserts(
  db: D1Database,
  rows: LocationCandidateArtifact[]
) {
  return canonicalJsonPages(rows, "location candidates").map((page) =>
    db
      .prepare(
        `INSERT INTO public_projection_location_candidates (
        resolution_id,run_id,ordinal,provider_place_id,feature_type,
        preferred_name,full_name,country_code,region,locality,postal_code,
        longitude,latitude,bounds_json,coordinate_accuracy,context_json,
        match_code_json,provider_order,viable,candidate_hash,created_at
      )
      SELECT json_extract(value,'$.resolutionId'),
             json_extract(value,'$.runId'),json_extract(value,'$.ordinal'),
             json_extract(value,'$.providerPlaceId'),
             json_extract(value,'$.featureType'),
             json_extract(value,'$.preferredName'),
             json_extract(value,'$.fullName'),
             json_extract(value,'$.countryCode'),json_extract(value,'$.region'),
             json_extract(value,'$.locality'),
             json_extract(value,'$.postalCode'),
             json_extract(value,'$.longitude'),json_extract(value,'$.latitude'),
             json_extract(value,'$.boundsJson'),
             json_extract(value,'$.coordinateAccuracy'),
             json_extract(value,'$.contextJson'),
             json_extract(value,'$.matchCodeJson'),
             json_extract(value,'$.providerOrder'),
             json_extract(value,'$.viable'),
             json_extract(value,'$.candidateHash'),
             json_extract(value,'$.createdAt')
        FROM json_each(?)`
      )
      .bind(page)
  );
}

function locationEvidenceInserts(
  db: D1Database,
  rows: LocationEvidenceArtifact[]
) {
  return canonicalJsonPages(rows, "location evidence").map((page) =>
    db
      .prepare(
        `INSERT INTO public_projection_location_evidence (
        resolution_id,run_id,ordinal,evidence_kind,source_reference,
        evidence_json,evidence_hash,created_at
      )
      SELECT json_extract(value,'$.resolutionId'),
             json_extract(value,'$.runId'),json_extract(value,'$.ordinal'),
             json_extract(value,'$.evidenceKind'),
             json_extract(value,'$.sourceReference'),
             json_extract(value,'$.evidenceJson'),
             json_extract(value,'$.evidenceHash'),
             json_extract(value,'$.createdAt')
        FROM json_each(?)`
      )
      .bind(page)
  );
}

function transactionChangeAssertion(db: D1Database) {
  return db.prepare(
    `INSERT INTO transaction_assertions(must_equal_one)
     SELECT 0 WHERE changes()<>1`
  );
}

function canonicalJsonPages<T>(rows: T[], label: string) {
  if (rows.length === 0) {
    return [];
  }
  const pages: string[] = [];
  let pageRows: string[] = [];
  let pageBytes = 2;
  for (const row of rows) {
    const rowJson = canonicalJson(row);
    const rowBytes = encodedBytes(rowJson);
    if (rowBytes + 2 > MAX_D1_BOUND_JSON_BYTES) {
      throw new CanonicalResolutionInputError(
        "canonical_resolution_evidence_page_too_large",
        `One ${label} row exceeds the D1 bound-value limit`
      );
    }
    const separatorBytes = pageRows.length === 0 ? 0 : 1;
    if (
      pageRows.length > 0 &&
      pageBytes + separatorBytes + rowBytes > MAX_D1_BOUND_JSON_BYTES
    ) {
      pages.push(`[${pageRows.join(",")}]`);
      pageRows = [];
      pageBytes = 2;
    }
    pageRows.push(rowJson);
    pageBytes += (pageRows.length === 1 ? 0 : 1) + rowBytes;
  }
  pages.push(`[${pageRows.join(",")}]`);
  return pages;
}

function encodedBytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function canonicalSignalInsert(
  db: D1Database,
  input: {
    createdAt: string;
    locationIdsJson: string;
    locationSetHash: string;
    normalizedSubjectsJson: string;
    normalizedTitle: string;
    organizationResolutionHash: string;
    organizationResolutionId: string;
    positionItemId: string;
    roleFamily: string;
    runId: string;
    signalHash: string | null;
    signalPayloadHash: string;
    state: "blocked" | "resolved";
  }
) {
  return db
    .prepare(
      `INSERT INTO public_projection_canonical_identity_signals (
        run_id,position_item_id,organization_resolution_id,
        organization_resolution_hash,location_set_hash,role_family,
        normalized_title,normalized_subjects_json,location_ids_json,state,
        signal_hash,signal_payload_hash,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      input.runId,
      input.positionItemId,
      input.organizationResolutionId,
      input.organizationResolutionHash,
      input.locationSetHash,
      input.roleFamily,
      input.normalizedTitle,
      input.normalizedSubjectsJson,
      input.locationIdsJson,
      input.state,
      input.signalHash,
      input.signalPayloadHash,
      input.createdAt
    );
}

function resolutionSealInsert(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  input: {
    canonicalSignalHash: string | null;
    createdAt: string;
    duplicateBatchInputHash: string;
    locationCount: number;
    locationSetHash: string;
    organizationResolutionHash: string;
    organizationResolutionId: string;
    positionInputHash: string;
    positionItemId: string;
    reasonCode: string;
    runId: string;
    sealHash: string;
    sourcePositionId: string;
    state: ResolutionState;
  }
) {
  return db
    .prepare(
      `INSERT INTO public_projection_resolution_seals (
        run_id,position_item_id,source_position_id,position_input_hash,
        duplicate_batch_input_hash,organization_resolution_id,
        organization_resolution_hash,location_count,location_set_hash,
        canonical_signal_hash,state,reason_code,seal_hash,claim_lease_token,
        created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      input.runId,
      input.positionItemId,
      input.sourcePositionId,
      input.positionInputHash,
      input.duplicateBatchInputHash,
      input.organizationResolutionId,
      input.organizationResolutionHash,
      input.locationCount,
      input.locationSetHash,
      input.canonicalSignalHash,
      input.state,
      input.reasonCode,
      input.sealHash,
      claim.leaseToken,
      input.createdAt
    );
}

function providerFailureShouldRetry(
  code: LocationProviderErrorCode,
  claim: ClaimedProjectionPosition
) {
  return (
    [
      "location_provider_rate_limit",
      "location_provider_timeout",
      "location_provider_transport",
    ].includes(code) && claim.attemptCount < claim.maxAttempts
  );
}

async function retryProviderFailure(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  error: LocationProviderError,
  checkpoint: Record<string, unknown>
): Promise<CanonicalResolutionResult> {
  const result = await claimedPositionUpdateStatement(db, claim, {
    checkpoint: {
      ...checkpoint,
      canonicalResolution: {
        attempt: claim.attemptCount,
        reasonCode: error.code,
        state: "retry",
      },
    },
    errorCode: error.code,
    errorDetail: error.message,
    stage: "canonical_resolution",
    status: "queued",
  }).run();
  assertClaimedPositionUpdate(result, "canonical resolution retry");
  return { blocked: 0, resolved: 0, retried: 1, sealed: 0, state: "retry" };
}

async function blockInputClaim(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  timestamp: string,
  errorCode: string,
  errorDetail: string,
  checkpoint: Record<string, unknown>
): Promise<CanonicalResolutionResult> {
  const results = await db.batch([
    claimedPositionUpdateStatement(db, claim, {
      checkpoint: {
        ...checkpoint,
        canonicalResolution: { reasonCode: errorCode, state: "blocked" },
      },
      errorCode,
      errorDetail,
      stage: "canonical_resolution",
      status: "blocked",
    }),
    projectionRunCounterStatement(db, claim.runId, timestamp),
  ]);
  assertClaimedPositionUpdate(results[0], "canonical resolution input block");
  return { blocked: 1, resolved: 0, retried: 0, sealed: 0, state: "blocked" };
}

async function canonicalLocationId(providerPlaceId: string) {
  return `loc_v1_${await sha256Hex(
    `jobkit-canonical-location/v1\0mapbox-geocoding-v6\0${providerPlaceId}`
  )}`;
}

async function sha256Id(prefix: string, input: string) {
  return `${prefix}${await sha256Hex(input)}`;
}

function countryCodeForLabel(value: string): string | null {
  const normalized = normalizeText(value);
  if (COUNTRY_CODE_PATTERN.test(normalized)) {
    return normalized.toUpperCase();
  }
  return (
    countryAliases.get(normalized) ?? countryCodeByName.get(normalized) ?? null
  );
}

function normalizedHost(value: string) {
  try {
    return normalizeDomain(new URL(value).hostname);
  } catch {
    return "";
  }
}

function organizationRouteIdentities(values: string[]) {
  const identities = new Map<string, OrganizationRouteIdentity>();
  for (const value of values) {
    try {
      const url = new URL(value);
      const host = normalizeDomain(url.hostname);
      const registrableDomain = registrableDomainForHost(host);
      if (!host) {
        continue;
      }
      const identity = {
        host,
        path: normalizedPathPrefix(url.pathname) || "/",
        registrableDomain,
      };
      identities.set(canonicalJson(identity), identity);
    } catch {
      // Malformed route values provide no organization identity evidence.
    }
  }
  return [...identities.values()].sort((left, right) =>
    compareUtf8Bytes(canonicalJson(left), canonicalJson(right))
  );
}

function registrableDomainForHost(host: string) {
  const domain = getDomain(host, {
    allowIcannDomains: true,
    allowPrivateDomains: false,
    extractHostname: false,
  });
  return domain ? normalizeDomain(domain) : "";
}

function normalizedPathPrefix(value: string) {
  const trimmed = value.trim().replace(TRAILING_PATH_SEPARATOR_PATTERN, "");
  return trimmed || "";
}

function normalizeDomain(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(TRAILING_PERIOD_PATTERN, "");
}

function normalizeText(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
