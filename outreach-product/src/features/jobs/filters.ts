import type { JobMatch } from "@/profile-types";
import type { Job } from "./types";

interface JobFilters {
  country: string;
  fit: string;
  showExcluded: boolean;
}

export function filterJobs(
  jobs: Job[],
  matches: ReadonlyMap<string, JobMatch>,
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

export function selectVisibleJob(jobs: Job[], selectedId: string) {
  return jobs.find((job) => job.id === selectedId) ?? jobs.at(0);
}
