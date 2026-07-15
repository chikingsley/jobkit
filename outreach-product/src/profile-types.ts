import type { QualificationClaimAnswer } from "@/features/matching/claims";

export type {
  BenefitStrength,
  Preferences,
  RuleStrength,
} from "@/features/preferences/schema";
export type { Profile } from "@/features/profile/schema";

export interface StoredDocument {
  category: string;
  content_type: string;
  created_at: string;
  filename: string;
  id: string;
  is_default: number;
  size_bytes: number;
}

export type MatchState = "match" | "conflict" | "unknown" | "preference";

export interface MatchCriterion {
  claimAnswer?: QualificationClaimAnswer;
  claimKey?: string;
  claimKind?: string;
  evidence?: string;
  importance?: "required" | "preferred";
  label: string;
  state: MatchState;
}

export interface JobMatch {
  criteria: MatchCriterion[];
  label:
    | "Strong match"
    | "Likely match"
    | "Needs verification"
    | "Preference mismatch"
    | "Ineligible";
  score: number;
  tone: "positive" | "neutral" | "warning" | "negative";
}
