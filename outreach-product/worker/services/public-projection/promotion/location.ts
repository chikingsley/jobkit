import { countrySlugForCode } from "../../../../src/lib/country-routing";
import type { PublicProjectionCandidate } from "../candidates/model";

type CandidateLocation = PublicProjectionCandidate["locations"][number];

export function promotionLocationFacet(location: CandidateLocation) {
  const routing = promotionLocationRouting(location);
  return {
    citySlug: routing.citySlug,
    countryCode: location.publicValue.countryCode,
    countrySlug: routing.countrySlug,
    displayName: location.publicValue.displayName,
    role:
      location.publicValue.role === "applicantArea"
        ? ("applicant_area" as const)
        : ("worksite" as const),
  };
}

export function promotionStoredLocation(location: CandidateLocation) {
  return {
    ...location,
    storedValue: {
      ...location.publicValue,
      routing: promotionLocationRouting(location),
    },
  };
}

function promotionLocationRouting(location: CandidateLocation) {
  return {
    citySlug: location.publicValue.locality
      ? slugify(location.publicValue.locality)
      : null,
    countrySlug: countrySlugForCode(location.publicValue.countryCode),
  };
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}
