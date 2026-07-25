import { compareUtf8Bytes } from "../services/public-projection/hash";
import type {
  PublicJobCatalogLocationFacet,
  PublicJobCatalogMembershipEntry,
  PublicJobCatalogSearchEntry,
  PublicJobSearchTerm,
} from "./catalog";
import {
  type PublicJobDetailResponse,
  type PublicJobListItem,
  serializePublicJobDetailValue,
  serializePublicJobListItemValue,
} from "./schemas";

const countryCodePattern = /^[A-Z]{2}$/u;
const hashPattern = /^[0-9a-f]{64}$/u;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function parseCatalogItem(value: string) {
  try {
    return serializePublicJobListItemValue(JSON.parse(value) as unknown);
  } catch (cause) {
    throw new Error("Public job catalog item is invalid", { cause });
  }
}

export function parseCatalogDetail(value: string) {
  try {
    return serializePublicJobDetailValue(JSON.parse(value) as unknown);
  } catch (cause) {
    throw new Error("Public job catalog detail is invalid", { cause });
  }
}

export function assertDetailMatchesItem(
  detail: PublicJobDetailResponse,
  item: PublicJobListItem
) {
  const {
    descriptionHtml: _descriptionHtml,
    schemaVersion: _schemaVersion,
    ...common
  } = detail;
  if (
    detail.status !== "active" ||
    JSON.stringify(common) !== JSON.stringify(item)
  ) {
    throw new Error("Public job catalog detail differs from its list item");
  }
}

export function parseSearchTerms(value: string): PublicJobSearchTerm[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("terms are not an array");
    }
    return parsed.map((term) => {
      if (
        !isRecord(term) ||
        Object.keys(term).sort().join(",") !== "score,term" ||
        !Number.isSafeInteger(term.score) ||
        (term.score as number) <= 0 ||
        typeof term.term !== "string" ||
        term.term === ""
      ) {
        throw new Error("term is invalid");
      }
      return { score: term.score as number, term: term.term };
    });
  } catch (cause) {
    throw new Error("Public job search terms are invalid", { cause });
  }
}

export function withoutSearchIdentity(entry: PublicJobCatalogSearchEntry) {
  const {
    publicJobId: _publicJobId,
    publicJobVersion: _publicJobVersion,
    ...value
  } = entry;
  return value;
}

export function parseLocationFacets(
  value: string
): PublicJobCatalogLocationFacet[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (cause) {
    throw new Error("Public job catalog location facets are invalid", {
      cause,
    });
  }
  if (!(Array.isArray(parsed) && parsed.every(isLocationFacet))) {
    throw new Error("Public job catalog location facets are invalid");
  }
  return parsed;
}

export function assertMembershipEntries(
  entries: PublicJobCatalogMembershipEntry[]
): asserts entries is PublicJobCatalogMembershipEntry[] {
  let previousPublicJobId = "";
  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      Object.keys(entry).sort().join(",") !==
        "detailJson,eligibilityDecisionHash,eligibilityDecisionVersion,itemJson,locationFacets,publicContentHash,publicJobId,publicJobVersion" ||
      !isHash(entry.eligibilityDecisionHash) ||
      !isHash(entry.publicContentHash) ||
      typeof entry.detailJson !== "string" ||
      typeof entry.itemJson !== "string" ||
      !isPositiveInteger(entry.eligibilityDecisionVersion) ||
      !isPositiveInteger(entry.publicJobVersion) ||
      typeof entry.publicJobId !== "string" ||
      !Array.isArray(entry.locationFacets) ||
      (previousPublicJobId !== "" &&
        compareUtf8Bytes(previousPublicJobId, entry.publicJobId) >= 0)
    ) {
      throw new Error("Public job catalog membership manifest is invalid");
    }
    for (const facet of entry.locationFacets) {
      if (!isLocationFacet(facet)) {
        throw new Error("Public job catalog membership manifest is invalid");
      }
    }
    previousPublicJobId = entry.publicJobId;
  }
}

export function assertSearchEntries(entries: PublicJobCatalogSearchEntry[]) {
  let previousPublicJobId = "";
  for (const entry of entries) {
    if (!validSearchEntry(entry, previousPublicJobId)) {
      throw new Error("Public job catalog search manifest is invalid");
    }
    assertSearchTerms(entry.terms);
    previousPublicJobId = entry.publicJobId;
  }
}

function validSearchEntry(
  entry: PublicJobCatalogSearchEntry,
  previousPublicJobId: string
) {
  return (
    isRecord(entry) &&
    Object.keys(entry).sort().join(",") ===
      "conservativeHourlyUsd,effectiveRecency,publicJobId,publicJobVersion,searchDocument,terms,titleSortKey" &&
    typeof entry.publicJobId === "string" &&
    isPositiveInteger(entry.publicJobVersion) &&
    typeof entry.searchDocument === "string" &&
    entry.searchDocument.trim() !== "" &&
    typeof entry.titleSortKey === "string" &&
    entry.titleSortKey.trim() !== "" &&
    typeof entry.effectiveRecency === "string" &&
    entry.effectiveRecency.trim() !== "" &&
    (entry.conservativeHourlyUsd === null ||
      Number.isFinite(entry.conservativeHourlyUsd)) &&
    Array.isArray(entry.terms) &&
    entry.terms.length > 0 &&
    (previousPublicJobId === "" ||
      compareUtf8Bytes(previousPublicJobId, entry.publicJobId) < 0)
  );
}

function assertSearchTerms(terms: PublicJobSearchTerm[]) {
  let previousTerm = "";
  for (const term of terms) {
    if (
      !isRecord(term) ||
      Object.keys(term).sort().join(",") !== "score,term" ||
      !Number.isSafeInteger(term.score) ||
      term.score <= 0 ||
      typeof term.term !== "string" ||
      term.term === "" ||
      (previousTerm !== "" && compareUtf8Bytes(previousTerm, term.term) >= 0)
    ) {
      throw new Error("Public job catalog search manifest is invalid");
    }
    previousTerm = term.term;
  }
}

function isLocationFacet(
  value: unknown
): value is PublicJobCatalogLocationFacet {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Object.keys(value).sort().join(",") ===
      "citySlug,countryCode,countrySlug,displayName,role" &&
    (value.citySlug === null || isSlug(value.citySlug)) &&
    typeof value.countryCode === "string" &&
    countryCodePattern.test(value.countryCode) &&
    isSlug(value.countrySlug) &&
    typeof value.displayName === "string" &&
    value.displayName.trim() !== "" &&
    (value.role === "applicant_area" || value.role === "worksite")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && hashPattern.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isSlug(value: unknown): value is string {
  return typeof value === "string" && slugPattern.test(value);
}
