export const MATERIALIZATION_LEASE_MINUTES = 5;

export const FANOUT_PAGE_SIZE = 1000;

type MaterializationKind =
  | "organizations_chunk"
  | "contacts_chunk"
  | "scopes_chunk"
  | "campaign_fanout"
  | "verification_fanout"
  | "phase_finalize";

export interface MaterializationItemRow {
  attempt_count: number;
  byte_length: number | null;
  chunk_id: string | null;
  country_code: string;
  error_code: string;
  expected_count: number;
  id: string;
  kind: MaterializationKind;
  lease_token: string;
  max_attempts: number;
  object_key: string | null;
  output_id: string;
  output_status: "accepted" | "materializing";
  phase: "coverage_audit" | "discovery" | "verification";
  record_count: number | null;
  schema_version: number;
  sequence: number;
  sha256: string | null;
  sweep_id: string;
  task_id: string;
  user_id: string;
}

export interface FanoutPageResult {
  completed: boolean;
  insertedCount: number;
  nextPrimary: string;
  nextSecondary: string;
  processedCount: number;
}
