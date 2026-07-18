import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type StructuredAgentProvider = "codex" | "opencode";

export interface StructuredAgentOptions {
  cwd: string;
  effort: string;
  model: string;
  outputSchema: object;
  prompt: string;
  provider: StructuredAgentProvider;
  timeoutMs: number;
  variant: string;
}

export function runStructuredAgent(options: StructuredAgentOptions) {
  if (options.provider === "codex") {
    return runCodex(options);
  }
  return runOpencode(options);
}

function runOpencode(options: StructuredAgentOptions): Promise<string> {
  return capture(
    "opencode",
    [
      "run",
      "--pure",
      "--agent",
      "jobkit-extractor",
      "--model",
      options.model,
      ...(options.variant ? ["--variant", options.variant] : []),
      options.prompt,
    ],
    {
      cwd: options.cwd,
      input: null,
      timeoutMs: options.timeoutMs,
    }
  );
}

async function runCodex(options: StructuredAgentOptions): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "jobkit-codex-"));
  const schemaPath = join(directory, "schema.json");
  const outputPath = join(directory, "output.json");
  try {
    await writeFile(
      schemaPath,
      `${JSON.stringify(options.outputSchema, null, 2)}\n`
    );
    await capture(
      "codex",
      [
        "exec",
        "--ephemeral",
        "--color",
        "never",
        "--sandbox",
        "read-only",
        "--cd",
        options.cwd,
        "--model",
        options.model,
        "--config",
        `model_reasoning_effort=${JSON.stringify(options.effort)}`,
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "-",
      ],
      {
        cwd: options.cwd,
        input: options.prompt,
        timeoutMs: options.timeoutMs,
      }
    );
    return await readFile(outputPath, "utf8");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function capture(
  executable: string,
  args: string[],
  options: { cwd: string; input: string | null; timeoutMs: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      stdio: [options.input === null ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (!(child.stdout && child.stderr)) {
      reject(new Error(`${executable} did not expose output streams`));
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `${executable} timed out after ${Math.round(options.timeoutMs / 1000)} seconds`
        )
      );
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `${executable} exited ${code}: ${stderr.slice(-1000) || "no stderr"}`
        )
      );
    });
    if (options.input !== null) {
      if (!child.stdin) {
        reject(new Error(`${executable} did not expose an input stream`));
        return;
      }
      child.stdin.end(options.input);
    }
  });
}
