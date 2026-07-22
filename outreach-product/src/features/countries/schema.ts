import { z } from "zod";
import { OrganizationMarketSegmentSchema } from "../organizations/market-segments";

export const MAX_COUNTRY_SWEEP_CITIES = 250;

const CITY_KEY_SEPARATOR_PATTERN = /[^\p{Letter}\p{Number}]+/gu;
const COMBINING_MARK_PATTERN = /\p{Mark}+/gu;
const LETTER_OR_NUMBER_PATTERN = /[\p{Letter}\p{Number}]/u;

const CountrySweepCitySchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(LETTER_OR_NUMBER_PATTERN, "A city must contain a letter or number");

export const CountryDiscoverySourceSchema = z.enum([
  "directories",
  "known_sources",
  "maps",
  "search",
]);

export const CountrySweepRequestSchema = z
  .object({
    cities: z.array(CountrySweepCitySchema).default([]),
    includeDirectories: z.boolean().default(true),
    includeKnownSources: z.boolean().default(true),
    includeMaps: z.boolean().default(true),
    includeSearch: z.boolean().default(true),
  })
  .strict()
  .refine(
    (value) =>
      value.includeDirectories ||
      value.includeKnownSources ||
      value.includeMaps ||
      value.includeSearch,
    { message: "Choose at least one discovery source" }
  )
  .refine(
    (value) =>
      normalizeCountrySweepCities(value.cities).length <=
      MAX_COUNTRY_SWEEP_CITIES,
    {
      message: `Choose at most ${MAX_COUNTRY_SWEEP_CITIES} distinct cities`,
      path: ["cities"],
    }
  )
  .transform((value) => ({
    ...value,
    cities: normalizeCountrySweepCities(value.cities),
  }));

export function countrySweepCityKey(city: string) {
  return city
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(COMBINING_MARK_PATTERN, "")
    .replaceAll(CITY_KEY_SEPARATOR_PATTERN, "-")
    .replaceAll(/^-|-$/gu, "");
}

export function normalizeCountrySweepCities(cities: readonly string[]) {
  const citiesByKey = new Map<string, string>();
  for (const rawCity of cities) {
    const city = rawCity.trim();
    const key = countrySweepCityKey(city);
    if (!citiesByKey.has(key)) {
      citiesByKey.set(key, city);
    }
  }
  return [...citiesByKey]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([, city]) => city);
}

const SweepContactPointSchema = z
  .object({
    evidenceUrl: z.string().url().or(z.literal("")),
    kind: z.enum(["email", "phone", "contact_form", "careers_page", "website"]),
    label: z.string().max(160),
    status: z.enum(["unverified", "active", "stale", "invalid"]),
    value: z.string().min(1).max(1000),
  })
  .strict();

const SweepOrganizationSchema = z
  .object({
    canonicalDomain: z.string().max(255),
    city: z.string().max(160),
    contactPoints: z.array(SweepContactPointSchema),
    evidenceUrl: z.string().url().or(z.literal("")),
    lastVerifiedAt: z.iso.datetime().nullable(),
    marketSegment: OrganizationMarketSegmentSchema,
    name: z.string().min(1).max(240),
    outreachEligibility: z.enum(["eligible", "review", "excluded"]),
    region: z.string().max(160),
    status: z.enum(["unverified", "active", "stale", "closed", "invalid"]),
    websiteUrl: z.string().url().or(z.literal("")),
  })
  .strict();

const CountryDiscoveryScopeSchema = z
  .object({
    city: z.string().trim().max(160).default(""),
    query: z.string().trim().max(500).default(""),
    source: CountryDiscoverySourceSchema,
  })
  .strict();

const CountryCoverageSummarySchema = z
  .object({
    citiesChecked: z.array(z.string().max(160)).default([]),
    gaps: z.array(z.string().max(1000)).default([]),
    needsAnotherPass: z.boolean().default(false),
    nextScopes: z.array(CountryDiscoveryScopeSchema).default([]),
    queriesChecked: z.array(z.string().max(1000)).default([]),
    resultCount: z.number().int().nonnegative().default(0),
    sourcesChecked: z.array(z.string().max(500)).default([]),
  })
  .strict();

export const CountrySweepTaskOutputSchema = z
  .object({
    coverageSummary: CountryCoverageSummarySchema,
    notes: z.array(z.string().max(1000)).default([]),
    organizations: z.array(SweepOrganizationSchema).default([]),
  })
  .strict();

export type CountrySweepRequest = z.infer<typeof CountrySweepRequestSchema>;
export type CountrySweepTaskOutput = z.infer<
  typeof CountrySweepTaskOutputSchema
>;
