import { canonicalSha256 } from "../hash";
import type { ExactProjectionListingSnapshot } from "../listing-snapshot";
import {
  type AnalysisCheckpoint,
  type AnalysisRecordRow,
  type AnalysisStatus,
  EXACT_ANALYSIS_MAX_FAILED_ATTEMPTS,
  type ProjectionAnalysisPrerequisites,
} from "./model";

export async function analysisCheckpoint<Value>(
  row: AnalysisRecordRow | null,
  expectedSchemaVersion: number,
  expectedSourceHash: string,
  status: AnalysisStatus,
  value: Value | null,
  attempts:
    | { completed_runs: number; failed_attempts: number; running_runs: number }
    | undefined
): Promise<AnalysisCheckpoint> {
  const attemptCounts =
    attempts === undefined
      ? { completed_runs: 0, failed_attempts: 0, running_runs: 0 }
      : attempts;
  const actualSchemaVersion = row ? row.schema_version : null;
  const actualSourceHash = row ? row.source_hash : "";
  const modelId = row ? row.model_id : "";
  const modelProvider = row ? row.model_provider : "";
  const updatedAt = row ? row.updated_at : null;
  return {
    actualSchemaVersion,
    actualSourceHash,
    completedRuns: attemptCounts.completed_runs,
    exhausted:
      attemptCounts.failed_attempts >= EXACT_ANALYSIS_MAX_FAILED_ATTEMPTS,
    expectedSchemaVersion,
    expectedSourceHash,
    failedAttempts: attemptCounts.failed_attempts,
    maxFailedAttempts: EXACT_ANALYSIS_MAX_FAILED_ATTEMPTS,
    modelId,
    modelProvider,
    payloadHash: value === null ? null : await canonicalSha256(value),
    recordFingerprint: await canonicalSha256(row ?? { state: "missing" }),
    runningRuns: attemptCounts.running_runs,
    status,
    updatedAt,
  };
}

export function prerequisiteCheckpoint(
  snapshot: ExactProjectionListingSnapshot,
  prerequisites: ProjectionAnalysisPrerequisites,
  timestamp: string
) {
  return {
    analyses: prerequisites.checkpoint,
    materialSnapshot: {
      analysisSourceHash: snapshot.analysisSourceHash,
      board: snapshot.board,
      checkedAt: timestamp,
      inputHash: snapshot.inputHash,
      listingId: snapshot.listingId,
      materialHash: snapshot.materialHash,
      materialHashVersion: snapshot.materialHashVersion,
      materialVersion: snapshot.materialVersion,
      state: "validated",
    },
  };
}

export function terminalAnalysisFailure(
  checkpoint: ProjectionAnalysisPrerequisites["checkpoint"]
) {
  const ordered = [
    ["position", checkpoint.position],
    ["match_facts", checkpoint.matchFacts],
    ["content", checkpoint.content],
  ] as const;
  const invalid = ordered.find(
    ([, value]) => value.status === "invalid_payload"
  );
  if (invalid) {
    return {
      code: `invalid_${invalid[0]}_analysis`,
      detail: `${invalid[0]} analysis has an invalid exact persisted payload`,
    };
  }
  const recordConflict = ordered.find(
    ([, value]) =>
      value.status !== "current" &&
      value.runningRuns === 0 &&
      value.completedRuns > 0
  );
  if (recordConflict) {
    return {
      code: `${recordConflict[0]}_analysis_record_conflict`,
      detail: `${recordConflict[0]} analysis has ${recordConflict[1].completedRuns} exact completed task run without a current record`,
    };
  }
  const exhausted = ordered.find(
    ([, value]) =>
      value.status !== "current" && value.runningRuns === 0 && value.exhausted
  );
  if (exhausted) {
    return {
      code: `${exhausted[0]}_analysis_attempts_exhausted`,
      detail: `${exhausted[0]} analysis reached ${exhausted[1].failedAttempts} exact failed agent attempts`,
    };
  }
  return null;
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
