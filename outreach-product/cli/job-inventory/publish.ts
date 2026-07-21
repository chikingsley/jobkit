import { z } from "zod";
import {
  inventoryJobContentHash,
  sha256,
} from "../../src/features/inventory/content";
import {
  type InventoryJob,
  InventoryJobSchema,
} from "../../src/features/inventory/schema";
import type { AgentConfig } from "../agent/config";
import { readSourceInventory } from "./source";

const TRAILING_SLASH_PATTERN = /\/$/u;
const InventoryRunIdResponseSchema = z.object({
  run: z.object({ id: z.string().min(1) }),
});
const InventoryRunProgressResponseSchema = z.object({
  run: z.object({
    failedCount: z.number(),
    processedCount: z.number(),
    unchangedCount: z.number(),
    upsertedCount: z.number(),
  }),
});

export interface InventorySnapshot {
  active: number;
  closed: number;
  economics: {
    hourly: number;
    monthly: number;
    structured: number;
  };
  jobs: InventoryJob[];
  snapshotKey: string;
  total: number;
}

interface PublishInventorySnapshotInput {
  batchSize: number;
  batchWorkers?: number;
  config: AgentConfig;
  onProgress?: (progress: InventoryPublishProgress) => void | Promise<void>;
  operationId?: string;
  snapshot: InventorySnapshot;
  sourceId: string;
  sourceName: string;
}

export interface InventoryPublishProgress {
  batch: number;
  batches: number;
  failedCount: number;
  processedCount: number;
  unchangedCount: number;
  upsertedCount: number;
}

export async function prepareInventorySnapshot(sourcePath: string) {
  const inventory = readSourceInventory(sourcePath);
  const jobs = inventory.jobs.map((job) => InventoryJobSchema.parse(job));
  if (jobs.length !== inventory.active) {
    throw new Error(
      `Source reported ${inventory.active} active jobs but returned ${jobs.length}`
    );
  }
  const economics = {
    hourly: jobs.filter((job) => job.compensation.period === "hour").length,
    monthly: jobs.filter((job) => job.compensation.period === "month").length,
    structured: jobs.filter(
      (job) =>
        job.compensation.amountMinimum !== null ||
        job.compensation.amountMaximum !== null
    ).length,
  };
  const contentHashes = await Promise.all(
    jobs.map(async (job) => ({
      hash: await inventoryJobContentHash(job),
      id: job.id,
    }))
  );
  const snapshotKey = await sha256(
    JSON.stringify({
      active: inventory.active,
      closed: inventory.closed,
      jobs: contentHashes,
      total: inventory.total,
    })
  );
  return {
    active: inventory.active,
    closed: inventory.closed,
    economics,
    jobs,
    snapshotKey,
    total: inventory.total,
  } satisfies InventorySnapshot;
}

export async function publishInventorySnapshot(
  input: PublishInventorySnapshotInput
) {
  const batchSize = z.number().int().min(1).max(100).parse(input.batchSize);
  const batchWorkers = z
    .number()
    .int()
    .min(1)
    .parse(input.batchWorkers ?? 1);
  const client = inventoryClient(input.config.baseUrl, input.config.token);
  const start = await client.post("/api/inventory/runs", {
    ...(input.operationId ? { operationId: input.operationId } : {}),
    snapshotKey: input.snapshot.snapshotKey,
    sourceActiveCount: input.snapshot.active,
    sourceClosedCount: input.snapshot.closed,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    sourceTotalCount: input.snapshot.total,
  });
  const { run } = InventoryRunIdResponseSchema.parse(start);
  try {
    const batches = chunk(input.snapshot.jobs, batchSize);
    const batchRequests = await Promise.all(
      batches.map(async (batch, ordinal) => ({
        batch,
        batchKey: await sha256(
          JSON.stringify(
            await Promise.all(
              batch.map(async (job) => ({
                hash: await inventoryJobContentHash(job),
                id: job.id,
              }))
            )
          )
        ),
        ordinal,
      }))
    );
    await runBatchWorkers(batchRequests, batchWorkers, async (request) => {
      const response = await client.post(
        `/api/inventory/runs/${run.id}/batches`,
        {
          batchKey: request.batchKey,
          jobs: request.batch,
          ordinal: request.ordinal,
        }
      );
      const progress = InventoryRunProgressResponseSchema.parse(response).run;
      if (input.onProgress) {
        await input.onProgress({
          batch: request.ordinal + 1,
          batches: batches.length,
          ...progress,
        });
      }
    });
    const completed = await client.post(
      `/api/inventory/runs/${run.id}/complete`,
      { expectedBatchCount: batches.length }
    );
    return {
      inventoryRunId: run.id,
      result: completed,
      snapshotKey: input.snapshot.snapshotKey,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await client.post(`/api/inventory/runs/${run.id}/fail`, {
        error: message.slice(0, 4000),
      });
    } catch {
      // Preserve the publishing error; the hosted run may already be terminal.
    }
    throw error;
  }
}

async function runBatchWorkers<Value>(
  values: Value[],
  workerCount: number,
  run: (value: Value) => Promise<void>
) {
  let cursor = 0;
  let firstError: unknown;
  const worker = async (): Promise<void> => {
    if (firstError !== undefined) {
      return;
    }
    const index = cursor;
    cursor += 1;
    const value = values[index];
    if (value === undefined) {
      return;
    }
    try {
      await run(value);
      await worker();
    } catch (error) {
      firstError = error;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(workerCount, values.length) }, worker)
  );
  if (firstError !== undefined) {
    throw firstError;
  }
}

function chunk<Value>(values: Value[], size: number) {
  const chunks: Value[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function inventoryClient(baseUrl: string, token: string) {
  return {
    async post(path: string, body: unknown) {
      const response = await fetch(
        `${baseUrl.replace(TRAILING_SLASH_PATTERN, "")}${path}`,
        {
          body: JSON.stringify(body),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          method: "POST",
        }
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = z.object({ message: z.string() }).safeParse(payload);
        throw new Error(
          `Inventory request failed (${response.status}): ${message.success ? message.data.message : "Unexpected response"}`
        );
      }
      return payload;
    },
  };
}
