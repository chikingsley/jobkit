import {
  JOB_CONTENT_PROMPT_VERSION,
  JOB_CONTENT_TASK_TYPE,
  JOB_MATCH_FACTS_PROMPT_VERSION,
  JOB_MATCH_FACTS_TASK_TYPE,
  JOB_POSITION_PROMPT_VERSION,
  JOB_POSITION_TASK_TYPE,
} from "../../../src/agent-tasks/job-analysis";
import {
  JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
  type JobContentAnalysis,
  JobContentAnalysisSchema,
} from "../../../src/features/jobs/content-analysis";
import {
  JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  type JobPositionAnalysis,
  JobPositionAnalysisSchema,
} from "../../../src/features/jobs/position-variants";
import {
  type JobMatchFacts,
  JobMatchFactsSchema,
} from "../../../src/features/matching/schema";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../../src/features/matching/version";
import { canonicalJson, canonicalSha256 } from "./hash";
import {
  assertClaimedUpdate,
  type ClaimedProjectionListing,
  claimedListingUpdateStatement,
  projectionRunCounterStatement,
} from "./listing-items";
import {
  type ExactProjectionListingSnapshot,
  ProjectionListingSnapshotError,
  readExactProjectionListingSnapshot,
} from "./listing-snapshot";

type AnalysisStatus =
  | "current"
  | "invalid_payload"
  | "missing"
  | "schema_mismatch"
  | "source_hash_mismatch";

interface AnalysisRecordRow {
  model_id: string;
  model_provider: string;
  payload_json: string;
  schema_version: number;
  source_hash: string;
  updated_at: string;
}

interface PositionAnalysisRow {
  model_id: string;
  model_provider: string;
  review_notes_json: string;
  schema_version: number;
  scope: string;
  source_hash: string;
  updated_at: string;
}

