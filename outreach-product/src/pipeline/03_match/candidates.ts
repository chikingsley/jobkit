import type { Database } from "../../db/client";
import {
  type CanonicalListing,
  normalizeListing,
  type RawListing,
} from "../02_extract/normalize";
import { type RankedListing, rankListings } from "./rank";

export const ROUTE_KINDS = [
  "email",
  "board_form",
  "login_gated_form",
  "external_url",
] as const;

export type RouteKind = (typeof ROUTE_KINDS)[number];

export interface ListingRoute {
  destination: string;
  kind: RouteKind;
}

export interface Candidate {
  listing: CanonicalListing;
  route: ListingRoute | null;
}

export interface RankedCandidate {
  listing: RankedListing;
  route: ListingRoute | null;
}

export interface CandidateQuery {
  boards?: string[];
  limit?: number;
  routeKinds?: RouteKind[];
}

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 20_000;
const DESCRIPTION_LIMIT = 4000;

const ROUTE_PREFERENCE = new Map<RouteKind, number>(
  ROUTE_KINDS.map((kind, index) => [kind, index])
);

interface CandidateRow extends Record<string, unknown> {
  amount_maximum: number | null;
  amount_minimum: number | null;
  benefits_json: string | null;
  board: string;
  company: string | null;
  country: string | null;
  currency: string | null;
  description: string | null;
  evidence_json: string | null;
  id: string;
  location: string | null;
  period: string | null;
  route_destination: string | null;
  route_kind: string | null;
  teaching_hours: number | null;
  title: string | null;
}

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(",");
}

function jsonArray(value: unknown): unknown[] {
  if (typeof value !== "string" || value === "") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function benefitNames(value: unknown): string[] {
  return jsonArray(value)
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      const named = entry as { value?: unknown };
      return typeof named.value === "string" ? named.value : "";
    })
    .filter((entry) => entry !== "");
}

function evidenceQuotes(value: unknown): string[] {
  return jsonArray(value).filter(
    (entry): entry is string => typeof entry === "string"
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function routeKind(value: unknown): RouteKind | null {
  return ROUTE_KINDS.find((kind) => kind === value) ?? null;
}

function toRawListing(row: CandidateRow): RawListing {
  return {
    amountMaximum: numberOrNull(row.amount_maximum),
    amountMinimum: numberOrNull(row.amount_minimum),
    benefits: benefitNames(row.benefits_json),
    board: row.board,
    company: text(row.company),
    country: text(row.country),
    currency: row.currency,
    description: text(row.description).slice(0, DESCRIPTION_LIMIT),
    evidence: evidenceQuotes(row.evidence_json),
    id: row.id,
    location: text(row.location),
    period: row.period,
    teachingHours: numberOrNull(row.teaching_hours),
    title: text(row.title),
  };
}

function toRoute(row: CandidateRow): ListingRoute | null {
  const kind = routeKind(row.route_kind);
  return kind === null
    ? null
    : { destination: text(row.route_destination), kind };
}

export async function readCandidates(
  db: Database,
  query: CandidateQuery = {}
): Promise<Candidate[]> {
  const kinds = query.routeKinds ?? [...ROUTE_KINDS];
  const boards = query.boards ?? [];
  const limit = Math.max(1, Math.min(MAX_LIMIT, query.limit ?? DEFAULT_LIMIT));
  const boardFilter =
    boards.length === 0
      ? ""
      : ` AND lower(l.board) IN (${placeholders(boards.length)})`;
  const rows = await db
    .prepare(
      `SELECT l.id,l.board,l.title,l.company,l.country,l.location,l.description,
              json_extract(f.facts_json,'$.economics.compensation.amountMinimum') amount_minimum,
              json_extract(f.facts_json,'$.economics.compensation.amountMaximum') amount_maximum,
              json_extract(f.facts_json,'$.economics.compensation.currency') currency,
              json_extract(f.facts_json,'$.economics.compensation.period') period,
              json_extract(f.facts_json,'$.economics.compensation.evidence') evidence_json,
              json_extract(f.facts_json,'$.economics.workload.maximum') teaching_hours,
              json_extract(f.facts_json,'$.benefits') benefits_json,
              r.kind route_kind,r.destination route_destination
         FROM job_listings l
         JOIN job_match_facts f ON f.job_id=l.id
         LEFT JOIN application_routes r ON r.id=(
           SELECT candidate.id FROM application_routes candidate
            WHERE candidate.job_id=l.id AND candidate.status='active'
              AND candidate.kind IN (${placeholders(kinds.length)})
            ORDER BY candidate.updated_at DESC LIMIT 1
         )
        WHERE l.inventory_status='active'${boardFilter}
        ORDER BY l.id
        LIMIT ?`
    )
    .bind(
      ...kinds,
      ...boards.map((board) => board.toLocaleLowerCase("en")),
      limit
    )
    .all<CandidateRow>();
  const candidates = rows.results.map((row) => ({
    listing: normalizeListing(toRawListing(row)),
    route: toRoute(row),
  }));
  return candidates.sort(byRoutePreference);
}

function byRoutePreference(first: Candidate, second: Candidate) {
  const rank = (candidate: Candidate) =>
    candidate.route === null
      ? ROUTE_KINDS.length
      : (ROUTE_PREFERENCE.get(candidate.route.kind) ?? ROUTE_KINDS.length);
  const difference = rank(first) - rank(second);
  return difference === 0
    ? first.listing.id.localeCompare(second.listing.id)
    : difference;
}

export function rankCandidates(candidates: Candidate[]): RankedCandidate[] {
  const routes = new Map(
    candidates.map((candidate) => [candidate.listing.id, candidate.route])
  );
  return rankListings(candidates.map((candidate) => candidate.listing)).map(
    (listing) => ({ listing, route: routes.get(listing.id) ?? null })
  );
}
