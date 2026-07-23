import { canonicalJson, canonicalSha256, compareUtf8Bytes } from "../hash";
import type {
  MapboxBoundingBox,
  PermanentLocationResolver,
} from "../mapbox-location-resolver";
import type { ClaimedProjectionPosition } from "../position-items";
import { normalizeLocationResponse } from "./location-candidates";
import { parseBoundingBox, unresolvedLocation } from "./location-outcome";
import {
  type LocationResolutionArtifact,
  MAX_LOCATION_ASSERTIONS_PER_POSITION,
  type ResolutionInputs,
} from "./model";
import { countryCodeForLabel, normalizeText, sha256Id } from "./support";

export async function resolveLocations(
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

export function locationAssertions(inputs: ResolutionInputs) {
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
