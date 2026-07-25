import { Database as BunDatabase } from "bun:sqlite";
import type { Database } from "../../db/client";
import { applicationRoutes, jobListings, jobMatchFacts } from "../../db/schema";
import { matchFactsFromSourceFields } from "../02_extract/from-source-fields";
import type { RouteKind } from "../03_match/candidates";
import {
  JOB_MATCH_FACTS_SCHEMA_VERSION,
  type JobMatchFacts,
} from "../03_match/schema";

const BATCH_SIZE = 400;
const PLATFORM_ROUTES: Record<string, RouteKind> = {
  seriousteachers: "board_form",
  teacherhorizons: "login_gated_form",
  tefl: "login_gated_form",
};

export interface LedgerRow {
  apply_email: string;
  apply_url: string;
  board: string;
  company: string;
  country: string;
  description: string;
  first_seen_at: string;
  job_id: string;
  last_seen_at: string;
  location: string;
  raw_json: string;
  status: string;
  title: string;
}

export interface IngestionReport {
  listings: number;
  routes: Record<string, number>;
  withFacts: number;
}

export function listingId(board: string, jobId: string) {
  return `${board}:${jobId}`;
}

function sourceFields(raw: string): Record<string, string> {
  try {
    const { fields } = JSON.parse(raw) as { fields?: unknown };
    if (typeof fields !== "object" || fields === null) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(fields as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
  } catch {
    return {};
  }
}

export function routeFor(row: LedgerRow): {
  destination: string;
  kind: RouteKind;
} | null {
  const platform = PLATFORM_ROUTES[row.board];
  if (platform) {
    return row.apply_url
      ? { destination: row.apply_url, kind: platform }
      : null;
  }
  if (row.apply_email) {
    return { destination: row.apply_email, kind: "email" };
  }
  return row.apply_url
    ? { destination: row.apply_url, kind: "external_url" }
    : null;
}

function facts(row: LedgerRow): JobMatchFacts | null {
  const fields = sourceFields(row.raw_json);
  if (Object.keys(fields).length === 0) {
    return null;
  }
  try {
    return matchFactsFromSourceFields(row.board, fields);
  } catch {
    return null;
  }
}

export function readLedger(path: string): LedgerRow[] {
  const ledger = new BunDatabase(path, { readonly: true, strict: false });
  const rows = ledger
    .prepare(
      `SELECT apply_email,apply_url,board,company,country,description,
              first_seen_at,job_id,last_seen_at,location,raw_json,status,title
         FROM jobs ORDER BY board, job_id`
    )
    .all() as LedgerRow[];
  ledger.close();
  return rows;
}

export function ingestLedgerRows(
  db: Database,
  rows: LedgerRow[]
): IngestionReport {
  const report: IngestionReport = { listings: 0, routes: {}, withFacts: 0 };
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const listings = batch.map((row) => ({
      applyUrl: row.apply_url,
      board: row.board,
      company: row.company,
      country: row.country,
      description: row.description,
      firstSeenAt: row.first_seen_at || row.last_seen_at,
      id: listingId(row.board, row.job_id),
      inventoryStatus: row.status === "active" ? "active" : "closed",
      location: row.location,
      title: row.title,
      updatedAt: row.last_seen_at || row.first_seen_at,
    }));
    const extracted = batch.flatMap((row) => {
      const found = facts(row);
      return found
        ? [
            {
              factsJson: JSON.stringify(found),
              jobId: listingId(row.board, row.job_id),
              schemaVersion: JOB_MATCH_FACTS_SCHEMA_VERSION,
              updatedAt: row.last_seen_at || row.first_seen_at,
            },
          ]
        : [];
    });
    const routes = batch.flatMap((row) => {
      const route = routeFor(row);
      if (!route) {
        return [];
      }
      report.routes[route.kind] = (report.routes[route.kind] ?? 0) + 1;
      const id = listingId(row.board, row.job_id);
      return [
        {
          createdAt: row.first_seen_at || row.last_seen_at,
          destination: route.destination,
          id: `route:${id}`,
          jobId: id,
          kind: route.kind,
          status: row.status === "active" ? "active" : "closed",
          updatedAt: row.last_seen_at || row.first_seen_at,
        },
      ];
    });
    db.insert(jobListings).values(listings).onConflictDoNothing().run();
    if (extracted.length > 0) {
      db.insert(jobMatchFacts).values(extracted).onConflictDoNothing().run();
    }
    if (routes.length > 0) {
      db.insert(applicationRoutes).values(routes).onConflictDoNothing().run();
    }
    report.listings += listings.length;
    report.withFacts += extracted.length;
  }
  return report;
}
