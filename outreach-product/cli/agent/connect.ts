import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { AgentCapabilitySchema } from "../../src/features/agents/schema";
import { CANONICAL_SITE_ORIGIN } from "../../src/lib/site-origin";
import { agentConfigPath } from "./config";

const { values: args } = parseArgs({
  options: {
    base: {
      default: CANONICAL_SITE_ORIGIN,
      type: "string",
    },
    code: { type: "string" },
    name: { default: `${hostname()} Codex agent`, type: "string" },
  },
});

if (!args.code) {
  throw new Error("--code is required. Create a pairing code in Automation.");
}

const baseUrl = z.url().parse(args.base).replace(/\/$/u, "");
await run("codex", ["login", "status"]);
const codexVersion = (await run("codex", ["--version"])).trim();
const response = await fetch(`${baseUrl}/api/agent-runner-pairings/exchange`, {
  body: JSON.stringify({
    code: args.code,
    codexVersion,
    runnerName: args.name,
  }),
  headers: { "content-type": "application/json" },
  method: "POST",
});
const payload: unknown = await response.json();
if (!response.ok) {
  throw new Error(
    `Pairing failed (${response.status}): ${JSON.stringify(payload)}`
  );
}
const result = z
  .object({
    runner: z.object({
      capabilities: z.array(AgentCapabilitySchema),
      runnerId: z.string().min(1),
      token: z.string().startsWith("jobkit_agent_"),
    }),
  })
  .parse(payload);

await mkdir(dirname(agentConfigPath), { recursive: true });
await writeFile(
  agentConfigPath,
  `${JSON.stringify(
    {
      baseUrl,
      capabilities: result.runner.capabilities,
      runnerId: result.runner.runnerId,
      token: result.runner.token,
    },
    null,
    2
  )}\n`,
  { mode: 0o600 }
);
await chmod(agentConfigPath, 0o600);
console.log(`Paired ${args.name}. Run: bun run jobkit -- agent start`);

function run(executable: string, commandArgs: string[]) {
  return new Promise<string>((resolveRun, reject) => {
    const child = spawn(executable, commandArgs, {
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
        resolveRun(`${stdout}${stderr}`);
        return;
      }
      reject(
        new Error(`${executable} ${commandArgs.join(" ")} failed: ${stderr}`)
      );
    });
  });
}
