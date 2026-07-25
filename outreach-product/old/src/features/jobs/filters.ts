import type { JobMatchSummary } from "@/profile-types";
import type { JobListItem } from "./types";

export interface JobFilters {
  country: string;
  fit: string;
  showExcluded: boolean;
}

export function filterJobs(
  jobs: JobListItem[],
  matches: ReadonlyMap<string, JobMatchSummary>,
  filters: JobFilters
) {
  return jobs.filter((job) => {
    if (job.status === "applied") {
      return false;
    }
    const match = matches.get(job.id);
    if (!(filters.showExcluded || match?.label !== "Ineligible")) {
      return false;
    }
    if (filters.fit !== "all" && match?.label !== filters.fit) {
      return false;
    }
    return filters.country === "all" || job.country === filters.country;
  });
}

export function selectVisibleJob(jobs: JobListItem[], selectedId: string) {
  return jobs.find((job) => job.id === selectedId) ?? jobs.at(0);
}
