import { z } from "zod";
import {
  JobAudienceSchema,
  JobEmploymentTypeSchema,
  JobRequirementSchema,
} from "../matching/schema";

export const JOB_POSITION_ANALYSIS_SCHEMA_VERSION = 2;

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

export const JobPositionVariantSchema = z
  .object({
    audiences: z.array(evidenceValue(JobAudienceSchema)).max(10),
    certainty: z.enum(["explicit", "ambiguous"]),
    compensationEvidence: z.array(z.string().min(1).max(1200)).max(10),
    employmentTypes: z.array(evidenceValue(JobEmploymentTypeSchema)).max(5),
    evidence: z.array(z.string().min(1).max(1200)).min(1).max(20),
    locations: z.array(evidenceValue(z.string().min(1).max(160))).max(40),
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
