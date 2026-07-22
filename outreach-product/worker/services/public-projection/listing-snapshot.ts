import { z } from "zod";
import {
  InventoryCompensationSchema,
  InventoryMarketSegmentSchema,
} from "../../../src/features/inventory/schema";
import { jobSourceHash } from "../../ai/job-fact-extraction";
import { sha256Hex } from "./hash";

const ProjectionMaterialSchema = z
  .object({
    applyEmail: z.union([z.literal(""), z.email()]),
    applyUrl: z.union([z.literal(""), z.url()]),
    board: z.string().min(1).max(120),
    company: z.string().max(300),
    compensation: InventoryCompensationSchema,
    contactName: z.string().max(240),
    country: z.string().max(160),
    description: z.string().max(50_000),
    employerId: z.string().max(500),
    id: z.string().min(1).max(500),
    location: z.string().max(300),
    marketSegments: z.array(InventoryMarketSegmentSchema).max(8),
    salary: z.string().max(1000),
    sourceDates: z
      .object({
        expires: z.iso.date().nullable(),
        posted: z.iso.date().nullable(),
      })
      .strict(),
    sourceReference: z.string().max(500),
    sourceUrl: z.union([z.literal(""), z.url()]),
    title: z.string().min(1).max(1000),
  })
  .strict();

interface ProjectionListingSnapshotRow {
  board: string;
  current_material_hash: string;
  current_material_hash_version: number;
  current_material_version: number;
  input_hash: string;
  listing_id: string;
  material_hash: string;
  material_hash_version: number;
  material_json: string | null;
  material_version: number;
}

export interface ExactProjectionListingSnapshot {
  analysisSourceHash: string;
  board: string;
  inputHash: string;
  listingId: string;
  material: z.infer<typeof ProjectionMaterialSchema>;
  materialHash: string;
  materialHashVersion: number;
  materialJson: string;
  materialVersion: number;
}

export class ProjectionListingSnapshotError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ProjectionListingSnapshotError";
  }
}

export async function readExactProjectionListingSnapshot(
  db: D1Database,
  listingItemId: string
): Promise<ExactProjectionListingSnapshot> {
  const row = await db
    .prepare(
      `SELECT item.listing_id,item.material_version,item.input_hash,
              listing.board,listing.material_version current_material_version,
              listing.material_hash current_material_hash,
              listing.material_hash_version current_material_hash_version,
              version.material_hash,version.material_hash_version,
              version.material_json
         FROM public_projection_listing_items item
         JOIN job_listings listing ON listing.id=item.listing_id
         JOIN job_listing_versions version
           ON version.listing_id=item.listing_id
          AND version.material_version=item.material_version
        WHERE item.id=? LIMIT 1`
    )
    .bind(listingItemId)
    .first<ProjectionListingSnapshotRow>();
  if (!row) {
    throw new ProjectionListingSnapshotError(
      "material_snapshot_missing",
      "The pinned listing material snapshot is unavailable"
    );
  }
  if (
    row.material_hash_version !== 1 ||
    row.current_material_hash_version !== 1 ||
    row.material_json === null
  ) {
    throw new ProjectionListingSnapshotError(
      "legacy_material_snapshot",
      "The pinned listing material uses a legacy snapshot contract"
    );
  }
  if (
    row.current_material_version !== row.material_version ||
    row.current_material_hash !== row.material_hash ||
    row.input_hash !== row.material_hash
  ) {
    throw new ProjectionListingSnapshotError(
      "material_snapshot_changed",
      "The listing material no longer matches the projection input snapshot"
    );
  }
  if ((await sha256Hex(row.material_json)) !== row.material_hash) {
    throw new ProjectionListingSnapshotError(
      "material_snapshot_hash_mismatch",
      "The pinned material JSON does not match its stored hash"
    );
  }
  const parsed = ProjectionMaterialSchema.safeParse(
    parseJson(row.material_json)
  );
  if (!parsed.success) {
    throw new ProjectionListingSnapshotError(
      "material_snapshot_schema_mismatch",
      "The pinned material JSON does not match material schema version 1"
    );
  }
  if (parsed.data.id !== row.listing_id || parsed.data.board !== row.board) {
    throw new ProjectionListingSnapshotError(
      "material_snapshot_identity_mismatch",
      "The pinned material identity does not match its listing ID and board"
    );
  }
  return {
    analysisSourceHash: await jobSourceHash(parsed.data),
    board: row.board,
    inputHash: row.input_hash,
    listingId: row.listing_id,
    material: parsed.data,
    materialHash: row.material_hash,
    materialHashVersion: row.material_hash_version,
    materialJson: row.material_json,
    materialVersion: row.material_version,
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
