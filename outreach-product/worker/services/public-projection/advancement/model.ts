import type { PermanentLocationResolver } from "../mapbox-location-resolver";

export interface ActiveRunRow {
  id: string;
  policy_heads_hash: string;
  scope_json: string;
  selection_complete: number;
  selection_cursor: string;
  source_watermark_json: string;
  status: "queued" | "running";
}

export interface WaitingListingRow {
  id: string;
  policy_heads_hash: string;
  run_id: string;
  scope_json: string;
  source_watermark_json: string;
  stage: "prerequisites" | "source_positions";
}

export interface SelectionRow {
  id: string;
  material_hash: string;
  material_hash_version: number;
  material_json: string | null;
  material_version: number;
}

export interface ExpiredProjectionItemRow {
  item_id: string;
  item_kind: "listing" | "position";
  lease_token: string;
  recovered_at: string;
  run_id: string;
}

export interface RunCompletionRow {
  candidate_seal_count: number;
  duplicate_batch_count: number;
  final_duplicate_seal_count: number;
  listing_blocked: number;
  listing_completed: number;
  listing_failed: number;
  listing_superseded: number;
  listing_total: number;
  position_blocked: number;
  position_completed: number;
  position_failed: number;
  position_superseded: number;
  position_total: number;
  selection_complete: number;
}

export interface PublicProjectionAdvanceOptions {
  deferFinalDuplicate?: boolean;
  locationResolver?: PermanentLocationResolver;
}
