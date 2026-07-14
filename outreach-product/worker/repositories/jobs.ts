import type { Compensation } from "../../src/features/jobs/types";
import { normalizeCompensation } from "../jobs/compensation";
import type { JobImport } from "../schemas";

export async function upsertJob(
  db: D1Database,
  job: JobImport,
  timestamp: string
) {
  const compensation = normalizeCompensation(job);
  await db
    .prepare(
      `INSERT INTO jobs (
        id,board,title,company,country,location,salary,
        compensation_display,compensation_amount_min,compensation_amount_max,
        compensation_currency,compensation_period,compensation_qualifier,
        compensation_source,compensation_confidence,compensation_notes_json,
        description,source_url,apply_url,employer_id,first_seen_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,
        company=excluded.company,
        country=excluded.country,
        location=excluded.location,
        salary=excluded.salary,
        compensation_display=CASE WHEN jobs.compensation_source='curated-review' THEN jobs.compensation_display ELSE excluded.compensation_display END,
        compensation_amount_min=CASE WHEN jobs.compensation_source='curated-review' THEN jobs.compensation_amount_min ELSE excluded.compensation_amount_min END,
        compensation_amount_max=CASE WHEN jobs.compensation_source='curated-review' THEN jobs.compensation_amount_max ELSE excluded.compensation_amount_max END,
        compensation_currency=CASE WHEN jobs.compensation_source='curated-review' THEN jobs.compensation_currency ELSE excluded.compensation_currency END,
        compensation_period=CASE WHEN jobs.compensation_source='curated-review' THEN jobs.compensation_period ELSE excluded.compensation_period END,
        compensation_qualifier=CASE WHEN jobs.compensation_source='curated-review' THEN jobs.compensation_qualifier ELSE excluded.compensation_qualifier END,
        compensation_source=CASE WHEN jobs.compensation_source='curated-review' THEN jobs.compensation_source ELSE excluded.compensation_source END,
        compensation_confidence=CASE WHEN jobs.compensation_source='curated-review' THEN jobs.compensation_confidence ELSE excluded.compensation_confidence END,
        compensation_notes_json=CASE WHEN jobs.compensation_source='curated-review' THEN jobs.compensation_notes_json ELSE excluded.compensation_notes_json END,
        description=excluded.description,
        source_url=excluded.source_url,
        apply_url=excluded.apply_url,
        employer_id=excluded.employer_id,
        updated_at=excluded.updated_at`
    )
    .bind(
      job.id,
      job.board,
      job.title,
      job.company,
      job.country,
      job.location,
      job.salary,
      compensation.display,
      compensation.amountMin,
      compensation.amountMax,
      compensation.currency,
      compensation.period,
      compensation.qualifier,
      compensation.source,
      compensation.confidence,
      JSON.stringify(compensation.notes),
      job.description,
      job.sourceUrl,
      job.applyUrl,
      job.employerId,
      timestamp,
      timestamp
    )
    .run();
}

export async function upsertUserJob(
  db: D1Database,
  userId: string,
  jobId: string,
  priority: number,
  timestamp: string
): Promise<string> {
  const row = await db
    .prepare(
      `INSERT INTO user_jobs
        (id,user_id,job_id,status,priority,created_at,updated_at)
       VALUES (?,?,?,'new',?,?,?)
       ON CONFLICT(user_id,job_id) DO UPDATE SET
         priority=excluded.priority,
         updated_at=excluded.updated_at
       RETURNING id`
    )
    .bind(crypto.randomUUID(), userId, jobId, priority, timestamp, timestamp)
    .first<{ id: string }>();
  if (!row) {
    throw new Error("User job could not be saved");
  }
  return row.id;
}

export function compensationFromRow(
  row: Record<string, unknown>
): Compensation {
  return {
    amountMax: nullableNumber(row.compensation_amount_max),
    amountMin: nullableNumber(row.compensation_amount_min),
    confidence: String(
      row.compensation_confidence
    ) as Compensation["confidence"],
    currency: nullableString(row.compensation_currency),
    display: String(row.compensation_display),
    notes: JSON.parse(String(row.compensation_notes_json)) as string[],
    period: nullableString(row.compensation_period) as Compensation["period"],
    qualifier: nullableString(
      row.compensation_qualifier
    ) as Compensation["qualifier"],
    source: String(row.compensation_source) as Compensation["source"],
  };
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}
