import { z } from "zod";
import type { Compensation } from "../src/features/jobs/types";

export const JobImportSchema = z.object({
  applyUrl: z.string().url(),
  board: z.string().default("seriousteachers"),
  company: z.string().default(""),
  country: z.string().default(""),
  description: z.string().default(""),
  employerId: z.string().default(""),
  id: z.string().min(1),
  location: z.string().default(""),
  priority: z.number().int().default(0),
  salary: z.string().default(""),
  sourceUrl: z.string().default(""),
  title: z.string().min(1),
});

export const ImportSchema = z.object({
  jobs: z.array(JobImportSchema).min(1).max(100),
});
export const ReviseSchema = z.object({
  instruction: z.string().min(1).max(1000),
});
export const ApproveSchema = z.object({ draftId: z.string().min(1) });

export type JobImport = z.infer<typeof JobImportSchema>;

export interface ReviewJob {
  applyUrl: string;
  company: string;
  compensation: Compensation;
  country: string;
  description: string;
  draft: null | {
    id: string;
    version: number;
    message: string;
    changeSummary: string;
    status: string;
  };
  id: string;
  location: string;
  priority: number;
  sourceUrl: string;
  status: string;
  title: string;
}
