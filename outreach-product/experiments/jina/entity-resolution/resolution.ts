import type { EntityDocument, EntityLinkCase } from "./contracts";

export type StableResolutionReason =
  | "acronym-and-location"
  | "contact-and-country"
  | "domain"
  | "normalized-name";

export interface StableResolution {
  candidateId: string;
  reason: StableResolutionReason;
}

const WORD_EXPANSIONS: Record<string, string> = {
  acad: "academy",
  centre: "center",
  coll: "college",
  ctr: "center",
  edu: "education",
  intl: "international",
  lang: "language",
  sch: "school",
  univ: "university",
};

const LEGAL_SUFFIX_PATTERN =
  /\b(?:co|company|corp|corporation|inc|incorporated|ltd|llc|limited|plc)\b/gu;
const WWW_PREFIX_PATTERN = /^www\./u;

export function resolveByStableIdentity(
  testCase: EntityLinkCase
): StableResolution | null {
  const rules: Array<{
    matches: (candidate: EntityDocument) => boolean;
    reason: StableResolutionReason;
  }> = [
    {
      matches: (candidate) =>
        Boolean(testCase.anchor.facts.domain) &&
        normalizeDomain(candidate.facts.domain) ===
          normalizeDomain(testCase.anchor.facts.domain),
      reason: "domain",
    },
    {
      matches: (candidate) =>
        normalizedName(candidate.facts.name) ===
          normalizedName(testCase.anchor.facts.name) &&
        compatibleCountry(testCase.anchor, candidate),
      reason: "normalized-name",
    },
    {
      matches: (candidate) =>
        acronymEquivalent(testCase.anchor.facts.name, candidate.facts.name) &&
        sameNonempty(testCase.anchor.facts.country, candidate.facts.country) &&
        sameNonempty(testCase.anchor.facts.location, candidate.facts.location),
      reason: "acronym-and-location",
    },
    {
      matches: (candidate) =>
        sameNonempty(
          testCase.anchor.facts.contactName,
          candidate.facts.contactName
        ) &&
        sameNonempty(testCase.anchor.facts.country, candidate.facts.country),
      reason: "contact-and-country",
    },
  ];
  for (const rule of rules) {
    const matches = testCase.candidates.filter(rule.matches);
    if (matches.length === 1) {
      return { candidateId: matches[0]?.id ?? "", reason: rule.reason };
    }
  }
  return null;
}

function compatibleCountry(left: EntityDocument, right: EntityDocument) {
  return (
    !(left.facts.country && right.facts.country) ||
    normalize(left.facts.country) === normalize(right.facts.country)
  );
}

function acronymEquivalent(left: string, right: string) {
  const normalizedLeft = normalizedName(left);
  const normalizedRight = normalizedName(right);
  return (
    acronym(normalizedLeft) === compact(normalizedRight) ||
    acronym(normalizedRight) === compact(normalizedLeft)
  );
}

function acronym(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0] ?? "")
    .join("");
}

function compact(value: string) {
  return value.replaceAll(" ", "");
}

function normalizedName(value: string) {
  return normalize(value)
    .replace(LEGAL_SUFFIX_PATTERN, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => WORD_EXPANSIONS[word] ?? word)
    .join(" ");
}

function normalizeDomain(value: string) {
  return value.trim().toLocaleLowerCase("en").replace(WWW_PREFIX_PATTERN, "");
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{M}+/gu, "")
    .replaceAll("&", " and ")
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en");
}

function sameNonempty(left: string, right: string) {
  return Boolean(left && right && normalize(left) === normalize(right));
}
