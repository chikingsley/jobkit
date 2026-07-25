import { z } from "zod";

export const SealedPrerequisiteCheckpointSchema = z
  .object({
    analyses: z
      .object({
        content: z
          .object({
            payloadHash: z.string().length(64),
            recordFingerprint: z.string().length(64),
          })
          .passthrough(),
        matchFacts: z
          .object({
            payloadHash: z.string().length(64),
            recordFingerprint: z.string().length(64),
          })
          .passthrough(),
        position: z
          .object({
            payloadHash: z.string().length(64),
            recordFingerprint: z.string().length(64),
          })
          .passthrough(),
      })
      .passthrough(),
    materialSnapshot: z
      .object({
        analysisSourceHash: z.string().length(64),
        board: z.string().min(1),
        inputHash: z.string().length(64),
        listingId: z.string().min(1),
        materialHash: z.string().length(64),
        materialHashVersion: z.literal(1),
        materialVersion: z.number().int().positive(),
        state: z.literal("validated"),
      })
      .passthrough(),
    prerequisiteState: z.literal("validated"),
  })
  .passthrough();

export interface ListingCheckpointRow {
  checkpoint_json: string;
}

export const SOURCE_POSITION_EXPANSION_PAGE_SIZE = 20;

export interface SourcePositionExpansionProgress {
  inputDigest: string;
  nextOrdinal: number;
  state: "expanding";
  totalPositions: number;
}
