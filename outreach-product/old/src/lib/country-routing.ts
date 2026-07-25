import { getCountries } from "libphonenumber-js";

const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });

const countryCodesBySlug = new Map(
  getCountries().map((countryCode) => [
    slugify(countryDisplayName(countryCode)),
    countryCode,
  ])
);

export function countryDisplayName(countryCode: string) {
  const normalizedCode = countryCode.trim().toUpperCase();
  return countryDisplayNames.of(normalizedCode) ?? normalizedCode;
}

export function countrySlugForCode(countryCode: string) {
  return slugify(countryDisplayName(countryCode));
}

export function countryCodeForSlug(countrySlug: string) {
  return countryCodesBySlug.get(countrySlug.trim().toLowerCase()) ?? null;
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}
