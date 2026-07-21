export type JinaExperimentTrack =
  | "text-classification"
  | "text-embeddings"
  | "multimodal-embeddings";

export interface JinaExperimentModel {
  apiModel: string;
  contextTokens: number;
  defaultDimensions: number;
  documentationUrl: string;
  id: string;
  modalities: Array<"image" | "pdf" | "text">;
  parameters: number;
  tracks: JinaExperimentTrack[];
}

export const JINA_EXPERIMENT_MODELS = [
  {
    apiModel: "jina-embeddings-v3",
    contextTokens: 8192,
    defaultDimensions: 1024,
    documentationUrl: "https://jina.ai/models/jina-embeddings-v3/",
    id: "v3",
    modalities: ["text"],
    parameters: 570_000_000,
    tracks: ["text-classification", "text-embeddings"],
  },
  {
    apiModel: "jina-embeddings-v4",
    contextTokens: 32_768,
    defaultDimensions: 2048,
    documentationUrl: "https://jina.ai/models/jina-embeddings-v4/",
    id: "v4",
    modalities: ["text", "image", "pdf"],
    parameters: 3_800_000_000,
    tracks: ["text-classification", "text-embeddings", "multimodal-embeddings"],
  },
  {
    apiModel: "jina-embeddings-v5-text-small",
    contextTokens: 32_768,
    defaultDimensions: 1024,
    documentationUrl: "https://jina.ai/models/jina-embeddings-v5-text-small/",
    id: "v5-text-small",
    modalities: ["text"],
    parameters: 677_000_000,
    tracks: ["text-classification", "text-embeddings"],
  },
  {
    apiModel: "jina-embeddings-v5-text-nano",
    contextTokens: 8192,
    defaultDimensions: 768,
    documentationUrl: "https://jina.ai/models/jina-embeddings-v5-text-nano/",
    id: "v5-text-nano",
    modalities: ["text"],
    parameters: 239_000_000,
    tracks: ["text-classification", "text-embeddings"],
  },
] as const satisfies readonly JinaExperimentModel[];

export type JinaExperimentModelId =
  (typeof JINA_EXPERIMENT_MODELS)[number]["id"];

export function classificationModels() {
  return JINA_EXPERIMENT_MODELS.filter((model) =>
    model.tracks.includes("text-classification")
  );
}

export function findJinaExperimentModel(id: string) {
  return JINA_EXPERIMENT_MODELS.find((model) => model.id === id) ?? null;
}
