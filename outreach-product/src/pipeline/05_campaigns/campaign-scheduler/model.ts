export interface DueCampaignRow {
  daily_pace: number;
  first_five_completed_at: string | null;
  first_five_required: number;
  human_reply_count: number;
  id: string;
  next_run_at: string;
  posted_target_percent: number;
  stop_after_human_replies: number;
  user_id: string;
}

export interface DispatchSeed {
  channel: string;
  country_code: string;
  dedup_key: string;
  dispatch_id?: string;
  id: string;
  match_score?: number | null;
  route_strategy: "anesl_bundle" | "single";
  source_kind: "advertised" | "school";
}

export interface DispatchGroup {
  channel: string;
  countryCode: string;
  dedupKey: string;
  dispatchId?: string;
  routeStrategy: "anesl_bundle" | "single";
  sourceKind: "advertised" | "school";
  targets: DispatchSeed[];
}

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
