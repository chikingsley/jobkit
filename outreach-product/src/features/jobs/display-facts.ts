import type { JobMatch, JobMatchSummary } from "../../profile-types";
import { compensationDisplay } from "./compensation";
import {
  formatStatedHourlyUsd,
  housingLabel,
  listedHourlyValueUsd,
  type StatedHourlyValue,
  statedHourlyValueUsd,
} from "./economics";
import { humanize } from "./format";
import type { FxData, Job, JobListItem } from "./types";

type DisplayJob = Job | JobListItem;

export interface JobDisplayFacts {
  applicationState: string | null;
  compensationPrimary: string;
  compensationSecondary: string[];
  compensationWarning: string | null;
  employer: string;
  location: string;
  matchSummary: string;
  positionSummary: string | null;
}

export function createJobDisplayFacts(
  job: DisplayJob,
  fx: FxData,
  match?: JobMatch | JobMatchSummary
): JobDisplayFacts {
  const compensation = compensationDisplay(job.compensation, fx);
  const matchCounts = match ? matchRequirementCounts(match) : null;
  const positionCount =
    "positionCount" in job
      ? job.positionCount
      : (job.positionAnalysis?.positions.length ?? 0);
  const matchSummary = analysisMatchSummary(job, match, matchCounts);
  const secondary = [
    compensation.usd && compensation.primary !== compensation.usd
      ? compensation.primary
      : null,
    hourlySummary(job, fx),
    housingSummary(job),
  ].filter((value): value is string => Boolean(value));

  return {
    applicationState: applicationState(job),
    compensationPrimary: compensation.usd ?? compensation.primary,
    compensationSecondary: [...new Set(secondary)],
    compensationWarning: compensation.warning,
    employer: job.company || "Employer name unavailable",
    location: locationSummary(job),
    matchSummary,
    positionSummary:
      positionCount > 1 ? `${positionCount.toLocaleString()} positions` : null,
  };
}

function matchRequirementCounts(match: JobMatch | JobMatchSummary) {
  if ("criteria" in match) {
    const requirements = match.criteria.filter(
      (criterion) =>
        criterion.importance !== undefined &&
        criterion.visibility !== "internal"
    );
    return {
      confirmed: requirements.filter((item) => item.state === "match").length,
      total: requirements.length,
    };
  }
  return {
    confirmed: match.confirmedRequirements,
    total: match.totalRequirements,
  };
}

function analysisMatchSummary(
  job: DisplayJob,
  match: JobMatch | JobMatchSummary | undefined,
  counts: { confirmed: number; total: number } | null
) {
  if (job.analysisStatus.matchFacts === "pending") {
    return "Analysis pending";
  }
  if (job.analysisStatus.matchFacts === "stale") {
    return "Analysis refreshing";
  }
  if (counts && counts.total > 0) {
    return `${counts.confirmed} of ${counts.total} requirements match`;
  }
  return match?.label ?? "Profile match pending";
}

function locationSummary(job: DisplayJob) {
  const values = [job.location, job.country]
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    values.length === 2 &&
    values[0]
      ?.toLocaleLowerCase("en")
      .includes(values[1]?.toLocaleLowerCase("en") ?? "")
  ) {
    return values[0] ?? "Location unavailable";
  }
  return [...new Set(values)].join(" · ") || "Location unavailable";
}

function hourlySummary(job: DisplayJob, fx: FxData) {
  let hourly: StatedHourlyValue | null = null;
  if ("matchFacts" in job && job.matchFacts) {
    hourly = statedHourlyValueUsd(job.matchFacts.economics, fx);
  } else if ("statedHourly" in job) {
    hourly = job.statedHourly;
  }
  const value = hourly ?? listedHourlyValueUsd(job.compensation, fx);
  return value ? formatStatedHourlyUsd(value) : null;
}

function housingSummary(job: DisplayJob) {
  if ("housing" in job) {
    return job.housing;
  }
  return housingLabel(
    job.matchFacts?.benefits ?? [],
    job.matchFacts?.economics
  );
}

function applicationState(job: DisplayJob) {
  const attempt = job.emailAttempt;
  if (
    attempt?.sendRequestedAt &&
    ["approved", "claimed", "drafted", "sending"].includes(attempt.status)
  ) {
    return "Email sending";
  }
  if (attempt) {
    return `Email ${humanize(attempt.status)}`;
  }
  return ["new", "review"].includes(job.status) ? null : humanize(job.status);
}
