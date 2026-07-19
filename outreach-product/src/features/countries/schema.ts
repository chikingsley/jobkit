import { z } from "zod";

export const CountrySweepRequestSchema = z
  .object({
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
    contactPoints: z.array(SweepContactPointSchema).max(10),
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

export const CountrySweepTaskOutputSchema = z
  .object({
    coverageSummary: z.record(z.string(), z.unknown()).default({}),
    notes: z.array(z.string().max(1000)).max(50).default([]),
    organizations: z.array(SweepOrganizationSchema).max(200).default([]),
  })
  .strict();

export type CountrySweepRequest = z.infer<typeof CountrySweepRequestSchema>;
export type CountrySweepTaskOutput = z.infer<
  typeof CountrySweepTaskOutputSchema
>;
