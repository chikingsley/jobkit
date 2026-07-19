import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { AgentTaskEnvelopeSchema } from "../../src/features/agents/schema";
import { runStructuredAgent } from "../lib/structured-agent";
import { readAgentConfig } from "./config";

const { values: args } = parseArgs({
  options: { once: { default: false, type: "boolean" } },
});
const config = await readAgentConfig();
const codexVersion = await codexVersionText();

await main();

async function main() {
  do {
    // biome-ignore lint/performance/noAwaitInLoops: Each claim depends on the prior leased task reaching a terminal state.
    const response = await api("/api/agent-tasks/claim", {
      runnerVersion: codexVersion,
    });
    const task = AgentTaskEnvelopeSchema.nullable().parse(response.task);
    if (!task) {
      if (args.once) {
        console.log("No compatible agent work is queued.");
        return;
      }
      await sleep(15_000);
      continue;
    }

    console.log(`Running ${task.taskType} with ${task.model}`);
    try {
      const output = await runStructuredAgent({
        effort: task.reasoningEffort,
        model: task.model,
        outputSchema: task.outputSchema,
        prompt: task.prompt,
        timeoutMs: 900_000,
        webSearch: task.webSearch,
      });
      await api(`/api/agent-tasks/${task.runId}/complete`, {
        output: JSON.parse(output) as unknown,
      });
      console.log(`Completed ${task.taskType}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await api(`/api/agent-tasks/${task.runId}/fail`, {
        error: message.slice(0, 4000),
      });
      console.error(`Failed ${task.taskType}: ${message}`);
    }
  } while (!args.once);
}

async function api(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      `JobKit API ${response.status}: ${JSON.stringify(payload)}`
    );
  }
  return payload as { task?: unknown };
}

function codexVersionText() {
  return new Promise<string>((resolveVersion, reject) => {
    const child = spawn("codex", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolveVersion(stdout.trim());
        return;
      }
      reject(
        new Error(
          `Codex is not installed or could not report its version: ${stderr}`
        )
      );
    });
  });
}

function sleep(milliseconds: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}
