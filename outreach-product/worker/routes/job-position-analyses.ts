import { z } from "zod";
import {
  JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  JobPositionAnalysisSchema,
} from "../../src/features/jobs/position-variants";
import { jobFactSource, jobSourceHash } from "../ai/job-fact-extraction";
import { unsupportedPositionEvidence } from "../ai/job-position-extraction";
import type { JobKitApp } from "../app-types";

const PENDING_LIMIT_MAX = 100;
const PENDING_IDS_MAX = 100;

const RecordPositionAnalysisSchema = z.object({
  analysis: JobPositionAnalysisSchema,
  jobId: z.string().min(1),
  modelId: z.string().min(1).max(200),
  provider: z.string().min(1).max(40),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/u),
});

interface PendingJobRow {
  company: string;
  country: string;
  description: string;
  id: string;
  location: string;
  salary: string;
  title: string;
}

export function registerJobPositionAnalysisRoutes(app: JobKitApp) {
  app.get("/api/job-position-analyses/pending", async (c) => {
    const limit = Math.min(
      Math.max(Number(c.req.query("limit")) || 10, 1),
      PENDING_LIMIT_MAX
    );
    const ids = (c.req.query("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, PENDING_IDS_MAX);
    const rows = ids.length
      ? await c.env.DB.prepare(
          `SELECT j.id,j.title,j.company,j.country,j.location,j.salary,j.description
           FROM user_jobs uj
           JOIN jobs j ON j.id=uj.job_id
           WHERE uj.user_id=?1
             AND j.id IN (SELECT value FROM json_each(?2))`
        )
          .bind(c.get("user").id, JSON.stringify(ids))
          .all<PendingJobRow>()
      : await c.env.DB.prepare(
          `SELECT j.id,j.title,j.company,j.country,j.location,j.salary,j.description
           FROM user_jobs uj
           JOIN jobs j ON j.id=uj.job_id
           LEFT JOIN job_position_analyses pa
             ON pa.job_id=j.id AND pa.schema_version=?1
           WHERE uj.user_id=?2 AND pa.job_id IS NULL
             AND (
               j.opportunity_scope='multi_position'
               OR lower(j.title || ' ' || j.description) LIKE '%multiple position%'
               OR lower(j.title || ' ' || j.description) LIKE '%various position%'
             )
           ORDER BY uj.priority DESC,uj.updated_at DESC
           LIMIT ?3`
        )
          .bind(JOB_POSITION_ANALYSIS_SCHEMA_VERSION, c.get("user").id, limit)
          .all<PendingJobRow>();
    return c.json({
      pending: rows.results.map((row) => ({
        company: String(row.company),
        country: String(row.country),
        description: String(row.description),
        id: String(row.id),
        location: String(row.location),
        salary: String(row.salary),
        title: String(row.title),
      })),
      schemaVersion: JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
    });
  });

  app.post("/api/job-position-analyses", async (c) => {
    const body = RecordPositionAnalysisSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        {
          issues: z.treeifyError(body.error),
          message: "Invalid position analysis payload",
          ok: false,
        },
        400
      );
    }
    const { analysis, jobId, modelId, provider, sourceHash } = body.data;
    const job = await c.env.DB.prepare(
      `SELECT j.title,j.salary,j.description
       FROM jobs j
       JOIN user_jobs uj ON uj.job_id=j.id AND uj.user_id=?1
       WHERE j.id=?2`
    )
      .bind(c.get("user").id, jobId)
      .first<{ description: string; salary: string; title: string }>();
    if (!job) {
      return c.json({ message: "Unknown job", ok: false }, 404);
    }
    const fields = {
      description: String(job.description),
      salary: String(job.salary),
      title: String(job.title),
    };
    if ((await jobSourceHash(fields)) !== sourceHash) {
      return c.json(
        {
          message:
            "Source hash does not match the stored listing; re-fetch and analyze the current text",
          ok: false,
        },
        409
      );
    }
    const source = jobFactSource(fields);
    const rejected = unsupportedPositionEvidence(analysis, source);
    if (rejected.length > 0) {
      return c.json(
        {
          message: `${rejected.length} evidence quotes are not present in the stored listing`,
          ok: false,
          rejectedEvidence: rejected.slice(0, 10),
        },
        422
      );
    }
    const timestamp = new Date().toISOString();
    const statements = [
      c.env.DB.prepare("DELETE FROM job_position_variants WHERE job_id=?").bind(
        jobId
      ),
      c.env.DB.prepare(
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
      ).bind(
        jobId,
        analysis.scope,
        JSON.stringify(analysis.reviewNotes),
        JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
        provider,
        modelId,
        sourceHash,
        timestamp
      ),
      ...analysis.positions.map((position, ordinal) =>
        c.env.DB.prepare(
          `INSERT INTO job_position_variants
            (id,job_id,ordinal,title,role_family,subjects_json,locations_json,
             audiences_json,employment_types_json,requirements_json,evidence_json,
             compensation_evidence_json,certainty,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          crypto.randomUUID(),
          jobId,
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
    ];
    await c.env.DB.batch(statements);
    return c.json({
      message: `Recorded ${analysis.positions.length} position variants for ${jobId}`,
      ok: true,
    });
  });
}
