import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readBoundedAgentTaskJson } from "../../worker/services/agent-tasks/bounded-json";
import { CountryMaterializationQueueMessageSchema } from "../../worker/services/country-materialization/queue";

const workerSource = readFileSync(
  resolve(import.meta.dir, "../../worker/index.ts"),
  "utf8"
);
const backgroundQueueSource = readFileSync(
  resolve(import.meta.dir, "../../worker/services/background-queue.ts"),
  "utf8"
);
const countryQueueSource = readFileSync(
  resolve(
    import.meta.dir,
    "../../worker/services/country-materialization/queue.ts"
  ),
  "utf8"
);
const wrangler = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../wrangler.jsonc"), "utf8")
) as {
  queues: {
    consumers: Array<{
      max_batch_size: number;
      max_concurrency: number;
      queue: string;
    }>;
    producers: Array<{ binding: string; queue: string }>;
  };
  r2_buckets: Array<{ binding: string; bucket_name: string }>;
};

describe("country materialization execution boundary", () => {
  test("uses one private R2 binding and one-message queue invocation", () => {
    expect(wrangler.r2_buckets).toEqual(
      expect.arrayContaining([
        {
          binding: "SWEEP_OUTPUTS",
          bucket_name: "jobkit-country-sweep-outputs",
        },
      ])
    );
    expect(wrangler.queues.producers).toEqual(
      expect.arrayContaining([
        {
          binding: "COUNTRY_MATERIALIZATION_QUEUE",
          queue: "jobkit-country-materialization",
        },
      ])
    );
    expect(wrangler.queues.consumers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          max_batch_size: 1,
          max_concurrency: 1,
          queue: "jobkit-country-materialization",
        }),
      ])
    );
  });

  test("keeps cron as an outbox wake-up and queue dispatch as the worker", () => {
    expect(workerSource).toContain("publishCountryMaterializationOutbox(env)");
    expect(workerSource).toContain(
      "reapExpiredCountryMaterializationItems(env.DB)"
    );
    expect(workerSource).toContain(
      "cleanupAbandonedCountrySweepOutputObjects(env)"
    );
    expect(workerSource).toContain("consumeJobKitQueue(batch, env)");
    expect(backgroundQueueSource).toContain(
      "consumeCountryMaterializationQueue("
    );
  });

  test("accepts only the compact versioned wake-up schema", () => {
    const message = {
      aggregateId: "output-1",
      kind: "country_sweep_materialization",
      version: 1,
      workItemId: "outbox-1",
    } as const;
    expect(CountryMaterializationQueueMessageSchema.parse(message)).toEqual(
      message
    );
    expect(
      CountryMaterializationQueueMessageSchema.safeParse({
        ...message,
        records: [{ id: "domain-row" }],
      }).success
    ).toBe(false);
  });

  test("passes the immutable work-item identity into the D1 claimant", () => {
    expect(countryQueueSource).toContain("parsed.data.workItemId");
    expect(countryQueueSource).toContain("trim(work_item_id)<>''");
  });

  test("counts fragmented request bytes before parsing JSON", async () => {
    const valid = streamedRequest(['{"records":', "[]}"]);
    await expect(readBoundedAgentTaskJson(valid, 32)).resolves.toEqual({
      records: [],
    });

    const oversized = streamedRequest(["1234", "5678", "9"]);
    await expect(readBoundedAgentTaskJson(oversized, 8)).rejects.toMatchObject({
      message: "Agent task request is too large",
      status: 413,
    });
  });
});

function streamedRequest(chunks: string[]) {
  const encoder = new TextEncoder();
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    headers: new Headers(),
  } as Request;
}