interface PositionVariantRow {
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

interface AnalysisCheckpoint {
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

const EXACT_ANALYSIS_MAX_FAILED_ATTEMPTS = 3;

export async function readProjectionAnalysisPrerequisites(
  db: D1Database,
  snapshot: ExactProjectionListingSnapshot
): Promise<ProjectionAnalysisPrerequisites> {
  const [
    matchFactsRow,
    contentRow,
    positionRow,
    positionVariants,
    attemptRows,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT schema_version,source_hash,model_provider,model_id,updated_at,
                  facts_json payload_json
             FROM job_match_facts WHERE job_id=? LIMIT 1`
      )
      .bind(snapshot.listingId)
      .first<AnalysisRecordRow>(),
    db
      .prepare(
        `SELECT schema_version,source_hash,model_provider,model_id,updated_at,
                  content_json payload_json
             FROM job_content_analyses WHERE job_id=? LIMIT 1`
      )
      .bind(snapshot.listingId)
      .first<AnalysisRecordRow>(),
    db
      .prepare(
        `SELECT scope,review_notes_json,schema_version,source_hash,
                  model_provider,model_id,updated_at
             FROM job_position_analyses WHERE job_id=? LIMIT 1`
      )
      .bind(snapshot.listingId)
      .first<PositionAnalysisRow>(),
    db
      .prepare(
        `SELECT ordinal,title,role_family,subjects_json,locations_json,
                  audiences_json,employment_types_json,requirements_json,
                  evidence_json,compensation_evidence_json,certainty
             FROM job_position_variants WHERE job_id=? ORDER BY ordinal`
      )
      .bind(snapshot.listingId)
      .all<PositionVariantRow>(),
    db
      .prepare(
        `SELECT task_type,prompt_version,
                  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)
                    failed_attempts,
                  SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)
                    completed_runs,
                  SUM(CASE WHEN status='running' THEN 1 ELSE 0 END)
                    running_runs
             FROM agent_task_runs
            WHERE source_task_id=? AND source_hash=?
              AND status IN ('failed','completed','running')
              AND (
                (task_type=? AND prompt_version=?)
                OR (task_type=? AND prompt_version=?)
                OR (task_type=? AND prompt_version=?)
              )
            GROUP BY task_type,prompt_version`
      )
      .bind(
        snapshot.listingId,
        snapshot.analysisSourceHash,
        JOB_MATCH_FACTS_TASK_TYPE,
        JOB_MATCH_FACTS_PROMPT_VERSION,
        JOB_CONTENT_TASK_TYPE,
        JOB_CONTENT_PROMPT_VERSION,
        JOB_POSITION_TASK_TYPE,
        JOB_POSITION_PROMPT_VERSION
      )
      .all<{
        failed_attempts: number;
        completed_runs: number;
        prompt_version: string;
        running_runs: number;
        task_type: string;
      }>(),
  ]);
  const attempts = Object.fromEntries(
    attemptRows.results.map((row) => [row.task_type, row])
  );
  const matchFacts = await parseAnalysisRecord(
    matchFactsRow,
    JOB_MATCH_FACTS_SCHEMA_VERSION,
    snapshot.analysisSourceHash,
    JobMatchFactsSchema,
    attempts[JOB_MATCH_FACTS_TASK_TYPE]
  );
  const content = await parseAnalysisRecord(
    contentRow,
    JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
    snapshot.analysisSourceHash,
    JobContentAnalysisSchema,
    attempts[JOB_CONTENT_TASK_TYPE]
  );
  const position = await parsePositionAnalysis(
    positionRow,
    positionVariants.results,
    snapshot.analysisSourceHash,
    attempts[JOB_POSITION_TASK_TYPE]
  );
  const checkpoint = {
    content: content.checkpoint,
    matchFacts: matchFacts.checkpoint,
    position: position.checkpoint,
  };
  return {
    checkpoint,
    content: content.value,
    guard:
      matchFactsRow && contentRow && positionRow && position.value
        ? {
            content: contentRow,
            matchFacts: matchFactsRow,
            position: {
              analysis: positionRow,
              variants: positionVariants.results,
            },
          }
        : null,
    matchFacts: matchFacts.value,
    position: position.value,
    ready:
      matchFacts.checkpoint.status === "current" &&
      content.checkpoint.status === "current" &&
      position.checkpoint.status === "current",
    terminalFailure: terminalAnalysisFailure(checkpoint),
  };
}

export async function processProjectionPrerequisiteClaim(
  db: D1Database,
  claim: ClaimedProjectionListing,
  timestamp: string
) {
  let snapshot: ExactProjectionListingSnapshot;
  try {
    snapshot = await readExactProjectionListingSnapshot(db, claim.id);
  } catch (error) {
    if (!(error instanceof ProjectionListingSnapshotError)) {
      throw error;
    }
    const checkpoint = {
      materialSnapshot: {
        checkedAt: timestamp,
        errorCode: error.code,
        state: "blocked",
      },
    };
    const results = await db.batch([
      claimedListingUpdateStatement(db, claim, {
        checkpoint,
        completedAt: timestamp,
        errorCode: error.code,
        errorDetail: error.message,
        stage: "prerequisites",
        status: "blocked",
        timestamp,
      }),
      projectionRunCounterStatement(db, claim.runId, timestamp),
    ]);
    assertClaimedUpdate(results[0], "material validation");
    return { blocked: 1, ready: 0, waiting: 0 };
  }
  const prerequisites = await readProjectionAnalysisPrerequisites(db, snapshot);
  const checkpoint = prerequisiteCheckpoint(snapshot, prerequisites, timestamp);
  if (prerequisites.terminalFailure) {
    const results = await db.batch([
      claimedListingUpdateStatement(db, claim, {
        checkpoint: {
          ...checkpoint,
          prerequisiteState: "blocked",
        },
        completedAt: timestamp,
        errorCode: prerequisites.terminalFailure.code,
        errorDetail: prerequisites.terminalFailure.detail,
        stage: "prerequisites",
        status: "blocked",
        timestamp,
      }),
      projectionRunCounterStatement(db, claim.runId, timestamp),
    ]);
    assertClaimedUpdate(results[0], "prerequisite wait");
    return { blocked: 1, ready: 0, waiting: 0 };
  }
  if (!prerequisites.ready) {
    const results = await db.batch([
      claimedListingUpdateStatement(db, claim, {
        checkpoint: { ...checkpoint, prerequisiteState: "waiting_analysis" },
        completedAt: null,
        stage: "prerequisites",
        status: "waiting_analysis",
        timestamp,
      }),
      projectionRunCounterStatement(db, claim.runId, timestamp),
    ]);
    assertClaimedUpdate(results[0], "prerequisite wait");
    return { blocked: 0, ready: 0, waiting: 1 };
  }
  const results = await db.batch([
    claimedListingUpdateStatement(db, claim, {
      checkpoint: { ...checkpoint, prerequisiteState: "validated" },
      completedAt: null,
      stage: "source_positions",
      status: "queued",
      timestamp,
    }),
    projectionRunCounterStatement(db, claim.runId, timestamp),
  ]);
  assertClaimedUpdate(results[0], "prerequisite validation");
  return { blocked: 0, ready: 1, waiting: 0 };
}

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

async function parseAnalysisRecord<Value>(
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

async function parsePositionAnalysis(
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

async function analysisCheckpoint<Value>(
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

function prerequisiteCheckpoint(
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

function terminalAnalysisFailure(
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

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
