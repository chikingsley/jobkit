import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { AgentTaskEnvelopeSchema } from "../../src/features/agents/schema";
import {
  type CountrySweepManifestSnapshot,
  CountrySweepManifestSnapshotSchema,
  canonicalCountrySweepChunkJson,
  createCountrySweepCanonicalChunks,
  INITIAL_COUNTRY_OUTPUT_ROLLING_SHA256,
  sha256Hex,
} from "../../src/features/countries/materialization";
import { CountrySweepTaskOutputSchema } from "../../src/features/countries/schema";
import { runStructuredAgent } from "../lib/structured-agent";
import { createAgentClient } from "./client";
import { readAgentConfig } from "./config";
import {
  type AgentExecutionPhase,
  ArtifactDownloadError,
  classifyAgentTaskFailure,
} from "./failure-classification";
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
    // biome-ignore lint/performance/noAwaitInLoops: Each claim depends on the prior leased task reaching a terminal state.
    const ranWork = await runWorkCycle();
    if (args.once) {
      if (!ranWork) {
        console.log("No compatible agent or inventory work is queued.");
      }
      return;
    }
  } while (!args.once);
}

async function runWorkCycle() {
  const ranWork = await runNextWork();
  if (!(ranWork || args.once)) {
    await sleep(15_000);
  }
  return ranWork;
}

async function runNextWork() {
  if (!args["operations-only"] && (await claimAndRunAgentTask())) {
    return true;
  }
  return (
    config.capabilities.includes("operations") &&
    (await claimAndRunInventoryOperation(client, config))
  );
}

async function claimAndRunAgentTask() {
  const response = await client.post("/api/agent-tasks/claim", {
    runnerVersion: codexVersion,
  });
  const task = AgentTaskEnvelopeSchema.nullable().parse(response.task);
  if (!task) {
    return false;
  }
  await runAgentTask(task);
  return true;
}

async function runAgentTask(
  task: ReturnType<typeof AgentTaskEnvelopeSchema.parse>
) {
  console.log(`Running ${task.taskType} with ${task.model}`);
  let phase: AgentExecutionPhase = "heartbeat";
  let heartbeatError: Error | null = null;
  let heartbeatInFlight: Promise<void> | null = null;
  const heartbeat = () => {
    if (heartbeatInFlight) {
      return heartbeatInFlight;
    }
    heartbeatInFlight = client
      .post(`/api/agent-tasks/${task.runId}/heartbeat`, {
        leaseToken: task.leaseToken,
      })
      .then(() => undefined)
      .catch((error: unknown) => {
        heartbeatError =
          error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => {
        heartbeatInFlight = null;
      });
    return heartbeatInFlight;
  };
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  try {
    await heartbeat();
    if (heartbeatError) {
      throw heartbeatError;
    }
    heartbeatTimer = setInterval(() => void heartbeat(), 5 * 60_000);
    phase = "artifact";
    const artifacts = await Promise.all(
      task.artifacts.map(async (artifact) => ({
        bytes: await downloadArtifact(artifact),
        contentType: artifact.contentType,
        filename: artifact.filename,
      }))
    );
    phase = "execution";
    const output = await runStructuredAgent({
      artifacts,
      effort: task.reasoningEffort,
      model: task.model,
      outputSchema: task.outputSchema,
      prompt: task.prompt,
      timeoutMs: 900_000,
      webSearch: task.webSearch,
    });
    if (heartbeatError) {
      throw heartbeatError;
    }
    phase = "output";
    const parsedOutput = JSON.parse(output) as unknown;
    phase = "completion";
    await completeAgentTask(task, parsedOutput);
    console.log(`Completed ${task.taskType}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await client.post(`/api/agent-tasks/${task.runId}/fail`, {
        error: message.slice(0, 4000),
        errorCode: classifyAgentTaskFailure(error, phase),
        leaseToken: task.leaseToken,
      });
    } catch (failure) {
      console.error(
        `Failure acknowledgement was rejected: ${failure instanceof Error ? failure.message : String(failure)}`
      );
    }
    console.error(`Failed ${task.taskType}: ${message}`);
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    await heartbeatInFlight;
  }
}

async function completeAgentTask(
  task: ReturnType<typeof AgentTaskEnvelopeSchema.parse>,
  parsedOutput: unknown
) {
  if (!task.taskType.startsWith("country_sweep.")) {
    await client.post(`/api/agent-tasks/${task.runId}/complete`, {
      leaseToken: task.leaseToken,
      output: parsedOutput,
    });
    return;
  }
  const output = CountrySweepTaskOutputSchema.parse(parsedOutput);
  let manifest: CountrySweepManifestSnapshot = {
    chunkCount: 0,
    contactCount: 0,
    organizationCount: 0,
    rollingSha256: INITIAL_COUNTRY_OUTPUT_ROLLING_SHA256,
    scopeCount: 0,
    totalBytes: 0,
  };
  const chunks = createCountrySweepCanonicalChunks(output);
  for (let ordinal = 0; ordinal < chunks.length; ordinal += 1) {
    const chunk = chunks[ordinal];
    if (!chunk) {
      continue;
    }
    const canonicalJson = canonicalCountrySweepChunkJson(chunk);
    const bytes = new TextEncoder().encode(canonicalJson);
    // biome-ignore lint/performance/noAwaitInLoops: Chunk ordinals and the rolling manifest hash are strictly sequential.
    const response = await client.post(
      `/api/agent-tasks/${task.runId}/chunks`,
      {
        byteLength: bytes.byteLength,
        chunk,
        leaseToken: task.leaseToken,
        ordinal,
        recordCount: chunk.records.length,
        sha256: await sha256Hex(bytes),
      }
    );
    const { result } = response;
    if (!result || typeof result !== "object") {
      throw new Error("Country output chunk response omitted its manifest");
    }
    manifest = CountrySweepManifestSnapshotSchema.parse(
      Reflect.get(result, "manifest")
    );
  }
  await client.post(`/api/agent-tasks/${task.runId}/complete`, {
    leaseToken: task.leaseToken,
    output: {
      coverageSummary: output.coverageSummary,
      manifest,
      notes: output.notes,
    },
  });
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
    throw new ArtifactDownloadError(
      `JobKit artifact ${response.status}: ${await response.text()}`,
      response.status
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
