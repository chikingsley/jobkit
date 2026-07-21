export interface JobDraft {
  attachments: Array<{
    category: string;
    filename: string;
    sizeBytes: number;
  }>;
  changeSummary: string;
  createdAt: string;
  id: string;
  message: string;
  previousMessage: string;
  revisionSource: "ai_revision" | "generated" | "manual_edit" | "undo";
  status: string;
  version: number;
}

export interface DraftMutationResult {
  draft: Omit<JobDraft, "attachments">;
  notice: string;
  ok: true;
}

export interface EmailAttempt {
  attemptId: string;
  draftId: string;
  recipient: string;
  routeId: string;
  sendRequestedAt: string | null;
  status: string;
  subject: string;
  updatedAt: string;
}

export interface ApplicationRoute {
  contact: ContactSummary | null;
  destination: string;
  id: string;
  kind: string;
  lastVerifiedAt: string | null;
  status: string;
}

export interface ContactSummary {
  displayName: string;
  id: string;
  organizationName: string;
  relatedListingCount: number;
  role: "board_intermediary" | "employer" | "recruiter" | "unknown";
}

export interface Job {
  applicationRoutes: ApplicationRoute[];
  applyUrl: string;
  board: string;
  company: string;
  compensation: Compensation;
  country: string;
  description: string;
  draft: JobDraft | null;
  draftTask: {
    error: string;
    id: string;
    mode: "generate" | "revise";
    status: "cancelled" | "claimed" | "completed" | "failed" | "queued";
    updatedAt: string;
  } | null;
  emailAttempt: EmailAttempt | null;
  id: string;
  location: string;
  marketSegments: MarketSegment[];
  matchFacts: JobMatchFacts | null;
  messageRoute: "advertised_position" | "multi_position" | "school_outreach";
  opportunityScope: "direct" | "multi_position" | "unknown";
  positionAnalysis: JobPositionAnalysis | null;
  sourceReference: string;
  sourceUrl: string;
  status: string;
  title: string;
}

export type MarketSegment = JobMarketSegment;

import type { JobMatchFacts } from "@/features/matching/schema";
import type { JobMarketSegment } from "@/features/organizations/market-segments";
import type { Compensation } from "./economics";
import type { JobPositionAnalysis } from "./position-variants";

export type { Compensation, FxData } from "./economics";
