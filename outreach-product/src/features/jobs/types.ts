export interface JobDraft {
  changeSummary: string;
  id: string;
  message: string;
  status: string;
  version: number;
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
  applyUrl: string;
  board: string;
  company: string;
  compensation: Compensation;
  country: string;
  description: string;
  draft: JobDraft | null;
  id: string;
  location: string;
  matchFacts: JobMatchFacts | null;
  sourceUrl: string;
  status: string;
  title: string;
}

export interface FxData {
  rates: Record<string, number>;
  updatedAt: string | null;
}

import type { JobMatchFacts } from "@/features/matching/schema";
