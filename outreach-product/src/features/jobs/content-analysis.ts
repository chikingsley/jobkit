import { z } from "zod";

const EvidenceTextSchema = z
  .object({
    evidence: z.array(z.string().min(1).max(1600)).min(1).max(6),
    text: z.string().min(1).max(1600),
  })
  .strict();

const EvidenceFactSchema = z
  .object({
    evidence: z.array(z.string().min(1).max(1600)).min(1).max(4),
    label: z.string().min(1).max(80),
    value: z.string().min(1).max(400),
  })
  .strict();

const AdditionalSectionSchema = z
  .object({
    items: z.array(EvidenceTextSchema).min(1).max(30),
    title: z.string().min(1).max(120),
  })
  .strict();

export const JobContentAnalysisSchema = z
  .object({
    additionalSections: z.array(AdditionalSectionSchema).max(12),
    applicationProcess: z.array(EvidenceTextSchema).max(20),
    overview: z.array(EvidenceTextSchema).min(1).max(3),
    responsibilities: z.array(EvidenceTextSchema).max(40),
    scheduleAndContract: z.array(EvidenceFactSchema).max(20),
    teachingContext: z.array(EvidenceFactSchema).max(20),
    unplacedEvidence: z.array(z.string().min(1).max(1600)).max(30),
  })
  .strict();

export const JOB_CONTENT_ANALYSIS_SCHEMA_VERSION = 1;

export type JobContentAnalysis = z.infer<typeof JobContentAnalysisSchema>;
