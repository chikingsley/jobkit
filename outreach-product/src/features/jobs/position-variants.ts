import { z } from "zod";
import {
  JobAudienceSchema,
  JobEmploymentTypeSchema,
  JobRequirementSchema,
} from "../../pipeline/03_match/schema";

export const JOB_POSITION_ANALYSIS_SCHEMA_VERSION = 3;

const evidenceValue = <Schema extends z.ZodType>(value: Schema) =>
  z
    .object({
      evidence: z.string().min(1).max(1200),
      value,
    })
    .strict();

export const JobPositionRoleFamilySchema = z.enum([
  "early_childhood",
  "english_language",
  "homeroom",
  "leadership",
  "student_support",
  "subject_specialist",
  "other",
]);

export const JobPositionLocationSemanticKindSchema = z.enum([
  "address",
  "city",
  "country",
  "postal_code",
  "region",
  "unknown",
]);

export const JobPositionLocationRoleSchema = z.enum([
  "applicant_area",
  "unknown",
  "worksite",
]);

export const JobPositionLocationScopeSchema = z.enum([
  "address",
  "countrywide",
  "locality",
  "region",
  "unknown",
  "worldwide",
]);

export const JobPositionWorkplaceTypeSchema = z.enum([
  "hybrid",
  "onsite",
  "remote",
  "unknown",
]);

export const JobPositionParentGeographySchema = z
  .object({
    evidence: z.string().min(1).max(1200),
    semanticKind: z.enum(["city", "country", "region"]),
    value: z.string().min(1).max(160),
  })
  .strict();

export const JobPositionAddressComponentSchema = z
  .object({
    evidence: z.string().min(1).max(1200),
    kind: z.enum([
      "address_number",
      "country",
      "locality",
      "postcode",
      "region",
      "street",
    ]),
    value: z.string().min(1).max(160),
  })
  .strict();

export const JobPositionLocationSchema = z
  .object({
    addressComponents: z.array(JobPositionAddressComponentSchema).max(12),
    evidence: z.string().min(1).max(1200),
    parentGeographies: z.array(JobPositionParentGeographySchema).max(8),
    role: JobPositionLocationRoleSchema,
    scope: JobPositionLocationScopeSchema,
    semanticKind: JobPositionLocationSemanticKindSchema,
    value: z.string().min(1).max(160),
    workplaceType: JobPositionWorkplaceTypeSchema,
  })
  .strict();

export const JobPositionVariantSchema = z
  .object({
    audiences: z.array(evidenceValue(JobAudienceSchema)).max(10),
    certainty: z.enum(["explicit", "ambiguous"]),
    compensationEvidence: z.array(z.string().min(1).max(1200)).max(10),
    employmentTypes: z.array(evidenceValue(JobEmploymentTypeSchema)).max(5),
    evidence: z.array(z.string().min(1).max(1200)).min(1).max(20),
    locations: z.array(JobPositionLocationSchema).max(40),
    requirements: z.array(JobRequirementSchema).max(40),
    roleFamily: JobPositionRoleFamilySchema,
    subjects: z.array(evidenceValue(z.string().min(1).max(100))).max(30),
    title: z.string().min(1).max(240),
  })
  .strict();

export const JobPositionAnalysisSchema = z
  .object({
    positions: z.array(JobPositionVariantSchema).min(1).max(30),
    reviewNotes: z.array(z.string().min(1).max(1200)).max(20),
    scope: z.enum(["direct", "multi_position", "ambiguous"]),
  })
  .strict();

export type JobPositionAnalysis = z.infer<typeof JobPositionAnalysisSchema>;
export type JobPositionVariant = z.infer<typeof JobPositionVariantSchema>;
