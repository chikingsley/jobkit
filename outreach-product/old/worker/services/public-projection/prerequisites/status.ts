import {
  JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  JobPositionAnalysisSchema,
} from "../../../../src/features/jobs/position-variants";
import { canonicalJson } from "../hash";
import {
  ProjectionListingSnapshotError,
  readExactProjectionListingSnapshot,
} from "../listing-snapshot";
import { readProjectionAnalysisPrerequisites } from "../prerequisites";
import {
  analysisCheckpoint,
  parseJson,
  prerequisiteCheckpoint,
} from "./checkpoint";
import type {
  AnalysisRecordRow,
  AnalysisStatus,
  PositionAnalysisRow,
  PositionVariantRow,
} from "./model";

export async function projectionPrerequisitesAreReady(
  db: D1Database,
  listingItemId: string
) {
  try {
    const snapshot = await readExactProjectionListingSnapshot(
      db,
      listingItemId
    );
    return (await readProjectionAnalysisPrerequisites(db, snapshot)).ready;
  } catch {
    return false;
  }
}

export async function inspectProjectionPrerequisiteWaiter(
  db: D1Database,
  listingItemId: string
) {
  try {
    const snapshot = await readExactProjectionListingSnapshot(
      db,
      listingItemId
    );
    const prerequisites = await readProjectionAnalysisPrerequisites(
      db,
      snapshot
    );
    return {
      checkpoint: prerequisiteCheckpoint(
        snapshot,
        prerequisites,
        new Date().toISOString()
      ),
      ready: prerequisites.ready,
      terminalFailure: prerequisites.terminalFailure,
    };
  } catch (error) {
    if (error instanceof ProjectionListingSnapshotError) {
      return {
        checkpoint: {
          materialSnapshot: {
            errorCode: error.code,
            state: "blocked",
          },
        },
        ready: false,
        terminalFailure: { code: error.code, detail: error.message },
      };
    }
    throw error;
  }
}

export async function parseAnalysisRecord<Value>(
  row: AnalysisRecordRow | null,
  expectedSchemaVersion: number,
  expectedSourceHash: string,
  schema: { safeParse: (value: unknown) => { data?: Value; success: boolean } },
  attempts:
    | { completed_runs: number; failed_attempts: number; running_runs: number }
    | undefined
) {
  const status = analysisRecordStatus(
    row,
    expectedSchemaVersion,
    expectedSourceHash
  );
  const rawPayload = row ? parseJson(row.payload_json) : null;
  const parsed = status === "current" ? schema.safeParse(rawPayload) : null;
  const finalStatus: AnalysisStatus =
    status === "current" && !parsed?.success ? "invalid_payload" : status;
  const value = finalStatus === "current" ? (parsed?.data ?? null) : null;
  return {
    checkpoint: await analysisCheckpoint(
      row,
      expectedSchemaVersion,
      expectedSourceHash,
      finalStatus,
      value,
      attempts
    ),
    value,
  };
}

export async function parsePositionAnalysis(
  row: PositionAnalysisRow | null,
  variants: PositionVariantRow[],
  expectedSourceHash: string,
  attempts:
    | { completed_runs: number; failed_attempts: number; running_runs: number }
    | undefined
) {
  const baseStatus = analysisRecordStatus(
    row,
    JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
    expectedSourceHash
  );
  const ordinalsAreContiguous = variants.every(
    (variant, index) => variant.ordinal === index
  );
  const candidate = row
    ? {
        positions: variants.map((variant) => ({
          audiences: parseJson(variant.audiences_json),
          certainty: variant.certainty,
          compensationEvidence: parseJson(variant.compensation_evidence_json),
          employmentTypes: parseJson(variant.employment_types_json),
          evidence: parseJson(variant.evidence_json),
          locations: parseJson(variant.locations_json),
          requirements: parseJson(variant.requirements_json),
          roleFamily: variant.role_family,
          subjects: parseJson(variant.subjects_json),
          title: variant.title,
        })),
        reviewNotes: parseJson(row.review_notes_json),
        scope: row.scope,
      }
    : null;
  const parsed =
    baseStatus === "current" && ordinalsAreContiguous
      ? JobPositionAnalysisSchema.safeParse(candidate)
      : null;
  const hasExactDirectPosition =
    parsed?.success !== true ||
    parsed.data.scope !== "direct" ||
    parsed.data.positions.length === 1;
  const finalStatus: AnalysisStatus =
    baseStatus === "current" &&
    !(parsed?.success && ordinalsAreContiguous && hasExactDirectPosition)
      ? "invalid_payload"
      : baseStatus;
  const value = finalStatus === "current" ? (parsed?.data ?? null) : null;
  return {
    checkpoint: await analysisCheckpoint(
      row
        ? {
            ...row,
            payload_json: canonicalJson({ row, variants }),
          }
        : null,
      JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
      expectedSourceHash,
      finalStatus,
      value,
      attempts
    ),
    value,
  };
}

function analysisRecordStatus(
  row: Pick<AnalysisRecordRow, "schema_version" | "source_hash"> | null,
  expectedSchemaVersion: number,
  expectedSourceHash: string
): AnalysisStatus {
  if (!row) {
    return "missing";
  }
  if (row.schema_version !== expectedSchemaVersion) {
    return "schema_mismatch";
  }
  if (row.source_hash !== expectedSourceHash) {
    return "source_hash_mismatch";
  }
  return "current";
}
