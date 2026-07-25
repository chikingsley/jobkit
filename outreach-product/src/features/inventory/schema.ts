import { z } from "zod";
import { JobMarketSegmentSchema } from "../organizations/market-segments";

export const InventoryMarketSegmentSchema = JobMarketSegmentSchema;

export const InventorySourceDateEvidenceSchema = z.discriminatedUnion(
  "provenance",
  [
    z
      .object({
        date: z.iso.date(),
        provenance: z.literal("board-published"),
        raw: z.string().trim().min(1).max(500),
      })
      .strict(),
    z
      .object({
        date: z.null(),
        provenance: z.literal("unresolved"),
        raw: z.string().trim().min(1).max(500),
      })
      .strict(),
    z
      .object({
        date: z.null(),
        provenance: z.literal("unknown"),
        raw: z.literal(""),
      })
      .strict(),
  ]
);

const UNKNOWN_SOURCE_DATE = {
  date: null,
  provenance: "unknown",
  raw: "",
} as const;

export const InventorySourceDatesSchema = z
  .object({
    expires: InventorySourceDateEvidenceSchema.default(UNKNOWN_SOURCE_DATE),
    posted: InventorySourceDateEvidenceSchema.default(UNKNOWN_SOURCE_DATE),
  })
  .strict()
  .default({
    expires: UNKNOWN_SOURCE_DATE,
    posted: UNKNOWN_SOURCE_DATE,
  });

export const InventoryCompensationSchema = z
  .object({
    amountMaximum: z.number().nonnegative().nullable(),
    amountMinimum: z.number().nonnegative().nullable(),
    confidence: z.enum(["exact", "inferred", "unknown"]),
    currency: z.string().length(3).nullable(),
    display: z.string().max(500),
    period: z.enum(["hour", "month", "year"]).nullable(),
    qualifier: z.enum(["exact", "from", "range", "up-to"]).nullable(),
  })
  .strict();

export const InventoryJobSchema = z
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
    fields: z.record(z.string().max(160), z.string().max(4000)).optional(),
    id: z.string().min(1).max(500),
    lastSeenAt: z.iso.datetime(),
    location: z.string().max(300),
    marketSegments: z.array(InventoryMarketSegmentSchema).max(8),
    salary: z.string().max(1000),
    sourceDates: InventorySourceDatesSchema,
    sourceReference: z.string().max(500),
    sourceUrl: z.union([z.literal(""), z.url()]),
    title: z.string().min(1).max(1000),
  })
  .strict();

export const InventoryRunStartSchema = z
  .object({
    operationId: z.string().min(1).optional(),
    snapshotKey: z.string().min(1).max(128),
    sourceActiveCount: z.number().int().nonnegative(),
    sourceClosedCount: z.number().int().nonnegative(),
    sourceId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/u),
    sourceName: z.string().min(1).max(160),
    sourceTotalCount: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (value) =>
      value.sourceActiveCount + value.sourceClosedCount ===
      value.sourceTotalCount,
    { message: "Active and closed source counts must equal the total" }
  );

export const InventoryRunBatchSchema = z
  .object({
    batchKey: z.string().min(1).max(128),
    jobs: z.array(InventoryJobSchema).min(1).max(100),
    ordinal: z.number().int().nonnegative(),
  })
  .strict();

export const InventoryRunFinishSchema = z
  .object({ expectedBatchCount: z.number().int().nonnegative() })
  .strict();

export const InventoryRunFailureSchema = z
  .object({ error: z.string().trim().min(1).max(4000) })
  .strict();

export const InventoryBoardSchema = z.enum([
  "ajarn",
  "anesl",
  "eslcafe-modern",
  "seriousteachers",
  "tefl",
]);

export const InventoryRefreshRequestSchema = z
  .object({
    boards: z
      .array(InventoryBoardSchema)
      .max(InventoryBoardSchema.options.length),
    mode: z.enum(["latest", "full"]),
    sourceId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/u),
  })
  .strict();

export const InventorySourceScheduleSchema = z
  .object({ refreshIntervalMinutes: z.number().int().positive().nullable() })
  .strict();

export const InventoryOperationEnvelopeSchema = z
  .object({
    boards: z.array(InventoryBoardSchema),
    id: z.string().min(1),
    leaseExpiresAt: z.iso.datetime(),
    mode: z.enum(["latest", "full"]),
    sourceId: z.string().min(1),
    type: z.literal("inventory.refresh"),
  })
  .strict();

export const InventoryOperationCompletionSchema = z
  .object({ inventoryRunId: z.string().min(1) })
  .strict();

export const InventoryOperationHeartbeatSchema = z
  .object({ status: z.enum(["crawling", "publishing"]) })
  .strict();

export type InventoryJob = z.infer<typeof InventoryJobSchema>;
export type InventoryOperationEnvelope = z.infer<
  typeof InventoryOperationEnvelopeSchema
>;
