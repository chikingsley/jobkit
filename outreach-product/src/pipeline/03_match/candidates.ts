import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { applicationRoutes, jobListings, jobMatchFacts } from "../../db/schema";
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

function factsPath(path: string) {
  return sql<
    string | null
  >`json_extract(${jobMatchFacts.factsJson}, ${`$.${path}`})`;
}

export async function readCandidates(
  db: Database,
  query: CandidateQuery = {}
): Promise<Candidate[]> {
  const kinds = query.routeKinds ?? [...ROUTE_KINDS];
  const boards = query.boards ?? [];
  const limit = Math.max(1, Math.min(MAX_LIMIT, query.limit ?? DEFAULT_LIMIT));
  const bestRoute = db
    .select({ id: applicationRoutes.id })
    .from(applicationRoutes)
    .where(
      and(
        eq(applicationRoutes.jobId, jobListings.id),
        eq(applicationRoutes.status, "active"),
        inArray(applicationRoutes.kind, [...kinds])
      )
    )
    .orderBy(desc(applicationRoutes.updatedAt))
    .limit(1);
  const rows = await db
    .select({
      amount_maximum: factsPath("economics.compensation.amountMaximum"),
      amount_minimum: factsPath("economics.compensation.amountMinimum"),
      benefits_json: factsPath("benefits"),
      board: jobListings.board,
      company: jobListings.company,
      country: jobListings.country,
      currency: factsPath("economics.compensation.currency"),
      description: jobListings.description,
      evidence_json: factsPath("economics.compensation.evidence"),
      id: jobListings.id,
      location: jobListings.location,
      period: factsPath("economics.compensation.period"),
      route_destination: applicationRoutes.destination,
      route_kind: applicationRoutes.kind,
      teaching_hours: factsPath("economics.workload.maximum"),
      title: jobListings.title,
    })
    .from(jobListings)
    .innerJoin(jobMatchFacts, eq(jobMatchFacts.jobId, jobListings.id))
    .leftJoin(applicationRoutes, eq(applicationRoutes.id, bestRoute))
    .where(
      and(
        eq(jobListings.inventoryStatus, "active"),
        boards.length === 0
          ? undefined
          : inArray(
              sql`lower(${jobListings.board})`,
              boards.map((board) => board.toLocaleLowerCase("en"))
            )
      )
    )
    .orderBy(jobListings.id)
    .limit(limit);
  const candidates = rows.map((row) => ({
    listing: normalizeListing(toRawListing(row as CandidateRow)),
    route: toRoute(row as CandidateRow),
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
