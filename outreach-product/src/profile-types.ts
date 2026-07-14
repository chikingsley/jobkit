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
  tone: "positive" | "neutral" | "warning" | "negative";
}
