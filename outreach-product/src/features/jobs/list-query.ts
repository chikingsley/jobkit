import type { JobSort } from "./sorting";

export const PRIVATE_JOB_PAGE_SIZE = 100;
export const PRIVATE_JOB_EXCLUDED_BOARD = "anesl";

export interface JobListFilters {
  country: string;
  fit: string;
  publicJob: string;
  showExcluded: boolean;
  sort: JobSort;
}

export function jobListFilters(
  partial: Partial<JobListFilters> = {}
): JobListFilters {
  return {
    country: partial.country ?? "all",
    fit: partial.fit ?? "all",
    publicJob: partial.publicJob ?? "",
    showExcluded: partial.showExcluded ?? false,
    sort: partial.sort ?? "stated-hourly",
  };
}

export function privateJobListQuery(
  filters: JobListFilters,
  page: { cursor: string; offset: number }
): PrivateJobListQuery {
  return {
    country: filters.country,
    cursor: page.cursor,
    excludeBoard: PRIVATE_JOB_EXCLUDED_BOARD,
    fit: filters.fit,
    limit: PRIVATE_JOB_PAGE_SIZE,
    offset: page.offset,
    publicJob: filters.publicJob,
    showExcluded: filters.showExcluded,
    sort: filters.sort,
  };
}

export interface PrivateJobListQuery {
  country: string;
  cursor: string;
  excludeBoard: string;
  fit: string;
  limit: number;
  offset: number;
  publicJob: string;
  showExcluded: boolean;
  sort: JobSort;
}

const jobSorts = new Set<JobSort>([
  "monthly-pay",
  "review-order",
  "stated-hourly",
]);

export function parsePrivateJobListQuery(
  search: URLSearchParams
): PrivateJobListQuery {
  return {
    country: boundedText(search.get("country"), 100) || "all",
    cursor: boundedText(search.get("cursor"), 600),
    excludeBoard: boundedText(search.get("excludeBoard"), 100),
    fit: boundedText(search.get("fit"), 100) || "all",
    limit: boundedInteger(search.get("limit"), 1, PRIVATE_JOB_PAGE_SIZE, 100),
    offset: boundedInteger(search.get("offset"), 0, 100_000, 0),
    publicJob: boundedText(search.get("publicJob"), 100),
    showExcluded: search.get("excluded") === "true",
    sort: jobSort(search.get("sort")),
  };
}

export function privateJobListSearchParams(query: PrivateJobListQuery) {
  const search = new URLSearchParams({
    excludeBoard: query.excludeBoard,
    limit: String(query.limit),
    offset: String(query.offset),
  });
  if (query.country !== "all") {
    search.set("country", query.country);
  }
  if (query.cursor) {
    search.set("cursor", query.cursor);
  }
  if (query.fit !== "all") {
    search.set("fit", query.fit);
  }
  if (query.publicJob) {
    search.set("publicJob", query.publicJob);
  }
  if (query.showExcluded) {
    search.set("excluded", "true");
  }
  if (query.sort !== "stated-hourly") {
    search.set("sort", query.sort);
  }
  return search;
}

function boundedInteger(
  raw: string | null,
  minimum: number,
  maximum: number,
  fallback: number
) {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function boundedText(raw: string | null, maximum: number) {
  return (raw ?? "").trim().slice(0, maximum);
}

function jobSort(raw: string | null): JobSort {
  return jobSorts.has(raw as JobSort) ? (raw as JobSort) : "stated-hourly";
}
