import { z } from "zod";
import {
  JOB_POSITION_ANALYSIS_SCHEMA_VERSION,
  JobPositionAnalysisSchema,
} from "../../src/features/jobs/position-variants";
import type { JobKitApp } from "../app-types";
import { recordJobPositionAnalysis } from "../services/job-analysis-records";

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
    const allListings = c.req.query("mode") === "all";
    let rows: D1Result<PendingJobRow>;
    if (ids.length) {
      rows = await c.env.DB.prepare(
        `SELECT j.id,j.title,j.company,j.country,j.location,j.salary,j.description
           FROM user_jobs uj
           JOIN jobs j ON j.id=uj.job_id
           WHERE uj.user_id=?1
             AND j.id IN (SELECT value FROM json_each(?2))`
      )
        .bind(c.get("user").id, JSON.stringify(ids))
        .all<PendingJobRow>();
    } else if (allListings) {
      rows = await c.env.DB.prepare(
        `SELECT j.id,j.title,j.company,j.country,j.location,j.salary,j.description
         FROM user_jobs uj
         JOIN jobs j ON j.id=uj.job_id
         LEFT JOIN job_position_analyses pa
           ON pa.job_id=j.id AND pa.schema_version=?1
         WHERE uj.user_id=?2 AND pa.job_id IS NULL
           AND j.board<>'jobkit-e2e'
         ORDER BY uj.priority DESC,uj.updated_at DESC
         LIMIT ?3`
      )
        .bind(JOB_POSITION_ANALYSIS_SCHEMA_VERSION, c.get("user").id, limit)
        .all<PendingJobRow>();
    } else {
      rows = await c.env.DB.prepare(
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
    }
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
    await recordJobPositionAnalysis(c.env.DB, c.get("user").id, {
      analysis,
      jobId,
      modelId,
      provider,
      sourceHash,
    });
    return c.json({
      message: `Recorded ${analysis.positions.length} position variants for ${jobId}`,
      ok: true,
    });
  });
}
