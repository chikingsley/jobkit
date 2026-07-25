import { monthlyCompensationUsd } from "./compensation";
import { listedHourlyValueUsd } from "./economics";
import type { FxData, JobListItem } from "./types";

export type JobSort =
  | "match-score"
  | "monthly-pay"
  | "review-order"
  | "stated-hourly";

export function sortJobs(
  jobs: JobListItem[],
  fx: FxData,
  sort: JobSort,
  scoreOf?: (job: JobListItem) => number | null
): JobListItem[] {
  if (sort === "review-order") {
    return jobs;
  }
  if (sort === "match-score") {
    return jobs
      .map((job, index) => ({
        index,
        job,
        monthly: monthlyCompensationUsd(job.compensation, fx) ?? null,
        score: scoreOf?.(job) ?? null,
      }))
      .toSorted((first, second) => {
        const primary = compareDescending(first.score, second.score);
        if (primary !== 0) {
          return primary;
        }
        const secondary = compareDescending(first.monthly, second.monthly);
        return secondary === 0 ? first.index - second.index : secondary;
      })
      .map((entry) => entry.job);
  }
  return jobs
    .map((job, index) => {
      const listedHourly = listedHourlyValueUsd(job.compensation, fx);
      return {
        hourly:
          job.statedHourly?.minimum ??
          job.statedHourly?.maximum ??
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
