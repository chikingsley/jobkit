import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { jobMatchFacts } from "../db/schema/jobs";

interface PersistedJobMatchFacts {
  facts: unknown;
  modelId: string;
  provider: string;
  sourceHash: string;
}

export async function readJobMatchFacts(
  db: D1Database,
  jobId: string,
  schemaVersion: number
): Promise<{ sourceHash: string } | null> {
  const row = await getDb(db)
    .select({
      schemaVersion: jobMatchFacts.schemaVersion,
      sourceHash: jobMatchFacts.sourceHash,
    })
    .from(jobMatchFacts)
    .where(eq(jobMatchFacts.jobId, jobId))
    .get();
  if (!row) {
    return null;
  }
  if (row.schemaVersion !== schemaVersion) {
    return null;
  }
  return {
    sourceHash: row.sourceHash,
  };
}

export function jobMatchFactsStatement(
  db: D1Database,
  jobId: string,
  result: PersistedJobMatchFacts,
  schemaVersion: number
) {
  return db
    .prepare(
      `INSERT INTO job_match_facts
        (job_id,facts_json,schema_version,model_provider,model_id,source_hash,updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(job_id) DO UPDATE SET
         facts_json=excluded.facts_json,
         schema_version=excluded.schema_version,
         model_provider=excluded.model_provider,
         model_id=excluded.model_id,
         source_hash=excluded.source_hash,
         updated_at=excluded.updated_at`
    )
    .bind(
      jobId,
      JSON.stringify(result.facts),
      schemaVersion,
      result.provider,
      result.modelId,
      result.sourceHash,
      new Date().toISOString()
    );
}
