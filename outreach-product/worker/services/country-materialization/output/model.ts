import type { z } from "zod";
import type {
  CountrySweepCanonicalChunkSchema,
  CountrySweepChunkKind,
} from "../../../../src/features/countries/materialization";

export const MATERIALIZATION_TOPIC = "country_sweep_materialization";

export interface UploadingOutputRow {
  chunk_count: number;
  contact_count: number;
  last_chunk_kind: CountrySweepChunkKind | null;
  next_chunk_ordinal: number;
  organization_count: number;
  output_id: string;
  rolling_sha256: string;
  scope_count: number;
  total_bytes: number;
}

export interface CountrySweepChunkUploadInput {
  byteLength: number;
  chunk: z.infer<typeof CountrySweepCanonicalChunkSchema>;
  ordinal: number;
  recordCount: number;
  sha256: string;
}
