import { canonicalJson, canonicalSha256 } from "../hash";
import type {
  LocationProviderErrorCode,
  MapboxBoundingBox,
  MapboxFeature,
} from "../mapbox-location-resolver";
import type { ClaimedProjectionPosition } from "../position-items";
import { locationAssertions } from "./location-assertions";
import type {
  LocationEvidenceArtifact,
  LocationReasonCode,
  LocationResolutionArtifact,
  ResolutionInputs,
} from "./model";
import { countryCodeForLabel, normalizeText, sha256Id } from "./support";

export async function blockedProviderLocations(
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

export async function unresolvedLocation(
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

export function featureMatchesParentGeography(
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

export function addressMatchCodeSupports(
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

export function parseBoundingBox(
  value: string | null
): MapboxBoundingBox | null {
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
