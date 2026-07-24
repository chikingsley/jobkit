import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareArtifactImages,
  type StructuredAgentArtifact,
} from "./agent-artifacts";
import { captureProcess, filteredEnvironment } from "./agent-process";

export type { StructuredAgentArtifact } from "./agent-artifacts";

export interface StructuredAgentOptions {
  artifacts?: StructuredAgentArtifact[];
  effort: "high" | "low" | "medium" | "xhigh";
  model: string;
  outputSchema: object;
  prompt: string;
  timeoutMs: number;
  webSearch: "disabled" | "live";
}

export async function runStructuredAgent(options: StructuredAgentOptions) {
  const directory = await mkdtemp(join(tmpdir(), "jobkit-codex-task-"));
  const schemaPath = join(directory, "schema.json");
  const outputPath = join(directory, "output.json");
  try {
    await writeFile(
      schemaPath,
      `${JSON.stringify(options.outputSchema, null, 2)}\n`
    );
    const imagePaths = await prepareArtifactImages(
      directory,
      options.artifacts ?? []
    );
    const command = [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--sandbox",
      "read-only",
      "--cd",
      directory,
      "--model",
      options.model,
      "--config",
      'approval_policy="never"',
      "--config",
      `model_reasoning_effort=${JSON.stringify(options.effort)}`,
      "--config",
      `web_search=${JSON.stringify(options.webSearch)}`,
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
    ];
    for (const imagePath of imagePaths) {
      command.push("--image", imagePath);
    }
    command.push("-");
    const result = await captureProcess("codex", command, {
      cwd: directory,
      env: filteredEnvironment({ allowedKeys: ["CODEX_HOME"] }),
      input: options.prompt,
      timeoutMs: options.timeoutMs,
    });
    if (result.code !== 0) {
      throw new Error(
        `codex exited ${result.code}: ${result.stderr.slice(-1000) || "no stderr"}`
      );
    }
    return await readFile(outputPath, "utf8");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
