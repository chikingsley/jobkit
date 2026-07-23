import { z } from "zod";

export const D1_ROW_SCHEMA = z.record(z.string(), z.unknown());

export const CAMPAIGN_TARGET_PAGE_SIZE = 100;

export interface CampaignRow {
  created_at: string;
  daily_pace: number;
  first_five_completed_at: string | null;
  first_five_required: number;
  human_reply_count: number;
  id: string;
  name: string;
  next_run_at: string | null;
  pause_reason: string;
  posted_target_percent: number;
  status: string;
  stop_after_human_replies: number;
  updated_at: string;
  user_id: string;
}

export interface TargetSeedRow {
  channel: string;
  country_code: string;
  dedup_key: string;
  id: string;
  match_score: number | null;
  route_strategy: "anesl_bundle" | "single";
  source_kind: "advertised" | "school";
}

export class CampaignError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409) {
    super(message);
    this.status = status;
  }
}
