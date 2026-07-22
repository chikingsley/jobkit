import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workerSource = readFileSync(
  resolve(import.meta.dir, "../../worker/index.ts"),
  "utf8"
);
const queueSource = readFileSync(
  resolve(import.meta.dir, "../../worker/services/public-projection/queue.ts"),
  "utf8"
);
const maintenanceQueueSource = readFileSync(
  resolve(
    import.meta.dir,
    "../../worker/services/agent-task-maintenance-queue.ts"
  ),
  "utf8"
);
const serverSource = readFileSync(
  resolve(import.meta.dir, "../../src/server.ts"),
  "utf8"
);
const wrangler = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../wrangler.jsonc"), "utf8")
) as {
  main: string;
  queues: {
    consumers: Array<{
      max_batch_size: number;
      max_concurrency: number;
      queue: string;
    }>;
    producers: Array<{ binding: string; queue: string }>;
  };
};

describe("public projection execution boundary", () => {
  test("the shared cron emits a wake-up while a queue invocation advances D1", () => {
    expect(workerSource).toContain("queuePublicProjectionAdvance(env)");
    expect(workerSource).toContain("consumeJobKitQueue(batch, env)");
    expect(workerSource).not.toContain("advancePublicProjectionRuns(env.DB)");
    expect(queueSource).toContain("advancePublicProjectionRuns(env.DB, {");
    expect(queueSource).toContain("createMapboxPermanentLocationResolver(");
    expect(queueSource).toContain("env.MAPBOX_ACCESS_TOKEN");
    expect(wrangler.main).toBe("src/server.ts");
    expect(serverSource).toContain(
      "runQueue: (batch, env) => worker.queue(batch, env)"
    );
  });

  test("the projection queue gives each message a single invocation", () => {
    expect(wrangler.queues.producers).toEqual(
      expect.arrayContaining([
        {
          binding: "AGENT_MAINTENANCE_QUEUE",
          queue: "jobkit-agent-maintenance",
        },
        {
          binding: "PUBLIC_PROJECTION_QUEUE",
          queue: "jobkit-public-projection",
        },
      ])
    );
    expect(wrangler.queues.consumers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          max_batch_size: 1,
          max_concurrency: 1,
          queue: "jobkit-agent-maintenance",
        }),
        expect.objectContaining({
          max_batch_size: 1,
          max_concurrency: 1,
          queue: "jobkit-public-projection",
        }),
      ])
    );
  });

  test("agent lease cleanup owns a separate one-message queue budget", () => {
    expect(workerSource).toContain("queueAgentTaskMaintenance(env)");
    expect(workerSource).not.toContain("reapAgentTasks(env)");
    expect(maintenanceQueueSource).toContain("reapAgentTasks(env)");
    expect(maintenanceQueueSource).toContain("result.selected > 0");
  });
});
