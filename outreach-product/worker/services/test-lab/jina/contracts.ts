export interface JinaExecutionResult {
  model: string;
  output: Record<string, unknown>;
  provenance: Record<string, unknown>;
  usage: Record<string, unknown>;
}

export interface JinaDocumentCandidate {
  id: string;
  text: string;
}
