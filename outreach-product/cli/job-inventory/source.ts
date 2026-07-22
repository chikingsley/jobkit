import { Database } from "bun:sqlite";
import {
  type InventoryJob,
  InventoryJobSchema,
  InventorySourceDateEvidenceSchema,
} from "../../src/features/inventory/schema";
import { cloudflareEmailsFromHtml } from "../../src/features/jobs/protected-email";

interface SourceJobRow {
  apply_email: string;
  apply_url: string;
  board: string;
  company: string;
  country: string;
  description: string;
  job_id: string;
  last_seen_at: string;
  location: string;
  posted_date: string;
  raw: string;
  raw_json: string;
  salary: string;
  title: string;
  url: string;
}

interface SourcePayload {
  fields?: Record<string, string | undefined>;
}

export interface SourceInventory {
  active: number;
  closed: number;
  jobs: InventoryJob[];
  total: number;
}

const JOINED_HONORIFIC_PATTERN = /^(Dr|Mr|Mrs|Ms|Prof)\.(?=\p{L})/u;
const SOURCE_DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})(?=$|[T\s])/u;
const SERIOUS_TEACHERS_APPLICATION_ROUTE_PATTERN =
  /\/te2\/respond\/\d+\/(\d+)(?:$|[\s/?#])/u;

export function readSourceInventory(databasePath: string): SourceInventory {
  const database = new Database(databasePath, {
    readonly: true,
    strict: true,
  });
  try {
    const counts = database
      .query(
        `SELECT COUNT(*) total,
                COALESCE(SUM(status='active'), 0) active,
                COALESCE(SUM(status<>'active'), 0) closed
           FROM jobs`
      )
      .get() as { active: number; closed: number; total: number };
    const rows = database
      .query(
        `SELECT apply_email,apply_url,board,company,country,
                description,job_id,last_seen_at,location,posted_date,raw,raw_json,
                salary,title,url
           FROM jobs
          WHERE status='active'
          ORDER BY board,job_id`
      )
      .all() as SourceJobRow[];
    return {
      ...counts,
      jobs: rows.map(toInventoryJob),
    };
  } finally {
    database.close();
  }
}

function toInventoryJob(row: SourceJobRow): InventoryJob {
  const fields = sourceFields(row.raw_json);
  const salary = payStatement(row, fields);
  const description =
    row.description || fields.description || fields.body || row.raw;
  return InventoryJobSchema.parse({
    applyEmail: applyEmailFor(row),
    applyUrl: row.apply_url || row.url,
    board: row.board,
    company: row.company || fields.company || "",
    compensation: unknownCompensation(salary),
    contactName: contactNameFor(fields),
    country: row.country.trim(),
    description: description.slice(0, 50_000),
    employerId: employerIdFor(row, fields),
    id:
      row.board === "seriousteachers"
        ? row.job_id
        : `${row.board}:${row.job_id}`,
    lastSeenAt: row.last_seen_at || new Date().toISOString(),
    location: row.location,
    marketSegments: [],
    salary,
    sourceDates: {
      expires: sourceDateEvidence(fields.closing),
      posted: sourceDateEvidence(row.posted_date),
    },
    sourceReference: sourceReferenceFor(row, fields),
    sourceUrl: row.url,
    title: row.title,
  });
}

function employerIdFor(
  row: SourceJobRow,
  fields: Record<string, string | undefined>
) {
  const explicit =
    fields["Employer ID"]?.trim() ||
    fields.employerId?.trim() ||
    fields.employer_id?.trim();
  if (explicit) {
    return explicit.slice(0, 500);
  }
  const route = `${row.apply_url}\n${row.url}\n${row.raw}`;
  return SERIOUS_TEACHERS_APPLICATION_ROUTE_PATTERN.exec(route)?.[1] ?? "";
}

export function sourceDateEvidence(value: string | null | undefined) {
  const raw = (value ?? "").trim().slice(0, 500);
  if (!raw) {
    return InventorySourceDateEvidenceSchema.parse({
      date: null,
      provenance: "unknown",
      raw: "",
    });
  }
  const date = SOURCE_DATE_PREFIX_PATTERN.exec(raw)?.[1];
  if (date) {
    const published = InventorySourceDateEvidenceSchema.safeParse({
      date,
      provenance: "board-published",
      raw,
    });
    if (published.success) {
      return published.data;
    }
  }
  return InventorySourceDateEvidenceSchema.parse({
    date: null,
    provenance: "unresolved",
    raw,
  });
}

function applyEmailFor(row: SourceJobRow) {
  const stored = row.apply_email.trim().toLocaleLowerCase("en");
  if (stored) {
    return stored;
  }
  return cloudflareEmailsFromHtml(`${row.raw}\n${row.raw_json}`)[0] ?? "";
}

function sourceReferenceFor(
  row: SourceJobRow,
  fields: Record<string, string | undefined>
) {
  return fields["Position ID"]?.trim() || labeledValue(row.raw, "Position ID");
}

function labeledValue(source: string, label: string) {
  const prefix = `${label}:`;
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return "";
}

function contactNameFor(fields: Record<string, string | undefined>) {
  const name =
    fields["Contact Person"]?.trim() ||
    fields["Contact Name"]?.trim() ||
    fields.Contact?.trim() ||
    "";
  return name.replace(
    JOINED_HONORIFIC_PATTERN,
    (_match, honorific: string) => `${honorific}. `
  );
}

function sourceFields(rawJson: string): Record<string, string | undefined> {
  try {
    return (JSON.parse(rawJson) as SourcePayload).fields ?? {};
  } catch {
    return {};
  }
}

function payStatement(
  row: SourceJobRow,
  fields: Record<string, string | undefined>
) {
  const monthly = fields["Salary/M"]?.trim();
  if (monthly) {
    return `${monthly} / month`;
  }
  return row.salary.trim() || fields.Salary?.trim() || "";
}

function unknownCompensation(display: string): InventoryJob["compensation"] {
  return {
    amountMaximum: null,
    amountMinimum: null,
    confidence: "unknown",
    currency: null,
    display: display || "Salary not listed",
    period: null,
    qualifier: null,
  };
}
