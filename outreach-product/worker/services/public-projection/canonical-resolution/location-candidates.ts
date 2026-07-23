import { canonicalJson, canonicalSha256, compareUtf8Bytes } from "../hash";
import type {
  MapboxFeature,
  PermanentLocationResponse,
} from "../mapbox-location-resolver";
import type { ClaimedProjectionPosition } from "../position-items";
import type { locationAssertions } from "./location-assertions";
import {
  addressMatchCodeSupports,
  featureMatchesParentGeography,
} from "./location-outcome";
import type {
  LocationCandidateArtifact,
  LocationEvidenceArtifact,
  LocationReasonCode,
  LocationResolutionArtifact,
  ProviderEvidenceArtifact,
  ResolutionState,
} from "./model";
import { canonicalLocationId, normalizeText, sha256Id } from "./support";

export async function normalizeLocationResponse(
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
  if (countryFeatureMatchesAssertion(assertion, countryCode)) {
    return true;
  }
  const label = normalizeText(assertion.label);
  const firstComponent = normalizeText(assertion.label.split(",")[0] ?? "");
  return (
    label === normalizeText(preferredName) ||
    label === normalizeText(fullName) ||
    firstComponent === normalizeText(preferredName)
  );
}

function countryFeatureMatchesAssertion(
  assertion: ReturnType<typeof locationAssertions>[number],
  countryCode: string | null
) {
  return (
    assertion.semanticKind === "country" &&
    Boolean(assertion.countryCode) &&
    assertion.countryCode === countryCode?.toUpperCase()
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
