import {
  InventoryRunBatchSchema,
  InventoryRunFailureSchema,
  InventoryRunFinishSchema,
  InventoryRunStartSchema,
} from "../../src/features/inventory/schema";
import type { AgentRunnerContext, JobKitApp } from "../app-types";
import { agentRunnerHasCapability } from "../services/agent-runners";
import {
  beginInventoryRun,
  failInventoryRun,
  finishInventoryRun,
  InventoryRunError,
  ingestInventoryBatch,
  listInventoryStatus,
} from "../services/inventory-runs";

export function registerInventoryRoutes(app: JobKitApp) {
  app.get("/api/inventory/status", async (c) =>
    c.json(await listInventoryStatus(c.env.DB))
  );

  app.post("/api/inventory/runs", async (c) => {
    const runner = requireOperationsRunner(c.get("agentRunner"));
    const input = InventoryRunStartSchema.parse(await c.req.json());
    const run = await beginInventoryRun(c.env.DB, runner, input);
    return c.json({ message: "Inventory run ready", ok: true, run }, 202);
  });

  app.post("/api/inventory/runs/:runId/batches", async (c) => {
    const runner = requireOperationsRunner(c.get("agentRunner"));
    const input = InventoryRunBatchSchema.parse(await c.req.json());
    const run = await ingestInventoryBatch(
      c.env.DB,
      runner,
      c.req.param("runId"),
      input
    );
    return c.json({ message: "Inventory batch saved", ok: true, run });
  });

  app.post("/api/inventory/runs/:runId/complete", async (c) => {
    const runner = requireOperationsRunner(c.get("agentRunner"));
    const input = InventoryRunFinishSchema.parse(await c.req.json());
    const run = await finishInventoryRun(
      c.env.DB,
      runner,
      c.req.param("runId"),
      input
    );
    return c.json({ message: "Inventory reconciled", ok: true, run });
  });

  app.post("/api/inventory/runs/:runId/fail", async (c) => {
    const runner = requireOperationsRunner(c.get("agentRunner"));
    const input = InventoryRunFailureSchema.parse(await c.req.json());
    const run = await failInventoryRun(
      c.env.DB,
      runner,
      c.req.param("runId"),
      input
    );
    return c.json({ message: "Inventory run failed", ok: true, run });
  });
}

function requireOperationsRunner(runner: AgentRunnerContext | null) {
  if (!runner) {
    throw new InventoryRunError("Agent runner authentication is required", 403);
  }
  if (!agentRunnerHasCapability(runner, "operations")) {
    throw new InventoryRunError(
      "Paired runner does not have inventory operations capability",
      403
    );
  }
  return runner;
}
