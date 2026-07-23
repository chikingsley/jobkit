import { z } from "zod";

export const PublicProjectionScopeSchema = z
  .object({
    boards: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
    listingIds: z
      .array(z.string().trim().min(1).max(240))
      .max(1000)
      .default([]),
  })
  .default({ boards: [], listingIds: [] });

export const PublicProjectionRunRequestSchema = z.object({
  mode: z.literal("shadow").default("shadow"),
  scope: PublicProjectionScopeSchema,
});

export type PublicProjectionRunRequest = z.infer<
  typeof PublicProjectionRunRequestSchema
>;

export interface PublicProjectionScope {
  boards: string[];
  listingIds: string[];
}

export const PUBLIC_PROJECTION_CONTRACT_VERSION = 1;
export const PUBLIC_PROJECTOR_VERSION = "shadow-projector-v3";
export const PUBLIC_PROJECTION_SELECTION_PAGE_SIZE = 100;
export const PUBLIC_PROJECTION_ADVANCE_LIMIT = 25;

export function canonicalProjectionScope(
  scope: PublicProjectionScope
): PublicProjectionScope {
  return {
    boards: [...new Set(scope.boards.map((value) => value.trim()))]
      .filter(Boolean)
      .sort(),
    listingIds: [...new Set(scope.listingIds.map((value) => value.trim()))]
      .filter(Boolean)
      .sort(),
  };
}
