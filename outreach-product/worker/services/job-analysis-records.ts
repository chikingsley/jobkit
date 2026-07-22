import {
  JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
  type JobContentAnalysis,
} from "../../src/features/jobs/content-analysis";
import type { JobPositionAnalysis } from "../../src/features/jobs/position-variants";
import { JOB_POSITION_ANALYSIS_SCHEMA_VERSION } from "../../src/features/jobs/position-variants";
import type { JobMatchFacts } from "../../src/features/matching/schema";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../src/features/matching/version";
import { unsupportedContentEvidence } from "../ai/job-content-extraction";
import {
  jobFactSource,
  jobSourceHash,
  unsupportedEvidence,
} from "../ai/job-fact-extraction";
import { unsupportedPositionEvidence } from "../ai/job-position-extraction";

interface JobContentAnalysisInput {
  content: JobContentAnalysis;
  jobId: string;
  modelId: string;
  provider: string;
  sourceHash: string;
}

interface JobMatchFactsInput {
  facts: JobMatchFacts;
  jobId: string;
  modelId: string;
  provider: string;
  sourceHash: string;
}

interface JobPositionAnalysisInput {
  analysis: JobPositionAnalysis;
  jobId: string;
  modelId: string;
  provider: string;
  sourceHash: string;
}

export interface JobAnalysisWriteFence {
  clause: string;
  values: [runId: string, runnerId: string, guardResultJson: string];
}

export interface JobListingSource {
  company: string;
  description: string;
  salary: string;
  title: string;
}

export class JobAnalysisRecordError extends Error {
  readonly rejectedEvidence: string[];
  readonly status: 404 | 409 | 422;

  constructor(
    message: string,
    status: 404 | 409 | 422,
    rejectedEvidence: string[] = []
  ) {
    super(message);
    this.status = status;
    this.rejectedEvidence = rejectedEvidence;
  }
}

export async function readJobListingSource(db: D1Database, jobId: string) {
  const job = await db
    .prepare(
      `SELECT j.title,j.company,j.salary,j.description
         FROM job_listings j
        WHERE j.id=?1`
    )
    .bind(jobId)
    .first<JobListingSource>();
  if (!job) {
    throw new JobAnalysisRecordError("Unknown job", 404);
  }
  return {
    company: String(job.company),
    description: String(job.description),
    salary: String(job.salary),
    title: String(job.title),
  };
}

export async function recordJobMatchFacts(
  db: D1Database,
  input: JobMatchFactsInput
) {
  const job = await readJobListingSource(db, input.jobId);
  await assertCurrentSource(job, input.sourceHash);
  const rejectedEvidence = unsupportedEvidence(input.facts, jobFactSource(job));
  if (rejectedEvidence.length > 0) {
    throw new JobAnalysisRecordError(
      `${rejectedEvidence.length} evidence ${rejectedEvidence.length === 1 ? "quote is" : "quotes are"} not present in the stored listing`,
      422,
      rejectedEvidence.slice(0, 10)
    );
  }
  await db.batch(jobMatchFactsStatements(db, input));
  return { jobId: input.jobId, schemaVersion: JOB_MATCH_FACTS_SCHEMA_VERSION };
}

export async function recordJobPositionAnalysis(
  db: D1Database,
  input: JobPositionAnalysisInput
) {
  const job = await readJobListingSource(db, input.jobId);
  await assertCurrentSource(job, input.sourceHash);
  const rejectedEvidence = unsupportedPositionEvidence(
    input.analysis,
    jobFactSource(job)
  );
  if (rejectedEvidence.length > 0) {
    throw new JobAnalysisRecordError(
      `${rejectedEvidence.length} evidence ${rejectedEvidence.length === 1 ? "quote is" : "quotes are"} not present in the stored listing`,
      422,
      rejectedEvidence.slice(0, 10)
    );
  }
  await db.batch(jobPositionAnalysisStatements(db, input));
  return {
    jobId: input.jobId,
    positionCount: input.analysis.positions.length,
    schemaVersion: JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  };
}

export async function recordJobContentAnalysis(
  db: D1Database,
  input: JobContentAnalysisInput
) {
  const job = await readJobListingSource(db, input.jobId);
  await assertCurrentSource(job, input.sourceHash);
  const rejectedEvidence = unsupportedContentEvidence(
    input.content,
    jobFactSource(job)
  );
  if (rejectedEvidence.length > 0) {
    throw new JobAnalysisRecordError(
      `${rejectedEvidence.length} evidence ${rejectedEvidence.length === 1 ? "quote is" : "quotes are"} not present in the stored listing`,
      422,
      rejectedEvidence.slice(0, 10)
    );
  }
  await jobContentAnalysisStatement(db, input).run();
  return {
    jobId: input.jobId,
    schemaVersion: JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
  };
}

