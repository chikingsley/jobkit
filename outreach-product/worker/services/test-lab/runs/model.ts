export interface TestLabRunRow {
  agent_task_request_id: string | null;
  capability: string;
  case_id: string;
  case_kind: string;
  completed_at: string | null;
  corpus_version: string;
  created_at: string;
  error_detail: string;
  expected_json: string;
  id: string;
  input_json: string;
  intermediate_json: string | null;
  metrics_json: string;
  model: string;
  output_json: string | null;
  prompt_version: string;
  provenance_json: string;
  provider: string;
  started_at: string | null;
  status: "cancelled" | "completed" | "failed" | "queued" | "running";
  updated_at: string;
  variant: string;
}

export interface BenchmarkDocumentRow {
  content_type: string;
  etag: string;
  filename: string;
  id: string;
  object_key: string;
  r2_version: string;
  size_bytes: number;
}

export type DocumentBenchmarkVariant =
  | "codex_vision"
  | "deterministic"
  | "mistral_ocr";

export const DOCUMENT_BENCHMARK_VERSION = "document-ocr-2026-07-18-v1";
