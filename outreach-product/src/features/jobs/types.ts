export interface JobDraft {
  attachments: Array<{
    category: string;
    filename: string;
    sizeBytes: number;
  }>;
  changeSummary: string;
  id: string;
  message: string;
  status: string;
  version: number;
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
  destination: string;
  id: string;
  kind: string;
  lastVerifiedAt: string | null;
  status: string;
}

export interface Compensation {
  amountMax: number | null;
  amountMin: number | null;
  confidence: "exact" | "inferred" | "conflict" | "unknown";
  currency: string | null;
  display: string;
  notes: string[];
  period: "hour" | "month" | "year" | null;
  qualifier: "exact" | "range" | "up-to" | "from" | null;
  source:
    | "listing-field"
    | "listing-description"
    | "curated-review"
    | "unknown";
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
  emailAttempt: EmailAttempt | null;
  id: string;
  location: string;
  marketSegments: MarketSegment[];
  matchFacts: JobMatchFacts | null;
  messageRoute: "advertised_position" | "multi_position" | "school_outreach";
  opportunityScope: "direct" | "multi_position" | "unknown";
  sourceUrl: string;
  status: string;
  title: string;
}

export type MarketSegment =
  | "international_school"
  | "kindergarten"
  | "language_center"
  | "online"
  | "private_school"
  | "public_school"
  | "school"
  | "training_center"
  | "university";

export interface FxData {
  rates: Record<string, number>;
  updatedAt: string | null;
}

import type { JobMatchFacts } from "@/features/matching/schema";
