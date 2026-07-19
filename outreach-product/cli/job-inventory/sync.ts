import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  inventoryJobContentHash,
  sha256,
} from "../../src/features/inventory/content";
import { InventoryJobSchema } from "../../src/features/inventory/schema";
import { readAgentConfig } from "../agent/config";
import { readSourceInventory } from "./source";

const TRAILING_SLASH_PATTERN = /\/$/u;

const { values: args } = parseArgs({
  options: {
    apply: { default: false, type: "boolean" },
    "batch-size": { default: "50", type: "string" },
    source: { type: "string" },
  },
});

const batchSize = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .parse(args["batch-size"]);
const sourcePath = args.source
  ? resolve(args.source)
  : resolve(import.meta.dir, "../../../job-search/job-data/jobs.sqlite");
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

if (!args.apply) {
  console.log(
    JSON.stringify({
      active: inventory.active,
      batchCount: Math.ceil(jobs.length / batchSize),
      batchSize,
      closed: inventory.closed,
      economics,
      mode: "dry-run",
      snapshotKey,
      total: inventory.total,
    })
  );
  process.exit(0);
}

const config = await readAgentConfig();
const client = inventoryClient(config.baseUrl, config.token);
const start = await client.post("/api/inventory/runs", {
  snapshotKey,
  sourceActiveCount: inventory.active,
  sourceClosedCount: inventory.closed,
  sourceId: "job-search-sqlite",
  sourceName: "Job search source inventory",
  sourceTotalCount: inventory.total,
});
const { run } = z
  .object({ run: z.object({ id: z.string().min(1) }) })
  .parse(start);
const batches = chunk(jobs, batchSize);
const batchRequests = await Promise.all(
  batches.map(async (batch, ordinal) => ({
    batch,
    batchKey: await sha256(
      JSON.stringify(
        contentHashes.slice(
          ordinal * batchSize,
          ordinal * batchSize + batch.length
        )
      )
    ),
    ordinal,
  }))
);
for (const { batch, batchKey, ordinal } of batchRequests) {
  // biome-ignore lint/performance/noAwaitInLoops: Hosted inventory batches are ordered checkpoints and the next batch must wait for durable acknowledgement.
  const response = await client.post(`/api/inventory/runs/${run.id}/batches`, {
    batchKey,
    jobs: batch,
    ordinal,
  });
  const progress = z
    .object({
      run: z.object({
        failedCount: z.number(),
        processedCount: z.number(),
        unchangedCount: z.number(),
        upsertedCount: z.number(),
      }),
    })
    .parse(response).run;
  console.log(
    JSON.stringify({
      batch: ordinal + 1,
      batches: batches.length,
      ...progress,
    })
  );
}
const completed = await client.post(`/api/inventory/runs/${run.id}/complete`, {
  expectedBatchCount: batches.length,
});
console.log(JSON.stringify({ economics, result: completed, snapshotKey }));

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
