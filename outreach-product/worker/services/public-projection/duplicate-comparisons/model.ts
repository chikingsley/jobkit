import { z } from "zod";

export const PUBLIC_DUPLICATE_PAGE_SIZE = 25;

export const MAX_PHASE_STEPS_PER_INVOCATION = 4;

export const MAX_MEMBER_FIELD_BYTES = 8192;

export const IdentityCheckpointSchema = z
  .object({
    identity: z
      .object({
        signals: z.array(
          z.object({
            hash: z.string().length(64),
            kind: z.enum(["material_clone_v1", "source_reference_v1"]),
          })
        ),
        sourcePosition: z.object({
          id: z.string().min(1),
          positionKey: z.string().min(1),
        }),
        state: z.literal("derived"),
      })
      .passthrough(),
    listingInputHash: z.string().length(64),
  })
  .passthrough();

export interface BoundaryRow {
  active_identity_count: number;
  active_listing_count: number;
  canonical_count: number;
  mode: string;
  run_id: string;
  selection_complete: number;
  status: string;
}

export interface PositionRow {
  checkpoint_json: string;
  current_material_hash: string;
  current_material_version: number;
  input_hash: string;
  listing_id: string;
  listing_input_hash: string;
  material_hash: string;
  material_json: string;
  material_version: number;
  position_item_id: string;
  position_key: string;
  source_key: string;
  source_position_id: string;
}

export interface ExistingMappingRow {
  input_hash: string;
  mapping_version: number;
  owner_position_item_id: string;
  public_job_id: string;
  public_job_version: number;
  redirect_is_terminal: number;
  redirect_root_id: string;
  source_position_id: string;
}

export interface SameRunCandidateRow {
  left_input_hash: string;
  left_listing_id: string;
  left_material_signal_hash: string;
  left_position_item_id: string;
  left_position_key: string;
  left_source_key: string;
  left_source_position_id: string;
  left_source_reference: string;
  left_source_reference_signal_hash: null | string;
  right_input_hash: string;
  right_listing_id: string;
  right_material_signal_hash: string;
  right_position_item_id: string;
  right_position_key: string;
  right_source_key: string;
  right_source_position_id: string;
  right_source_reference: string;
  right_source_reference_signal_hash: null | string;
}

export interface StablePosition {
  inputHash: string;
  listingId: string;
  materialSignalHash: string;
  positionItemId: string;
  positionKey: string;
  sourceKey: string;
  sourcePositionId: string;
  sourceReference: string;
  sourceReferenceSignalHash: null | string;
}

export class DuplicateComparisonSnapshotError extends Error {
  readonly code = "duplicate_pair_input_snapshot_changed";

  constructor(message: string) {
    super(message);
    this.name = "DuplicateComparisonSnapshotError";
  }
}
