import type { FxData, JobListItem } from "@/features/jobs/types";
import type { JobMatchSummary } from "@/profile-types";

export interface JobListPageMeta {
  appliedCount: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  totalAvailable: number;
  totalCount: number;
}

export interface JobListPageData {
  countries: string[];
  fx: FxData;
  jobs: JobListItem[];
  matches: Record<string, JobMatchSummary>;
  nextCursor: string | null;
  page: JobListPageMeta;
}

export interface JobListPageParam {
  cursor: string;
  offset: number;
}

export const firstJobListPageParam: JobListPageParam = {
  cursor: "",
  offset: 0,
};

export const emptyJobListPageMeta: JobListPageMeta = {
  appliedCount: 0,
  hasMore: false,
  limit: 0,
  offset: 0,
  totalAvailable: 0,
  totalCount: 0,
};

const emptyFx: FxData = { rates: {}, updatedAt: null };

export function flattenJobPages(pages: JobListPageData[]): JobListItem[] {
  const jobs = new Map<string, JobListItem>();
  for (const page of pages) {
    for (const job of page.jobs) {
      jobs.set(job.id, job);
    }
  }
  return [...jobs.values()];
}

export function mergeJobMatches(
  pages: JobListPageData[]
): Map<string, JobMatchSummary> {
  const matches = new Map<string, JobMatchSummary>();
  for (const page of pages) {
    for (const [jobId, match] of Object.entries(page.matches)) {
      matches.set(jobId, match);
    }
  }
  return matches;
}

export function nextJobListPageParam(
  lastPage: JobListPageData,
  allPages: JobListPageData[]
): JobListPageParam | undefined {
  if (!(lastPage.page.hasMore && lastPage.nextCursor)) {
    return;
  }
  return {
    cursor: lastPage.nextCursor,
    offset: flattenJobPages(allPages).length,
  };
}

export function latestJobListMeta(pages: JobListPageData[]): {
  countries: string[];
  fx: FxData;
  page: JobListPageMeta;
} {
  const latest = pages.at(-1);
  return {
    countries: latest?.countries ?? [],
    fx: latest?.fx ?? emptyFx,
    page: latest?.page ?? emptyJobListPageMeta,
  };
}

export function hasActiveDraftTask(pages: JobListPageData[]): boolean {
  return pages.some((page) =>
    page.jobs.some(
      (job) =>
        job.draftTask?.status === "queued" ||
        job.draftTask?.status === "claimed"
    )
  );
}
