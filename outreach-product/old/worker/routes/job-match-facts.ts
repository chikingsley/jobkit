import { z } from "zod";
import { JobMatchFactsSchema } from "../../src/features/matching/schema";
import { JOB_MATCH_FACTS_SCHEMA_VERSION } from "../../src/features/matching/version";
import type { JobKitApp } from "../app-types";
import { recordJobMatchFacts } from "../services/job-analysis-records";

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
    if (c.get("user").role !== "operator") {
      return c.json({ message: "Operator access is required", ok: false }, 403);
    }
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
          `SELECT j.id,j.title,j.salary,j.description
             FROM job_listings j
            WHERE j.inventory_status='active'
              AND j.id IN (SELECT value FROM json_each(?1))`
        )
          .bind(JSON.stringify(ids))
          .all<PendingJobRow>()
      : await c.env.DB.prepare(
          `SELECT j.id,j.title,j.salary,j.description
             FROM job_listings j
             LEFT JOIN job_match_facts mf
               ON mf.job_id=j.id AND mf.schema_version=?1
            WHERE j.inventory_status='active' AND mf.job_id IS NULL
            ORDER BY
              CASE WHEN j.compensation_period='hour'
                THEN COALESCE(j.compensation_amount_max,j.compensation_amount_min)
              END DESC NULLS LAST,
              j.updated_at DESC
            LIMIT ?2`
        )
          .bind(JOB_MATCH_FACTS_SCHEMA_VERSION, limit)
          .all<PendingJobRow>();
    const remaining = await c.env.DB.prepare(
      `SELECT COUNT(*) n
         FROM job_listings j
         LEFT JOIN job_match_facts mf
           ON mf.job_id=j.id AND mf.schema_version=?1
        WHERE j.inventory_status='active' AND mf.job_id IS NULL`
    )
      .bind(JOB_MATCH_FACTS_SCHEMA_VERSION)
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
    if (c.get("user").role !== "operator") {
      return c.json({ message: "Operator access is required", ok: false }, 403);
    }
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
    await recordJobMatchFacts(c.env.DB, {
      facts,
      jobId,
      modelId,
      provider,
      sourceHash,
    });
    return c.json({ message: `Recorded match facts for ${jobId}`, ok: true });
  });
}
