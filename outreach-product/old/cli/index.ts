import { spawn } from "node:child_process";
import { resolve } from "node:path";

const COMMANDS = new Map<string, string>([
  ["agent connect", "agent/connect.ts"],
  ["agent start", "agent/start.ts"],
  ["experiments onboarding", "../experiments/onboarding/index.ts"],
  ["experiments analysis", "../experiments/job-analysis/index.ts"],
  ["experiments preview", "../experiments/job-analysis/seed-local-preview.ts"],
  ["experiments jina", "../experiments/jina/index.ts"],
  ["inventory sync", "job-inventory/sync.ts"],
]);

const args = process.argv.slice(2);
const command = args.slice(0, 2).join(" ");
const commandPath = COMMANDS.get(command);

if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
  printHelp();
} else if (commandPath) {
  const exitCode = await runCommand(commandPath, args.slice(2));
  process.exitCode = exitCode;
} else {
  printHelp(command);
}

function printHelp(unknownCommand?: string) {
  if (unknownCommand) {
    console.error(`Unknown JobKit command: ${unknownCommand}`);
  }
  console.log(`JobKit operations CLI

Usage:
  bun run jobkit -- <group> <command> [options]

Commands:
  agent connect                Pair this checkout with JobKit using Codex login
  agent start                  Claim and execute queued Codex tasks
  experiments onboarding      Evaluate profile import and onboarding behavior
  experiments analysis        Compare Codex models on real job analysis
  experiments preview         Seed real analyzed listings into local D1
  experiments jina             Run Jina experiments and corpus labeling
  inventory sync               Sync the local source inventory into D1`);
  if (unknownCommand) {
    process.exitCode = 1;
  }
}

function runCommand(relativePath: string, commandArgs: string[]) {
  return new Promise<number>((resolveExit, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(import.meta.dir, relativePath), ...commandArgs],
      {
        cwd: resolve(import.meta.dir, ".."),
        env: process.env,
        stdio: "inherit",
      }
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        console.error(`JobKit command stopped by ${signal}`);
        resolveExit(1);
        return;
      }
      resolveExit(code ?? 1);
    });
  });
}
