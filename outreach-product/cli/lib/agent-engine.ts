import { captureProcess } from "./agent-process";
import {
  resolveLocalDefaultModel,
  runLocalStructuredAgent,
} from "./local-agent";
import { runOpencodeStructuredAgent } from "./opencode-agent";
import {
  runStructuredAgent,
  type StructuredAgentOptions,
} from "./structured-agent";

export type AgentEngine = "codex" | "local" | "opencode";

export const DEFAULT_OPENCODE_MODEL = "opencode-go/deepseek-v4-flash";
const COUNTRY_SWEEP_OPENCODE_MODEL = "opencode-go/glm-5.2";

export const DEFAULT_OPENCODE_MODELS: Record<string, string> = {
  "application.message": "opencode-go/glm-5.2",
  "job.content_analysis": "opencode-go/deepseek-v4-flash",
  "job.match_facts": "opencode-go/deepseek-v4-flash",
  "job.position_analysis": "opencode-go/deepseek-v4-flash",
  "profile.import": "opencode-go/glm-5.2",
  "test_lab.document_ocr": "opencode-go/glm-5.2",
  "test_lab.evaluate": "opencode-go/deepseek-v4-flash",
};

export function resolveAgentEngine(
  env: Record<string, string | undefined> = process.env
): AgentEngine {
  const value = (env.JOBKIT_AGENT_ENGINE ?? "codex").trim().toLowerCase();
  if (value === "codex" || value === "opencode" || value === "local") {
    return value;
  }
  throw new Error(
    `JOBKIT_AGENT_ENGINE must be "codex", "opencode", or "local", received ${JSON.stringify(value)}`
  );
}

export function resolveOpencodeModel(
  taskType: string,
  env: Record<string, string | undefined> = process.env
) {
  const override = modelOverrideFor(
    taskType,
    env.JOBKIT_OPENCODE_MODELS,
    "JOBKIT_OPENCODE_MODELS"
  );
  if (override) {
    return override;
  }
  if (taskType.startsWith("country_sweep.")) {
    return COUNTRY_SWEEP_OPENCODE_MODEL;
  }
  return (
    DEFAULT_OPENCODE_MODELS[taskType] ??
    env.JOBKIT_OPENCODE_DEFAULT_MODEL ??
    DEFAULT_OPENCODE_MODEL
  );
}

export function resolveLocalModel(
  taskType: string,
  env: Record<string, string | undefined> = process.env
) {
  return (
    modelOverrideFor(
      taskType,
      env.JOBKIT_LOCAL_LLM_MODELS,
      "JOBKIT_LOCAL_LLM_MODELS"
    ) ?? resolveLocalDefaultModel(env)
  );
}

export function resolveEngineModel(
  engine: AgentEngine,
  taskType: string,
  envelopeModel: string,
  env: Record<string, string | undefined> = process.env
) {
  if (engine === "opencode") {
    return resolveOpencodeModel(taskType, env);
  }
  if (engine === "local") {
    return resolveLocalModel(taskType, env);
  }
  return envelopeModel;
}

export function runEngineStructuredAgent(
  engine: AgentEngine,
  options: StructuredAgentOptions
) {
  if (engine === "opencode") {
    return runOpencodeStructuredAgent(options);
  }
  if (engine === "local") {
    return runLocalStructuredAgent(options);
  }
  return runStructuredAgent(options);
}

export async function engineVersionText(engine: AgentEngine) {
  if (engine === "local") {
    return `local ${resolveLocalDefaultModel()}`;
  }
  const executable = engine === "opencode" ? "opencode" : "codex";
  let result: Awaited<ReturnType<typeof captureProcess>>;
  try {
    result = await captureProcess(executable, ["--version"], {
      timeoutMs: 30_000,
    });
  } catch (error) {
    throw new Error(
      `${executable} is not installed or could not report its version: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  if (result.code !== 0) {
    throw new Error(
      `${executable} is not installed or could not report its version: ${result.stderr}`
    );
  }
  const version = result.stdout.trim();
  return engine === "opencode" ? `opencode ${version}` : version;
}

function modelOverrideFor(
  taskType: string,
  raw: string | undefined,
  variableName: string
) {
  const overrides = parseModelOverrides(raw, variableName);
  return (
    overrides[taskType] ??
    (taskType.startsWith("country_sweep.")
      ? overrides["country_sweep.*"]
      : undefined)
  );
}

function parseModelOverrides(raw: string | undefined, variableName: string) {
  if (!raw) {
    return {} as Record<string, string>;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${variableName} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  if (!(parsed && typeof parsed === "object") || Array.isArray(parsed)) {
    throw new Error(
      `${variableName} must be a JSON object mapping task types to models`
    );
  }
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(
        `${variableName} entry ${JSON.stringify(key)} must be a non-empty model string`
      );
    }
    overrides[key] = value.trim();
  }
  return overrides;
}
