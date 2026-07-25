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
  JobContentAnalysisSchema,
} from "../../../src/features/jobs/content-analysis";
import { JobMatchFactsSchema } from "../../../src/features/matching/schema";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../../src/features/matching/version";
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
import {
  prerequisiteCheckpoint,
  terminalAnalysisFailure,
} from "./prerequisites/checkpoint";
import type {
  AnalysisRecordRow,
  PositionAnalysisRow,
  PositionVariantRow,
  ProjectionAnalysisPrerequisites,
} from "./prerequisites/model";
import {
  parseAnalysisRecord,
  parsePositionAnalysis,
} from "./prerequisites/status";

export type {
  ProjectionAnalysisGuard,
  ProjectionAnalysisPrerequisites,
} from "./prerequisites/model";
// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export {
  inspectProjectionPrerequisiteWaiter,
  projectionPrerequisitesAreReady,
} from "./prerequisites/status";

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
