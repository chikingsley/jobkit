import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { AgentTaskEnvelopeSchema } from "../../src/features/agents/schema";
import { runStructuredAgent } from "../lib/structured-agent";
import { createAgentClient } from "./client";
import { readAgentConfig } from "./config";
import { claimAndRunInventoryOperation } from "./inventory-operations";

const { values: args } = parseArgs({
  options: {
    once: { default: false, type: "boolean" },
    "operations-only": { default: false, type: "boolean" },
  },
});
const config = await readAgentConfig();
const client = createAgentClient(config);
const codexVersion = await codexVersionText();

await main();

async function main() {
  do {
    if (!args["operations-only"]) {
      // biome-ignore lint/performance/noAwaitInLoops: Each claim depends on the prior leased task reaching a terminal state.
      const response = await client.post("/api/agent-tasks/claim", {
        runnerVersion: codexVersion,
      });
      const task = AgentTaskEnvelopeSchema.nullable().parse(response.task);
      if (task) {
        await runAgentTask(task);
        if (args.once) {
          return;
        }
        continue;
      }
    }
    if (
      config.capabilities.includes("operations") &&
      (await claimAndRunInventoryOperation(client, config))
    ) {
      if (args.once) {
        return;
      }
      continue;
    }
    if (args.once) {
      console.log("No compatible agent or inventory work is queued.");
      return;
    }
    await sleep(15_000);
  } while (!args.once);
}

async function runAgentTask(
  task: ReturnType<typeof AgentTaskEnvelopeSchema.parse>
) {
  console.log(`Running ${task.taskType} with ${task.model}`);
  try {
    const artifacts = await Promise.all(
      task.artifacts.map(async (artifact) => ({
        bytes: await downloadArtifact(artifact),
        contentType: artifact.contentType,
        filename: artifact.filename,
      }))
    );
    const output = await runStructuredAgent({
      artifacts,
      effort: task.reasoningEffort,
      model: task.model,
      outputSchema: task.outputSchema,
      prompt: task.prompt,
      timeoutMs: 900_000,
      webSearch: task.webSearch,
    });
    await client.post(`/api/agent-tasks/${task.runId}/complete`, {
      output: JSON.parse(output) as unknown,
    });
    console.log(`Completed ${task.taskType}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client.post(`/api/agent-tasks/${task.runId}/fail`, {
      error: message.slice(0, 4000),
    });
    console.error(`Failed ${task.taskType}: ${message}`);
  }
}

async function downloadArtifact(artifact: {
  contentType: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  url: string;
}) {
  const response = await fetch(`${config.baseUrl}${artifact.url}`, {
    headers: { authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `JobKit artifact ${response.status}: ${await response.text()}`
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== artifact.sizeBytes) {
    throw new Error(
      `Artifact size changed for ${artifact.filename}: expected ${artifact.sizeBytes}, received ${bytes.byteLength}`
    );
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== artifact.sha256) {
    throw new Error(`Artifact hash changed for ${artifact.filename}`);
  }
  return bytes;
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
