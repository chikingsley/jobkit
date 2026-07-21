import { z } from "zod";
import { JobEconomicsSchema } from "../jobs/economics";
import { JobMarketSegmentSchema } from "../organizations/market-segments";
import { DegreeLevelSchema } from "../profile/schema";

export const JobAudienceSchema = z.enum([
  "preschool",
  "primary",
  "teenagers",
  "college",
  "adults",
]);
export const JobBenefitSchema = z.enum([
  "airfare",
  "healthInsurance",
  "housing",
  "paidLeave",
  "professionalDevelopment",
  "visaSponsorship",
]);
export const JobEmploymentTypeSchema = z.enum([
  "fullTime",
  "partTime",
  "contract",
]);
export const JobRequirementKindSchema = z.enum([
  "availability",
  "citizenship",
  "credential",
  "degree",
  "document",
  "experience",
  "language",
  "residency",
  "skill",
  "workAuthorization",
  "other",
]);
export const RequirementImportanceSchema = z.enum(["required", "preferred"]);
export const RequirementLanguageLevelSchema = z.enum([
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2",
  "native",
]);

const evidenceFact = <Schema extends z.ZodType>(value: Schema) =>
  z
    .object({
      evidence: z.string().min(1).max(1200),
      value,
    })
    .strict();

export const JobBenefitFactSchema = z
  .object({
    evidence: z.string().min(1).max(1200),
    level: z.enum(["provided", "allowance", "assistance"]),
    value: JobBenefitSchema,
  })
  .strict();

export const JobRequirementSchema = z
  .object({
    alternativeGroup: z.string().min(1).max(80).nullable(),
    evidence: z.string().min(1).max(1600),
    importance: RequirementImportanceSchema,
    kind: JobRequirementKindSchema,
    label: z.string().min(1).max(240),
    minimumDegreeLevel: DegreeLevelSchema.nullable(),
    minimumLanguageLevel: RequirementLanguageLevelSchema.nullable(),
    minimumYears: z.number().min(0).max(80).nullable(),
    values: z.array(z.string().min(1).max(160)).max(20),
  })
  .strict();

export const JobMatchFactsSchema = z
  .object({
    audiences: z.array(evidenceFact(JobAudienceSchema)).max(10),
    benefits: z.array(JobBenefitFactSchema).max(20),
    economics: JobEconomicsSchema,
    employmentTypes: z.array(evidenceFact(JobEmploymentTypeSchema)).max(10),
    marketSegments: z.array(evidenceFact(JobMarketSegmentSchema)).max(8),
    requirements: z.array(JobRequirementSchema).max(60),
    reviewNotes: z.array(z.string().min(1).max(300)).max(20),
  })
  .strict();

export type JobMatchFacts = z.infer<typeof JobMatchFactsSchema>;
export type JobRequirement = z.infer<typeof JobRequirementSchema>;
