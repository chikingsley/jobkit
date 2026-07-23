import type { JobContentAnalysis } from "../../../../src/features/jobs/content-analysis";
import type { JobPositionAnalysis } from "../../../../src/features/jobs/position-variants";
import type { JobMatchFacts } from "../../../../src/features/matching/schema";

export type AnalysisStatus =
  | "current"
  | "invalid_payload"
  | "missing"
  | "schema_mismatch"
  | "source_hash_mismatch";

export interface AnalysisRecordRow {
  model_id: string;
  model_provider: string;
  payload_json: string;
  schema_version: number;
  source_hash: string;
  updated_at: string;
}

export interface PositionAnalysisRow {
  model_id: string;
  model_provider: string;
  review_notes_json: string;
  schema_version: number;
  scope: string;
  source_hash: string;
  updated_at: string;
}

export interface PositionVariantRow {
  audiences_json: string;
  certainty: string;
  compensation_evidence_json: string;
  employment_types_json: string;
  evidence_json: string;
  locations_json: string;
  ordinal: number;
  requirements_json: string;
  role_family: string;
  subjects_json: string;
  title: string;
}

export interface AnalysisCheckpoint {
  actualSchemaVersion: number | null;
  actualSourceHash: string;
  completedRuns: number;
  exhausted: boolean;
  expectedSchemaVersion: number;
  expectedSourceHash: string;
  failedAttempts: number;
  maxFailedAttempts: number;
  modelId: string;
  modelProvider: string;
  payloadHash: string | null;
  recordFingerprint: string;
  runningRuns: number;
  status: AnalysisStatus;
  updatedAt: string | null;
}

export interface ProjectionAnalysisPrerequisites {
  checkpoint: {
    content: AnalysisCheckpoint;
    matchFacts: AnalysisCheckpoint;
    position: AnalysisCheckpoint;
  };
  content: JobContentAnalysis | null;
  guard: ProjectionAnalysisGuard | null;
  matchFacts: JobMatchFacts | null;
  position: JobPositionAnalysis | null;
  ready: boolean;
  terminalFailure: { code: string; detail: string } | null;
}

export interface ProjectionAnalysisGuard {
  content: AnalysisRecordRow;
  matchFacts: AnalysisRecordRow;
  position: {
    analysis: PositionAnalysisRow;
    variants: PositionVariantRow[];
  };
}

export const EXACT_ANALYSIS_MAX_FAILED_ATTEMPTS = 3;
