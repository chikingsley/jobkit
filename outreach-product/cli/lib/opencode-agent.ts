import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareArtifactImages } from "./agent-artifacts";
import { captureProcess, filteredEnvironment } from "./agent-process";
import type { StructuredAgentOptions } from "./structured-agent";

// A denied tool call makes `opencode run` exit 2 even when the final
// assistant message is complete, so exit 2 with usable text is accepted.
const ACCEPTED_EXIT_CODES = new Set([0, 2]);

export async function runOpencodeStructuredAgent(
  options: StructuredAgentOptions
) {
  const directory = await mkdtemp(join(tmpdir(), "jobkit-opencode-task-"));
  try {
    const imagePaths = await prepareArtifactImages(
      directory,
      options.artifacts ?? []
    );
    const command = [
      "run",
      "--pure",
      "--dir",
      directory,
      "--model",
      options.model,
      "--format",
      "json",
      "--title",
      "jobkit-agent-task",
    ];
    for (const imagePath of imagePaths) {
      command.push("--file", imagePath);
    }
    command.push(opencodeStructuredPrompt(options));
    const result = await captureProcess("opencode", command, {
      cwd: directory,
      env: opencodeEnvironment(options.webSearch),
      timeoutMs: options.timeoutMs,
    });
    const text = finalAssistantText(result.stdout);
    if (!(text && ACCEPTED_EXIT_CODES.has(result.code ?? -1))) {
      throw new Error(
        `opencode exited ${result.code} without a final message: ${result.stderr.slice(-1000) || "no stderr"}`
      );
    }
    return extractJsonObjectText(text);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export function opencodeStructuredPrompt(options: {
  outputSchema: object;
  prompt: string;
}) {
  return `${options.prompt}

Respond with exactly one JSON object that validates against the JSON Schema inside <output-schema>. Output only the JSON object itself: no markdown fences, no commentary, no additional text.

<output-schema>
${JSON.stringify(options.outputSchema)}
</output-schema>`;
}

export function finalAssistantText(stdout: string) {
  const textsByMessage = new Map<string, string[]>();
  let lastMessageId = "";
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    const event = parseEvent(trimmed);
    if (!event) {
      continue;
    }
    const texts = textsByMessage.get(event.messageId) ?? [];
    texts.push(event.text);
    textsByMessage.set(event.messageId, texts);
    lastMessageId = event.messageId;
  }
  return (textsByMessage.get(lastMessageId) ?? []).join("").trim();
}

function parseEvent(line: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!(parsed && typeof parsed === "object")) {
    return null;
  }
  if (Reflect.get(parsed, "type") !== "text") {
    return null;
  }
  const part = Reflect.get(parsed, "part");
  if (!(part && typeof part === "object")) {
    return null;
  }
  const text = Reflect.get(part, "text");
  const messageId = Reflect.get(part, "messageID");
  if (typeof text !== "string" || typeof messageId !== "string") {
    return null;
  }
  return { messageId, text };
}

const LEADING_FENCE_PATTERN = /^\s*```(?:json)?/u;
const TRAILING_FENCE_PATTERN = /```\s*$/u;

export function extractJsonObjectText(text: string) {
  const withoutFences = text
    .replace(LEADING_FENCE_PATTERN, "")
    .replace(TRAILING_FENCE_PATTERN, "");
  const start = withoutFences.indexOf("{");
  const end = withoutFences.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("opencode reply contained no JSON object");
  }
  return withoutFences.slice(start, end + 1);
}

function opencodeEnvironment(webSearch: "disabled" | "live") {
  const environment = filteredEnvironment({ allowedPrefixes: ["OPENCODE_"] });
  environment.OPENCODE_PERMISSION = JSON.stringify(
    webSearch === "live" ? { "*": "deny", webfetch: "allow" } : { "*": "deny" }
  );
  return environment;
}
