// The single place that defines every model backend and which model does which
// job. Switch a model by editing one ASSIGNMENTS line, or override without code
// via an env var: JOBKIT_MODEL_<job>="provider:model" (e.g.
// JOBKIT_MODEL_emailWriter="localLlama:qwen35-9b-ud-q4-k-xl").

export type ProviderKind = "openai-http" | "cli";

export interface ModelProvider {
  // openai-http providers
  baseUrl?: string;
  // cli providers (runner-only)
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

// Every job the app asks a model to do, and the model assigned to it.
export const MODEL_ASSIGNMENTS = {
  documentOcr: "mistral:mistral-ocr-latest",
  emailWriter: "mistral:mistral-large-latest",
  jobAnalysis: "localLlama:qwen35-9b-ud-q4-k-xl",
} as const satisfies Record<string, string>;

export type ModelJob = keyof typeof MODEL_ASSIGNMENTS;

export interface ResolvedModel {
  model: string;
  provider: ProviderName;
  providerConfig: ModelProvider;
}

const ASSIGNMENT_PATTERN = /^([^:]+):(.+)$/u;

export function resolveModel(
  job: ModelJob,
  env: Record<string, string | undefined> = {}
): ResolvedModel {
  const assignment =
    env[`JOBKIT_MODEL_${job}`]?.trim() || MODEL_ASSIGNMENTS[job];
  const match = ASSIGNMENT_PATTERN.exec(assignment);
  const providerName = match?.[1];
  const model = match?.[2];
  if (!(providerName && model)) {
    throw new Error(
      `Model assignment for ${job} must be "provider:model", received ${JSON.stringify(assignment)}`
    );
  }
  const providerConfig = (MODEL_PROVIDERS as Record<string, ModelProvider>)[
    providerName
  ];
  if (!providerConfig) {
    throw new Error(
      `Unknown model provider ${JSON.stringify(providerName)} for job ${job}`
    );
  }
  return {
    model,
    provider: providerName as ProviderName,
    providerConfig,
  };
}
