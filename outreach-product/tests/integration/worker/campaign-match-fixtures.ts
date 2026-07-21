import { JOB_POSITION_ANALYSIS_SCHEMA_VERSION } from "../../../src/features/jobs/position-variants";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../../src/features/matching/version";

export function seedStrongEnglishMatch(
  db: D1Database,
  jobId: string,
  timestamp: string
) {
  const facts = {
    audiences: [{ evidence: "Adult English learners", value: "adults" }],
    benefits: [],
    economics: {
      compensation: {
        amountMaximum: null,
        amountMinimum: null,
        currency: null,
        evidence: [],
        kind: "unstated",
        period: null,
        qualifier: null,
        taxBasis: "unspecified",
      },
      workload: null,
    },
    employmentTypes: [
      { evidence: "Full-time English teacher", value: "fullTime" },
    ],
    marketSegments: [],
    requirements: [],
    reviewNotes: [],
  };
  const evidence = ["English teacher for adult learners"];
  const emptyEvidence = "[]";
  return db.batch([
    db
      .prepare(
        `INSERT INTO job_match_facts
          (job_id,facts_json,schema_version,model_provider,model_id,
           source_hash,updated_at)
         VALUES (?,?,?,?,?,?,?)`
      )
      .bind(
        jobId,
        JSON.stringify(facts),
        JOB_MATCH_FACTS_SCHEMA_VERSION,
        "codex",
        "gpt-5.6-luna",
        `fixture:${jobId}:facts`,
        timestamp
      ),
    db
      .prepare(
        `INSERT INTO job_position_analyses
          (job_id,scope,review_notes_json,schema_version,model_provider,
           model_id,source_hash,updated_at)
         VALUES (?,'direct','[]',?,'codex','gpt-5.6-luna',?,?)`
      )
      .bind(
        jobId,
        JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
        `fixture:${jobId}:position`,
        timestamp
      ),
    db
      .prepare(
        `INSERT INTO job_position_variants
          (id,job_id,ordinal,title,role_family,subjects_json,locations_json,
           audiences_json,employment_types_json,requirements_json,
           evidence_json,compensation_evidence_json,certainty,created_at,
           updated_at)
         VALUES (?, ?, 0, 'English teacher', 'english_language', ?, ?, ?, ?,
                 ?, ?, ?, 'explicit', ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        jobId,
        emptyEvidence,
        emptyEvidence,
        JSON.stringify(facts.audiences),
        JSON.stringify(facts.employmentTypes),
        emptyEvidence,
        JSON.stringify(evidence),
        emptyEvidence,
        timestamp,
        timestamp
      ),
  ]);
}
