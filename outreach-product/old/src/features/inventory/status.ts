import { z } from "zod";
import { InventoryBoardSchema } from "./schema";

export const InventoryRefreshStatusSchema = z.enum([
  "queued",
  "claimed",
  "crawling",
  "publishing",
  "completed",
  "failed",
  "canceled",
]);

export const InventoryRefreshSummarySchema = z.object({
  boards: z.array(InventoryBoardSchema),
  claimedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  error: z.string(),
  id: z.string().min(1),
  inventoryRunId: z.string().nullable(),
  mode: z.enum(["full", "latest"]),
  requestedAt: z.string(),
  sourceId: z.string().min(1),
  startedAt: z.string().nullable(),
  status: InventoryRefreshStatusSchema,
  updatedAt: z.string(),
});

export const InventoryRunSummarySchema = z.object({
  closedCount: z.number().int().nonnegative(),
  completedAt: z.string().nullable(),
  error: z.string(),
  failedCount: z.number().int().nonnegative(),
  id: z.string().min(1),
  processedCount: z.number().int().nonnegative(),
  snapshotKey: z.string(),
  sourceActiveCount: z.number().int().nonnegative(),
  sourceClosedCount: z.number().int().nonnegative(),
  sourceId: z.string().min(1),
  sourceTotalCount: z.number().int().nonnegative(),
  startedAt: z.string(),
  status: z.enum([
    "ingesting",
    "reconciling",
    "completed",
    "partial",
    "failed",
    "canceled",
  ]),
  unchangedCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
  upsertedCount: z.number().int().nonnegative(),
});

export const InventorySourceSummarySchema = z.object({
  canOperate: z.boolean(),
  completenessPolicy: z.enum(["append_only", "complete_snapshot"]),
  id: z.string().min(1),
  lastCompletedAt: z.string().nullable(),
  lastError: z.string(),
  lastStartedAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  name: z.string().min(1),
  nextRefreshAt: z.string().nullable(),
  refreshIntervalMinutes: z.number().int().positive().nullable(),
  status: z.enum(["active", "paused"]),
  updatedAt: z.string(),
});

export const InventoryStatusSchema = z.object({
  refreshes: z.array(InventoryRefreshSummarySchema),
  runs: z.array(InventoryRunSummarySchema),
  sources: z.array(InventorySourceSummarySchema),
});

export type InventoryRefreshSummary = z.infer<
  typeof InventoryRefreshSummarySchema
>;
export type InventoryRunSummary = z.infer<typeof InventoryRunSummarySchema>;
export type InventorySourceSummary = z.infer<
  typeof InventorySourceSummarySchema
>;
