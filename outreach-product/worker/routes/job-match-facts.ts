import { z } from "zod";
import { JobMatchFactsSchema } from "../../src/features/matching/schema";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../src/features/matching/version";
import {
  jobFactSource,
  jobSourceHash,
  unsupportedEvidence,
} from "../ai/job-fact-extraction";
import type { JobKitApp } from "../app-types";
import { jobMatchFactsStatement } from "../repositories/job-match-facts";

const PENDING_LIMIT_MAX = 100;
const PENDING_IDS_MAX = 100;

const RecordMatchFactsSchema = z.object({
  facts: JobMatchFactsSchema,
  jobId: z.string().min(1),
  modelId: z.string().min(1).max(200),
  provider: z.string().min(1).max(40),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/u),
});

interface PendingJobRow {
  description: string;
  id: string;
  salary: string;
  title: string;
}

export function registerJobMatchFactRoutes(app: JobKitApp) {
  app.get("/api/job-match-facts/pending", async (c) => {
    const limit = Math.min(
      Math.max(Number(c.req.query("limit")) || 10, 1),
      PENDING_LIMIT_MAX
    );
    const ids = (c.req.query("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, PENDING_IDS_MAX);
    // Explicit ids bypass the missing-facts filter so a job can be re-analyzed.
    const rows = ids.length
      ? await c.env.DB.prepare(
          `SELECT j.id,j.title,j.salary,j.description
             FROM user_jobs uj
             JOIN jobs j ON j.id=uj.job_id
            WHERE uj.user_id=?1
              AND j.id IN (SELECT value FROM json_each(?2))`
        )
          .bind(c.get("user").id, JSON.stringify(ids))
          .all<PendingJobRow>()
      : await c.env.DB.prepare(
          `SELECT j.id,j.title,j.salary,j.description
             FROM user_jobs uj
             JOIN jobs j ON j.id=uj.job_id
             LEFT JOIN job_match_facts mf
               ON mf.job_id=j.id AND mf.schema_version=?1
            WHERE uj.user_id=?2 AND mf.job_id IS NULL
            ORDER BY
              CASE WHEN j.compensation_period='hour'
                THEN COALESCE(j.compensation_amount_max,j.compensation_amount_min)
              END DESC NULLS LAST,
              uj.priority DESC,
              uj.updated_at DESC
            LIMIT ?3`
        )
          .bind(JOB_MATCH_FACTS_SCHEMA_VERSION, c.get("user").id, limit)
          .all<PendingJobRow>();
    const remaining = await c.env.DB.prepare(
      `SELECT COUNT(*) n
         FROM user_jobs uj
         LEFT JOIN job_match_facts mf
           ON mf.job_id=uj.job_id AND mf.schema_version=?1
        WHERE uj.user_id=?2 AND mf.job_id IS NULL`
    )
      .bind(JOB_MATCH_FACTS_SCHEMA_VERSION, c.get("user").id)
      .first<{ n: number }>();
    return c.json({
      pending: rows.results.map((row) => ({
        description: String(row.description),
        id: String(row.id),
        salary: String(row.salary),
        title: String(row.title),
      })),
      remaining: remaining?.n ?? 0,
      schemaVersion: JOB_MATCH_FACTS_SCHEMA_VERSION,
    });
  });

  app.post("/api/job-match-facts", async (c) => {
    const body = RecordMatchFactsSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        {
          issues: z.treeifyError(body.error),
          message: "Invalid match facts payload",
          ok: false,
        },
        400
      );
    }
    const { facts, jobId, modelId, provider, sourceHash } = body.data;
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
            "Source hash does not match the stored listing; re-fetch the job and analyze the current text",
          ok: false,
        },
        409
      );
    }
    const rejected = unsupportedEvidence(facts, jobFactSource(fields));
    if (rejected.length > 0) {
      return c.json(
        {
          message: `${rejected.length} evidence ${rejected.length === 1 ? "quote is" : "quotes are"} not present in the stored listing`,
          ok: false,
          rejectedEvidence: rejected.slice(0, 10),
        },
        422
      );
    }
    await jobMatchFactsStatement(
      c.env.DB,
      jobId,
      { facts, modelId, provider, sourceHash },
      JOB_MATCH_FACTS_SCHEMA_VERSION
    ).run();
    return c.json({ message: `Recorded match facts for ${jobId}`, ok: true });
  });
}
