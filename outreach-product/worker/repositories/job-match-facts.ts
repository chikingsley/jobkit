interface PersistedJobMatchFacts {
  facts: unknown;
  modelId: string;
  provider: "cerebras" | "mistral";
  sourceHash: string;
}

interface JobMatchFactsRow {
  schema_version: number;
  source_hash: string;
}

export async function readJobMatchFacts(
  db: D1Database,
  jobId: string,
  schemaVersion: number
): Promise<{ sourceHash: string } | null> {
  const row = await db
    .prepare(
      "SELECT schema_version,source_hash FROM job_match_facts WHERE job_id=?"
    )
    .bind(jobId)
    .first<JobMatchFactsRow>();
  if (!row) {
    return null;
  }
  if (row.schema_version !== schemaVersion) {
    return null;
  }
  return {
    sourceHash: row.source_hash,
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
