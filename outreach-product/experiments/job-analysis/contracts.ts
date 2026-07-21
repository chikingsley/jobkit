import type { JobContentAnalysis } from "../../src/features/jobs/content-analysis";
import type { JobPositionAnalysis } from "../../src/features/jobs/position-variants";
import type { JobMatchFacts } from "../../src/features/matching/schema";

export interface AnalysisCase {
  board: string;
  company: string;
  country: string;
  description: string;
  id: string;
  salary: string;
  sourceUrl: string;
  title: string;
}

export type AnalysisTask = "content" | "facts" | "positions";

export interface ModelConfiguration {
  effort: "high" | "low" | "medium" | "xhigh";
  model: string;
}

export interface AnalysisRunResult {
  caseId: string;
  error?: string;
  evidenceQuotes: number;
  latencyMs: number;
  model: string;
  output?: JobContentAnalysis | JobMatchFacts | JobPositionAnalysis;
  rejectedEvidence?: string[];
  supportedEvidence: boolean;
  task: AnalysisTask;
}
