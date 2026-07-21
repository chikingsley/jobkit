import type { Compensation } from "../../src/features/jobs/types";
import type { JobImport } from "../schemas";

export async function upsertJob(
  db: D1Database,
  job: JobImport,
  timestamp: string
) {
  await db
    .prepare(
      `INSERT INTO job_listings (
        id,board,title,company,contact_name,country,location,salary,description,
        source_url,apply_url,employer_id,source_reference,first_seen_at,updated_at,
        opportunity_scope,market_segments_json,message_route
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,
        company=excluded.company,
        contact_name=excluded.contact_name,
        country=excluded.country,
        location=excluded.location,
        salary=excluded.salary,
        description=excluded.description,
        source_url=excluded.source_url,
        apply_url=excluded.apply_url,
        employer_id=excluded.employer_id,
        source_reference=excluded.source_reference,
        opportunity_scope=excluded.opportunity_scope,
        market_segments_json=excluded.market_segments_json,
        message_route=excluded.message_route,
        updated_at=excluded.updated_at`
    )
    .bind(
      job.id,
      job.board,
      job.title,
      job.company,
      job.contactName,
      job.country,
      job.location,
      job.salary,
      job.description,
      job.sourceUrl,
      job.applyUrl,
      job.employerId,
      job.sourceReference,
      timestamp,
      timestamp,
      job.opportunityScope,
      JSON.stringify(job.marketSegments),
      job.opportunityScope === "multi_position"
        ? "multi_position"
        : job.messageRoute
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
      `INSERT INTO user_listing_states
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
