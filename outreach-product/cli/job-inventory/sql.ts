import type { InventoryJob } from "./source";

export function inventorySql(
  jobs: InventoryJob[],
  userId: string,
  timestamp: string
) {
  return jobs
    .flatMap((job) => jobStatements(job, userId, timestamp))
    .join("\n");
}

function jobStatements(job: InventoryJob, userId: string, timestamp: string) {
  const { compensation } = job;
  const statements = [
    `INSERT INTO jobs (
      id,board,title,company,contact_name,country,location,salary,description,source_url,
      apply_url,employer_id,source_reference,first_seen_at,updated_at,compensation_display,
      compensation_amount_min,compensation_amount_max,compensation_currency,
      compensation_period,compensation_qualifier,compensation_source,
      compensation_confidence,compensation_notes_json,opportunity_scope,
      market_segments_json,message_route
    ) VALUES (
      ${sql(job.id)},${sql(job.board)},${sql(job.title)},${sql(job.company)},${sql(job.contactName)},
      ${sql(job.country)},${sql(job.location)},${sql(job.salary)},
      ${sql(job.description)},${sql(job.sourceUrl)},${sql(job.applyUrl)},'',
      ${sql(job.sourceReference)},${sql(job.lastSeenAt)},${sql(timestamp)},${sql(compensation.display)},
      ${numberOrNull(compensation.amountMinimum)},
      ${numberOrNull(compensation.amountMaximum)},${nullable(compensation.currency)},
      ${nullable(compensation.period)},${nullable(compensation.qualifier)},
      ${sql(compensation.confidence === "unknown" ? "unknown" : "listing-field")},
      ${sql(compensation.confidence)},'[]','unknown',
      ${sql(JSON.stringify(job.marketSegments))},'advertised_position'
    ) ON CONFLICT(id) DO UPDATE SET
      board=excluded.board,title=excluded.title,company=excluded.company,
      contact_name=excluded.contact_name,
      country=excluded.country,location=excluded.location,salary=excluded.salary,
      description=excluded.description,source_url=excluded.source_url,
      apply_url=excluded.apply_url,source_reference=excluded.source_reference,
      updated_at=excluded.updated_at,
      compensation_display=excluded.compensation_display,
      compensation_amount_min=excluded.compensation_amount_min,
      compensation_amount_max=excluded.compensation_amount_max,
      compensation_currency=excluded.compensation_currency,
      compensation_period=excluded.compensation_period,
      compensation_qualifier=excluded.compensation_qualifier,
      compensation_source=excluded.compensation_source,
      compensation_confidence=excluded.compensation_confidence,
      compensation_notes_json=excluded.compensation_notes_json,
      market_segments_json=excluded.market_segments_json;`,
    `INSERT INTO user_jobs (id,user_id,job_id,status,priority,created_at,updated_at)
     VALUES (${sql(crypto.randomUUID())},${sql(userId)},${sql(job.id)},'new',0,
             ${sql(timestamp)},${sql(timestamp)})
     ON CONFLICT(user_id,job_id) DO UPDATE SET updated_at=excluded.updated_at;`,
  ];
  if (job.applyEmail) {
    statements.push(
      applicationRouteStatement(job, "email", job.applyEmail, timestamp)
    );
  }
  if (job.applyUrl) {
    const kind = routeKind(job.board);
    statements.push(
      applicationRouteStatement(job, kind, job.applyUrl, timestamp)
    );
  }
  return statements;
}

function routeKind(board: string) {
  if (board === "seriousteachers") {
    return "board_form";
  }
  return board === "tefl" ? "login_gated_form" : "external_url";
}

function applicationRouteStatement(
  job: InventoryJob,
  kind: string,
  destination: string,
  timestamp: string
) {
  return `INSERT INTO application_routes (
    id,job_id,kind,destination,source_evidence,last_verified_at,status,created_at,updated_at
  ) VALUES (
    ${sql(crypto.randomUUID())},${sql(job.id)},${sql(kind)},
    ${sql(destination)},${sql(job.sourceUrl)},${sql(job.lastSeenAt)},'active',
    ${sql(timestamp)},${sql(timestamp)}
  ) ON CONFLICT(job_id,kind,destination) DO UPDATE SET
    source_evidence=excluded.source_evidence,
    last_verified_at=excluded.last_verified_at,
    status='active',updated_at=excluded.updated_at;`;
}

function sql(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function nullable(value: string | null) {
  return value === null ? "NULL" : sql(value);
}

function numberOrNull(value: number | null) {
  return value === null ? "NULL" : String(value);
}