export function jobMatchFactsStatements(
  db: D1Database,
  input: JobMatchFactsInput,
  fence?: JobAnalysisWriteFence
) {
  const fenceValues = fence ? fence.values : [];
  return [
    db
      .prepare(
        `INSERT INTO job_match_facts
          (job_id,facts_json,schema_version,model_provider,model_id,source_hash,
           updated_at)
         ${writeRow("?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')", fence)}
         ON CONFLICT(job_id) DO UPDATE SET
           facts_json=excluded.facts_json,
           schema_version=excluded.schema_version,
           model_provider=excluded.model_provider,
           model_id=excluded.model_id,
           source_hash=excluded.source_hash,
           updated_at=excluded.updated_at`
      )
      .bind(
        input.jobId,
        JSON.stringify(input.facts),
        JOB_MATCH_FACTS_SCHEMA_VERSION,
        input.provider,
        input.modelId,
        input.sourceHash,
        ...fenceValues
      ),
    db
      .prepare(
        `UPDATE job_listings SET market_segments_json=?
          WHERE id=?${writeFence(fence)}`
      )
      .bind(
        JSON.stringify(input.facts.marketSegments.map((fact) => fact.value)),
        input.jobId,
        ...fenceValues
      ),
  ];
}

export function jobPositionAnalysisStatements(
  db: D1Database,
  input: JobPositionAnalysisInput,
  fence?: JobAnalysisWriteFence
) {
  const fenceValues = fence ? fence.values : [];
  return [
    db
      .prepare(
        `DELETE FROM job_position_variants
          WHERE job_id=?${writeFence(fence)}`
      )
      .bind(input.jobId, ...fenceValues),
    db
      .prepare(
        `INSERT INTO job_position_analyses
          (job_id,scope,review_notes_json,schema_version,model_provider,model_id,
           source_hash,updated_at)
         ${writeRow("?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')", fence)}
         ON CONFLICT(job_id) DO UPDATE SET
           scope=excluded.scope,
           review_notes_json=excluded.review_notes_json,
           schema_version=excluded.schema_version,
           model_provider=excluded.model_provider,
           model_id=excluded.model_id,
           source_hash=excluded.source_hash,
           updated_at=excluded.updated_at`
      )
      .bind(
        input.jobId,
        input.analysis.scope,
        JSON.stringify(input.analysis.reviewNotes),
        JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
        input.provider,
        input.modelId,
        input.sourceHash,
        ...fenceValues
      ),
    ...input.analysis.positions.map((position, ordinal) =>
      db
        .prepare(
          `INSERT INTO job_position_variants
            (id,job_id,ordinal,title,role_family,subjects_json,locations_json,
             audiences_json,employment_types_json,requirements_json,evidence_json,
             compensation_evidence_json,certainty,created_at,updated_at)
           ${writeRow(
             `?,?,?,?,?,?,?,?,?,?,?,?,?,
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
             fence
           )}`
        )
        .bind(
          crypto.randomUUID(),
          input.jobId,
          ordinal,
          position.title,
          position.roleFamily,
          JSON.stringify(position.subjects),
          JSON.stringify(position.locations),
          JSON.stringify(position.audiences),
          JSON.stringify(position.employmentTypes),
          JSON.stringify(position.requirements),
          JSON.stringify(position.evidence),
          JSON.stringify(position.compensationEvidence),
          position.certainty,
          ...fenceValues
        )
    ),
  ];
}

export function jobContentAnalysisStatement(
  db: D1Database,
  input: JobContentAnalysisInput,
  fence?: JobAnalysisWriteFence
) {
  const fenceValues = fence ? fence.values : [];
  return db
    .prepare(
      `INSERT INTO job_content_analyses
        (job_id,content_json,schema_version,model_provider,model_id,source_hash,
         updated_at)
       ${writeRow("?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')", fence)}
       ON CONFLICT(job_id) DO UPDATE SET
         content_json=excluded.content_json,
         schema_version=excluded.schema_version,
         model_provider=excluded.model_provider,
         model_id=excluded.model_id,
         source_hash=excluded.source_hash,
         updated_at=excluded.updated_at`
    )
    .bind(
      input.jobId,
      JSON.stringify(input.content),
      JOB_CONTENT_ANALYSIS_SCHEMA_VERSION,
      input.provider,
      input.modelId,
      input.sourceHash,
      ...fenceValues
    );
}

function writeRow(values: string, fence?: JobAnalysisWriteFence) {
  return fence
    ? `SELECT ${values} WHERE ${fence.clause}`
    : `VALUES (${values})`;
}

function writeFence(fence?: JobAnalysisWriteFence) {
  return fence ? ` AND ${fence.clause}` : "";
}

async function assertCurrentSource(job: JobListingSource, sourceHash: string) {
  if ((await jobSourceHash(job)) !== sourceHash) {
    throw new JobAnalysisRecordError(
      "Source hash does not match the stored listing; analyze the current text",
      409
    );
  }
}
