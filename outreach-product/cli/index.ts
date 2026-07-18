import { spawn } from "node:child_process";
import { resolve } from "node:path";

const COMMANDS = new Map<string, string>([
  ["analyze jobs", "analyze-jobs/run.ts"],
  ["analyze positions", "analyze-job-positions/run.ts"],
  ["analyze regroup", "analyze-jobs/regroup.ts"],
  ["drafts generate", "application-drafts/generate-batch.ts"],
  ["economics evaluate", "evaluate-job-economics.ts"],
  ["inventory sync", "job-inventory/sync.ts"],
  ["jobs rank", "job-ranking/rank.ts"],
  ["messages import-exemplars", "message-exemplars/import.ts"],
  ["messages import-foundation", "message-foundations/import.ts"],
  ["sweeps run", "run-country-sweeps.ts"],
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
  analyze jobs                 Extract job requirements and economics
  analyze positions            Extract distinct positions from listings
  analyze regroup              Rebuild job groups from stored analysis
  drafts generate              Generate application drafts in a batch
  economics evaluate           Evaluate source-inventory economics
  inventory sync               Sync the local source inventory into D1
  jobs rank                    Rank jobs for the configured profile
  messages import-exemplars    Import sent-message exemplars
  messages import-foundation   Import the approved message foundation
  sweeps run                   Claim and execute country-sweep tasks`);
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
