import { z } from "zod";

export const CampaignExecutionModeSchema = z.enum([
  "research_only",
  "review_each",
  "use_automation",
]);

export const CountryCampaignTargetStatusSchema = z.enum([
  "pending",
  "review",
  "approved",
  "sent",
  "held",
  "skipped",
  "failed",
  "replied",
]);

export const CountryCampaignLaunchSchema = z
  .object({
    executionMode: CampaignExecutionModeSchema,
    includeOpenPositions: z.boolean(),
    includeSchoolOutreach: z.boolean(),
  })
  .strict()
  .refine(
    (value) => value.includeOpenPositions || value.includeSchoolOutreach,
    { message: "Choose open positions, school outreach, or both" }
  );

export const CountryCampaignTargetDecisionSchema = z
  .object({
    reason: z.string().trim().max(500).default(""),
    status: z.enum(["approved", "held", "review"]),
  })
  .strict()
  .refine((value) => value.status !== "held" || value.reason.length > 0, {
    message: "A hold reason is required",
    path: ["reason"],
  });

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

export const SweepTaskClaimSchema = z
  .object({
    workerId: z.string().min(1).max(160),
  })
  .strict();

export const SweepTaskCompletionSchema = z
  .object({
    output: CountrySweepTaskOutputSchema,
    workerId: z.string().min(1).max(160),
  })
  .strict();

export const SweepTaskFailureSchema = z
  .object({
    error: z.string().min(1).max(4000),
    workerId: z.string().min(1).max(160),
  })
  .strict();

export const SweepRunnerTokenCreateSchema = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();

export type CampaignExecutionMode = z.infer<typeof CampaignExecutionModeSchema>;
export type CountryCampaignTargetStatus = z.infer<
  typeof CountryCampaignTargetStatusSchema
>;
export type CountryCampaignLaunch = z.infer<typeof CountryCampaignLaunchSchema>;
export type CountryCampaignTargetDecision = z.infer<
  typeof CountryCampaignTargetDecisionSchema
>;
export type CountrySweepRequest = z.infer<typeof CountrySweepRequestSchema>;
export type CountrySweepTaskOutput = z.infer<
  typeof CountrySweepTaskOutputSchema
>;
