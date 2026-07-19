import {
  AgentPairingCreateSchema,
  AgentPairingExchangeSchema,
  AgentTaskClaimSchema,
  AgentTaskCompletionSchema,
  AgentTaskFailureSchema,
} from "../../src/features/agents/schema";
import type { AgentRunnerContext, JobKitApp } from "../app-types";
import {
  createAgentRunnerPairing,
  exchangeAgentRunnerPairing,
  listAgentRunners,
  revokeAgentRunner,
  updateAgentRunnerVersion,
} from "../services/agent-runners";
import {
  AgentTaskError,
  claimAgentTask,
  completeAgentTask,
  failAgentTask,
} from "../services/agent-task-broker";

export function registerAgentRunnerRoutes(app: JobKitApp) {
  app.get("/api/agent-runners", async (c) => {
    const runners = await listAgentRunners(c.env.DB, c.get("user").id);
    return c.json({ runners });
  });

  app.post("/api/agent-runner-pairings", async (c) => {
    const { capabilities } = AgentPairingCreateSchema.parse(await c.req.json());
    const pairing = await createAgentRunnerPairing(
      c.env.DB,
      c.get("user").id,
      capabilities
    );
    return c.json({
      message: "Pairing code created",
      ok: true,
      pairing,
    });
  });

  app.post("/api/agent-runner-pairings/exchange", async (c) => {
    const request = AgentPairingExchangeSchema.parse(await c.req.json());
    const runner = await exchangeAgentRunnerPairing(
      c.env.DB,
      request.code,
      request.runnerName,
      request.codexVersion
    );
    if (!runner) {
      return c.json(
        {
          message: "Pairing code is invalid, expired, or already used",
          ok: false,
        },
        401
      );
    }
    return c.json({ message: "Codex agent paired", ok: true, runner });
  });

  app.delete("/api/agent-runners/:runnerId", async (c) => {
    const revoked = await revokeAgentRunner(
      c.env.DB,
      c.get("user").id,
      c.req.param("runnerId")
    );
    if (!revoked) {
      return c.json({ message: "Agent runner was not active", ok: false }, 404);
    }
    return c.json({ message: "Agent runner revoked", ok: true });
  });

  app.post("/api/agent-tasks/claim", async (c) => {
    const runner = requireAgentRunner(c.get("agentRunner"));
    const { runnerVersion } = AgentTaskClaimSchema.parse(await c.req.json());
    await updateAgentRunnerVersion(c.env.DB, runner.id, runnerVersion);
    const task = await claimAgentTask(c.env.DB, runner);
    return c.json({
      message: task
        ? "Agent task claimed"
        : "No compatible agent work is queued",
      ok: true,
      task,
    });
  });

  app.post("/api/agent-tasks/:runId/complete", async (c) => {
    const runner = requireAgentRunner(c.get("agentRunner"));
    const { output } = AgentTaskCompletionSchema.parse(await c.req.json());
    const result = await completeAgentTask(
      c.env.DB,
      runner,
      c.req.param("runId"),
      output
    );
    return c.json({ message: "Agent task completed", ok: true, result });
  });

  app.post("/api/agent-tasks/:runId/fail", async (c) => {
    const runner = requireAgentRunner(c.get("agentRunner"));
    const { error } = AgentTaskFailureSchema.parse(await c.req.json());
    const result = await failAgentTask(
      c.env.DB,
      runner,
      c.req.param("runId"),
      error
    );
    return c.json({ message: "Agent task failed", ok: true, result });
  });
}

function requireAgentRunner(runner: AgentRunnerContext | null) {
  if (!runner) {
    throw new AgentTaskError("Agent runner authentication is required", 401);
  }
  return runner;
}
