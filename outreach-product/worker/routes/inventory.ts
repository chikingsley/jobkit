import {
  InventoryOperationCompletionSchema,
  InventoryOperationHeartbeatSchema,
  InventoryRefreshRequestSchema,
  InventoryRunBatchSchema,
  InventoryRunFailureSchema,
  InventoryRunFinishSchema,
  InventoryRunStartSchema,
  InventorySourceScheduleSchema,
} from "../../src/features/inventory/schema";
import { InventoryRunError } from "../../src/pipeline/01_ingest/contracts";
import {
  beginInventoryRun,
  ingestInventoryBatch,
} from "../../src/pipeline/01_ingest/run-ingestion";
import {
  failInventoryRun,
  finishInventoryRun,
} from "../../src/pipeline/01_ingest/run-reconciliation";
import { listInventoryStatus } from "../../src/pipeline/01_ingest/status";
import type { AgentRunnerContext, JobKitApp } from "../app-types";
import { agentRunnerHasCapability } from "../services/agent-runners";
import {
  claimInventoryOperation,
  completeInventoryOperation,
  failInventoryOperation,
  heartbeatInventoryOperation,
  requestInventoryRefresh,
  updateInventorySourceSchedule,
} from "../services/inventory-refreshes";

export function registerInventoryRoutes(app: JobKitApp) {
  app.get("/api/inventory/status", async (c) =>
    c.json(await listInventoryStatus(c.env.DB, c.get("user").id))
  );

  app.post("/api/inventory/refreshes", async (c) => {
    requireOperatorRole(c.get("user").role);
    const input = InventoryRefreshRequestSchema.parse(await c.req.json());
    const refresh = await requestInventoryRefresh(
      c.env.DB,
      c.get("user").id,
      input
    );
    return c.json(
      { message: "Inventory refresh queued", ok: true, refresh },
      202
    );
  });

  app.put("/api/inventory/sources/:sourceId/schedule", async (c) => {
    requireOperatorRole(c.get("user").role);
    const input = InventorySourceScheduleSchema.parse(await c.req.json());
    const schedule = await updateInventorySourceSchedule(
      c.env.DB,
      c.get("user").id,
      c.req.param("sourceId"),
      input
    );
    return c.json({ message: "Inventory schedule saved", ok: true, schedule });
  });

  app.post("/api/inventory/operations/claim", async (c) => {
    const runner = requireOperationsRunner(c.get("agentRunner"));
    return c.json({
      operation: await claimInventoryOperation(c.env.DB, runner),
    });
  });

  app.post("/api/inventory/operations/:operationId/heartbeat", async (c) => {
    const runner = requireOperationsRunner(c.get("agentRunner"));
    const input = InventoryOperationHeartbeatSchema.parse(await c.req.json());
    const operation = await heartbeatInventoryOperation(
      c.env.DB,
      runner,
      c.req.param("operationId"),
      input.status
    );
    return c.json({
      message: "Inventory operation lease renewed",
      ok: true,
      operation,
    });
  });

  app.post("/api/inventory/operations/:operationId/complete", async (c) => {
    const runner = requireOperationsRunner(c.get("agentRunner"));
    const input = InventoryOperationCompletionSchema.parse(await c.req.json());
    const operation = await completeInventoryOperation(
      c.env.DB,
      runner,
      c.req.param("operationId"),
      input
    );
    return c.json({
      message: "Inventory operation completed",
      ok: true,
      operation,
    });
  });

  app.post("/api/inventory/operations/:operationId/fail", async (c) => {
    const runner = requireOperationsRunner(c.get("agentRunner"));
    const input = InventoryRunFailureSchema.parse(await c.req.json());
    const operation = await failInventoryOperation(
      c.env.DB,
      runner,
      c.req.param("operationId"),
      input
    );
    return c.json({
      message: "Inventory operation failed",
      ok: true,
      operation,
    });
  });

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

function requireOperatorRole(role: "member" | "operator") {
  if (role !== "operator") {
    throw new InventoryRunError(
      "Operator access is required for inventory mutations",
      403
    );
  }
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
