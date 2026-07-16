import { monthlyCompensationUsd } from "./compensation";
import { listedHourlyValueUsd, statedHourlyUsd } from "./economics";
import type { FxData, Job } from "./types";

export type JobSort = "monthly-pay" | "review-order" | "stated-hourly";

export function sortJobs(jobs: Job[], fx: FxData, sort: JobSort): Job[] {
  if (sort === "review-order") {
    return jobs;
  }
  return jobs
    .map((job, index) => {
      const listedHourly = listedHourlyValueUsd(job.compensation, fx);
      return {
        hourly:
          (job.matchFacts === null
            ? null
            : statedHourlyUsd(job.matchFacts.economics, fx)) ??
          listedHourly?.minimum ??
          listedHourly?.maximum ??
          null,
        index,
        job,
        monthly: monthlyCompensationUsd(job.compensation, fx) ?? null,
      };
    })
    .toSorted((first, second) => {
      const primary =
        sort === "stated-hourly"
          ? compareDescending(first.hourly, second.hourly)
          : compareDescending(first.monthly, second.monthly);
      if (primary !== 0) {
        return primary;
      }
      const secondary =
        sort === "stated-hourly"
          ? compareDescending(first.monthly, second.monthly)
          : compareDescending(first.hourly, second.hourly);
      return secondary || first.index - second.index;
    })
    .map(({ job }) => job);
}

function compareDescending(first: number | null, second: number | null) {
  if (first === null && second === null) {
    return 0;
  }
  if (first === null) {
    return 1;
  }
  if (second === null) {
    return -1;
  }
  return second - first;
}
