export type TestLabCapability =
  | "classification"
  | "deduplication"
  | "deepsearch"
  | "extraction"
  | "matching"
  | "reader"
  | "reranking"
  | "revision"
  | "search";

export type TestLabVariant = "codex" | "hybrid" | "jina";

export interface TestLabCase {
  capability: TestLabCapability;
  description: string;
  expected: Record<string, unknown>;
  id: string;
  input: Record<string, unknown>;
  name: string;
  source: {
    kind: "official_documentation" | "synthetic";
    license: string;
    url?: string;
  };
  supportedVariants: TestLabVariant[];
  tags: string[];
  version: string;
}

export const TEST_LAB_CORPUS_VERSION = "jobkit-eval-2026-07-20-v3";

export const syntheticSource = {
  kind: "synthetic" as const,
  license: "JobKit synthetic fixture; no real person or employer",
};

export const jobLabels = [
  "english_teaching",
  "subject_teaching",
  "non_teaching",
  "unclear",
];
