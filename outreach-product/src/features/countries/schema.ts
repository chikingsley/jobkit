import { z } from "zod";

export const CountryDiscoverySourceSchema = z.enum([
  "directories",
  "known_sources",
  "maps",
  "search",
]);

export const CountrySweepRequestSchema = z
  .object({
    cities: z.array(z.string().trim().min(1).max(160)).default([]),
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
  );

const SweepMarketSegmentSchema = z.enum([
  "international_school",
  "kindergarten",
  "language_center",
  "private_school",
  "public_school",
  "school",
  "training_center",
  "university",
]);

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
    marketSegment: SweepMarketSegmentSchema,
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
