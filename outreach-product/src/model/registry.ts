export type ProviderKind = "openai-http" | "cli";

export interface ModelProvider {
  baseUrl?: string;

  command?: string;
  keyEnv?: string;
  keyFile?: string;
  kind: ProviderKind;
}

export const MODEL_PROVIDERS = {
  codex: { command: "codex", kind: "cli" },
  localLlama: {
    baseUrl: "http://127.0.0.1:8030/v1",
    keyEnv: "JOBKIT_LOCAL_LLM_KEY",
    keyFile: "/home/simon/docker/llamacpp-llm/secrets/llamacpp-api-key",
    kind: "openai-http",
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    keyEnv: "MISTRAL_API_KEY",
    kind: "openai-http",
  },
  opencode: { command: "opencode", kind: "cli" },
} as const satisfies Record<string, ModelProvider>;

export type ProviderName = keyof typeof MODEL_PROVIDERS;

const DEFAULT_ASSIGNMENT = "mistral:mistral-medium-latest";

export const MODEL_ASSIGNMENTS: Record<string, string> = {
  "application.message": "mistral:mistral-medium-latest",
  "country_sweep.default": "mistral:mistral-medium-latest",
  default: DEFAULT_ASSIGNMENT,
  "document.ocr": "mistral:mistral-ocr-latest",
  "job.content_analysis": "localLlama:qwen35-9b-ud-q4-k-xl",
  "job.match_facts": "localLlama:qwen35-9b-ud-q4-k-xl",
  "job.position_analysis": "localLlama:qwen35-9b-ud-q4-k-xl",
  "profile.import": "mistral:mistral-medium-latest",
  "test_lab.document_ocr": "mistral:mistral-ocr-latest",
  "test_lab.evaluate": "localLlama:qwen35-9b-ud-q4-k-xl",
};

export interface ResolvedModel {
  model: string;
  provider: ProviderName;
  providerConfig: ModelProvider;
}

const ASSIGNMENT_PATTERN = /^([^:]+):(.+)$/u;

export function assignmentFor(
  taskType: string,
  env: Record<string, string | undefined> = {}
): string {
  const override = env[`JOBKIT_MODEL_${taskType}`]?.trim();
  if (override) {
    return override;
  }
  const direct = MODEL_ASSIGNMENTS[taskType];
  if (direct) {
    return direct;
  }
  if (taskType.startsWith("country_sweep.")) {
    const sweep = MODEL_ASSIGNMENTS["country_sweep.default"];
    if (sweep) {
      return sweep;
    }
  }
  return DEFAULT_ASSIGNMENT;
}

export function parseAssignment(
  taskType: string,
  assignment: string
): ResolvedModel {
  const match = ASSIGNMENT_PATTERN.exec(assignment);
  const providerName = match?.[1];
  const model = match?.[2];
  if (!(providerName && model)) {
    throw new Error(
      `Model assignment for ${taskType} must be "provider:model", received ${JSON.stringify(assignment)}`
    );
  }
  const providerConfig = (MODEL_PROVIDERS as Record<string, ModelProvider>)[
    providerName
  ];
  if (!providerConfig) {
    throw new Error(
      `Unknown model provider ${JSON.stringify(providerName)} for task ${taskType}`
    );
  }
  return { model, provider: providerName as ProviderName, providerConfig };
}

export function resolveAssignment(
  taskType: string,
  env: Record<string, string | undefined> = {}
): ResolvedModel {
  return parseAssignment(taskType, assignmentFor(taskType, env));
}
