import type { JobPositionAnalysis } from "../../src/features/jobs/position-variants";
import { JOB_POSITION_ANALYSIS_SCHEMA_VERSION } from "../../src/features/jobs/position-variants";
import type { JobMatchFacts } from "../../src/features/matching/schema";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../src/features/matching/version";
import {
  jobFactSource,
  jobSourceHash,
  unsupportedEvidence,
} from "../ai/job-fact-extraction";
import { unsupportedPositionEvidence } from "../ai/job-position-extraction";
import { jobMatchFactsStatement } from "../repositories/job-match-facts";

export interface OwnedJobSource {
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

export async function readOwnedJobSource(
  db: D1Database,
  userId: string,
  jobId: string
) {
  const job = await db
    .prepare(
      `SELECT j.title,j.salary,j.description
         FROM jobs j
         JOIN user_jobs uj ON uj.job_id=j.id AND uj.user_id=?1
        WHERE j.id=?2`
    )
    .bind(userId, jobId)
    .first<OwnedJobSource>();
  if (!job) {
    throw new JobAnalysisRecordError("Unknown job", 404);
  }
  return {
    description: String(job.description),
    salary: String(job.salary),
    title: String(job.title),
  };
}

export async function recordJobMatchFacts(
  db: D1Database,
  userId: string,
  input: {
    facts: JobMatchFacts;
    jobId: string;
    modelId: string;
    provider: string;
    sourceHash: string;
  }
) {
  const job = await readOwnedJobSource(db, userId, input.jobId);
  await assertCurrentSource(job, input.sourceHash);
  const rejectedEvidence = unsupportedEvidence(input.facts, jobFactSource(job));
  if (rejectedEvidence.length > 0) {
    throw new JobAnalysisRecordError(
      `${rejectedEvidence.length} evidence ${rejectedEvidence.length === 1 ? "quote is" : "quotes are"} not present in the stored listing`,
      422,
      rejectedEvidence.slice(0, 10)
    );
  }
  await jobMatchFactsStatement(
    db,
    input.jobId,
    {
      facts: input.facts,
      modelId: input.modelId,
      provider: input.provider,
      sourceHash: input.sourceHash,
    },
    JOB_MATCH_FACTS_SCHEMA_VERSION
  ).run();
  return { jobId: input.jobId, schemaVersion: JOB_MATCH_FACTS_SCHEMA_VERSION };
}

export async function recordJobPositionAnalysis(
  db: D1Database,
  userId: string,
  input: {
    analysis: JobPositionAnalysis;
    jobId: string;
    modelId: string;
    provider: string;
    sourceHash: string;
  }
) {
  const job = await readOwnedJobSource(db, userId, input.jobId);
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

  const timestamp = new Date().toISOString();
  await db.batch([
    db
      .prepare("DELETE FROM job_position_variants WHERE job_id=?")
      .bind(input.jobId),
    db
      .prepare(
        `INSERT INTO job_position_analyses
          (job_id,scope,review_notes_json,schema_version,model_provider,model_id,
           source_hash,updated_at)
         VALUES (?,?,?,?,?,?,?,?)
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
        timestamp
      ),
    ...input.analysis.positions.map((position, ordinal) =>
      db
        .prepare(
          `INSERT INTO job_position_variants
            (id,job_id,ordinal,title,role_family,subjects_json,locations_json,
             audiences_json,employment_types_json,requirements_json,evidence_json,
             compensation_evidence_json,certainty,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
          timestamp,
          timestamp
        )
    ),
  ]);
  return {
    jobId: input.jobId,
    positionCount: input.analysis.positions.length,
    schemaVersion: JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  };
}

async function assertCurrentSource(job: OwnedJobSource, sourceHash: string) {
  if ((await jobSourceHash(job)) !== sourceHash) {
    throw new JobAnalysisRecordError(
      "Source hash does not match the stored listing; analyze the current text",
      409
    );
  }
}
