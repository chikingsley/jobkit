import { z } from "zod";
import { InventoryMarketSegmentSchema } from "./inventory/schema";
import type { JobPositionAnalysis } from "./jobs/position-variants";
import type { Compensation } from "./jobs/types";

export const MarketSegmentSchema = InventoryMarketSegmentSchema;

export const OpportunityScopeSchema = z.enum([
  "direct",
  "multi_position",
  "unknown",
]);

export const ApplicationMessageRouteSchema = z.enum([
  "advertised_position",
  "multi_position",
  "school_outreach",
]);

export const JobImportSchema = z.object({
  applyEmail: z.union([z.literal(""), z.email()]).default(""),
  applyUrl: z.string().url().or(z.literal("")),
  board: z.string().default("seriousteachers"),
  company: z.string().default(""),
  contactName: z.string().default(""),
  country: z.string().default(""),
  description: z.string().default(""),
  employerId: z.string().default(""),
  id: z.string().min(1),
  location: z.string().default(""),
  marketSegments: z.array(MarketSegmentSchema).max(8).default([]),
  messageRoute: ApplicationMessageRouteSchema.default("advertised_position"),
  opportunityScope: OpportunityScopeSchema.default("unknown"),
  priority: z.number().int().default(0),
  salary: z.string().default(""),
  sourceReference: z.string().default(""),
  sourceUrl: z.string().default(""),
  title: z.string().min(1),
});

export const ImportSchema = z.object({
  jobs: z.array(JobImportSchema).min(1).max(100),
});
export const ReviseSchema = z.object({
  instruction: z.string().min(1).max(1000),
});
export const ManualDraftSchema = z.object({
  message: z.string().min(100).max(5000),
});
export const SubmitSchema = z.object({ draftId: z.string().min(1) });

export type JobImport = z.infer<typeof JobImportSchema>;
export type ApplicationMessageRoute = z.infer<
  typeof ApplicationMessageRouteSchema
>;

export interface ReviewJob {
  applicationRoutes: Array<{
    contact: null | {
      displayName: string;
      id: string;
      organizationName: string;
      relatedListingCount: number;
      role: "board_intermediary" | "employer" | "recruiter" | "unknown";
    };
    destination: string;
    id: string;
    kind: string;
    lastVerifiedAt: string | null;
    status: string;
  }>;
  applyUrl: string;
  company: string;
  compensation: Compensation;
  country: string;
  description: string;
  draft: null | {
    attachments: Array<{
      category: string;
      filename: string;
      sizeBytes: number;
    }>;
    id: string;
    version: number;
    message: string;
    changeSummary: string;
    createdAt: string;
    status: string;
    previousMessage: string;
    revisionSource: "ai_revision" | "generated" | "manual_edit" | "undo";
  };
  emailAttempt: null | {
    attemptId: string;
    draftId: string;
    recipient: string;
    routeId: string;
    sendRequestedAt: string | null;
    status: string;
    subject: string;
    updatedAt: string;
  };
  id: string;
  location: string;
  marketSegments: z.infer<typeof MarketSegmentSchema>[];
  messageRoute: z.infer<typeof ApplicationMessageRouteSchema>;
  opportunityScope: z.infer<typeof OpportunityScopeSchema>;
  positionAnalysis: JobPositionAnalysis | null;
  priority: number;
  sourceReference: string;
  sourceUrl: string;
  status: string;
  title: string;
}
