import type {
  ClassificationLabel,
  ClassificationReviewCase,
} from "@/test-lab/classification-review";
import type {
  TestLabCapability,
  TestLabCase,
  TestLabVariant,
} from "@/test-lab/corpus";

export type TestLabRunStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "queued"
  | "running";

export interface TestLabRun {
  agentTaskRequestId: string | null;
  capability: string;
  caseId: string;
  caseKind: string;
  completedAt: string | null;
  corpusVersion: string;
  createdAt: string;
  error: string;
  expected: unknown;
  id: string;
  input: unknown;
  intermediate: unknown;
  metrics: {
    checks?: Array<{ label: string; passed: boolean }>;
    codexLatencyMs?: number;
    exact?: boolean;
    jinaLatencyMs?: number;
    latencyMs?: number;
    passed?: boolean;
    score?: number;
    [key: string]: unknown;
  };
  model: string;
  output: unknown;
  promptVersion: string;
  provenance: unknown;
  provider: string;
  startedAt: string | null;
  status: TestLabRunStatus;
  updatedAt: string;
  variant: string;
}

export interface TestLabResponse {
  cases: TestLabCase[];
  corpusVersion: string;
  integrations: {
    codex: boolean;
    jina: boolean;
    mistralOcr: boolean;
  };
  preferences: Array<{
    createdAt: string;
    id: string;
    leftRunId: string;
    notes: string;
    preference: string;
    rightRunId: string;
  }>;
  runs: TestLabRun[];
  summary: {
    active: number;
    completed: number;
    failed: number;
    meanScore: number | null;
    total: number;
  };
}

export interface ClassificationAdjudication {
  createdAt: string;
  itemId: string;
  label: ClassificationLabel;
  notes: string;
  sourceHash: string;
  updatedAt: string;
}

export interface ClassificationReviewResponse {
  adjudications: ClassificationAdjudication[];
  cases: ClassificationReviewCase[];
  corpusVersion: string;
  summary: {
    decided: number;
    remaining: number;
    total: number;
  };
}

export const testLabCapabilities: Array<{
  label: string;
  value: "all" | TestLabCapability;
}> = [
  { label: "All capabilities", value: "all" },
  { label: "Classification", value: "classification" },
  { label: "Reranking", value: "reranking" },
  { label: "Contact deduplication", value: "deduplication" },
  { label: "Fact extraction", value: "extraction" },
  { label: "Qualification matching", value: "matching" },
  { label: "Message revision", value: "revision" },
  { label: "Reader", value: "reader" },
  { label: "Search", value: "search" },
  { label: "DeepSearch", value: "deepsearch" },
];

export const variantLabels: Record<TestLabVariant, string> = {
  codex: "Codex",
  hybrid: "Jina + Codex",
  jina: "Jina",
};
