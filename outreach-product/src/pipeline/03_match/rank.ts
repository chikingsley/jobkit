export interface RankableJob {
  amountMaximum: number | null;
  amountMinimum: number | null;
  benefits: string[];
  board: string;
  company: string;
  country: string;
  currency: string | null;
  id: string;
  location: string;
  period: string | null;
  teachingHours: number | null;
  title: string;
}

export interface RankedJob extends RankableJob {
  benefits: string[];
  duplicateOf: string[];
  monthlyUsd: number;
  perHourUsd: number | null;
}

export const CREDIBLE_WEEKLY_HOURS = 40;
export const CREDIBLE_MONTHLY_USD_CEILING = 25_000;
const WEEKS_PER_MONTH = 4.33;
const MONTHS_PER_YEAR = 12;
const ASSUMED_WEEKLY_HOURS = 20;

export function normalizeBenefits(benefits: string[]): string[] {
  return [...new Set(benefits.filter(Boolean))].sort();
}

export function credibleTeachingHours(hours: number | null): number | null {
  if (hours === null || hours <= 0 || hours > CREDIBLE_WEEKLY_HOURS) {
    return null;
  }
  return hours;
}

export function monthlyAmount(job: RankableJob): number | null {
  const low = job.amountMinimum;
  if (low === null || low <= 0) {
    return null;
  }
  const high =
    job.amountMaximum !== null && job.amountMaximum >= low
      ? job.amountMaximum
      : low;
  const midpoint = (low + high) / 2;
  if (job.period === "year") {
    return midpoint / MONTHS_PER_YEAR;
  }
  if (job.period === "week") {
    return midpoint * WEEKS_PER_MONTH;
  }
  if (job.period === "hour") {
    const hours =
      credibleTeachingHours(job.teachingHours) ?? ASSUMED_WEEKLY_HOURS;
    return midpoint * hours * WEEKS_PER_MONTH;
  }
  return midpoint;
}

function duplicateKey(job: RankableJob, monthlyUsd: number) {
  return [
    job.company.trim().toLocaleLowerCase("en"),
    job.country.trim().toLocaleLowerCase("en"),
    Math.round(monthlyUsd / 50),
  ].join("|");
}

export function rankJobs(
  jobs: RankableJob[],
  rates: Record<string, number>
): RankedJob[] {
  const priced: RankedJob[] = [];
  for (const job of jobs) {
    const rate = rates[job.currency ?? ""];
    const monthly = monthlyAmount(job);
    if (!rate || monthly === null) {
      continue;
    }
    const monthlyUsd = Math.round(monthly * rate);
    if (monthlyUsd <= 0 || monthlyUsd > CREDIBLE_MONTHLY_USD_CEILING) {
      continue;
    }
    const hours = credibleTeachingHours(job.teachingHours);
    priced.push({
      ...job,
      benefits: normalizeBenefits(job.benefits),
      duplicateOf: [],
      monthlyUsd,
      perHourUsd: hours
        ? Math.round(monthlyUsd / (hours * WEEKS_PER_MONTH))
        : null,
    });
  }
  priced.sort((first, second) => {
    if (second.monthlyUsd !== first.monthlyUsd) {
      return second.monthlyUsd - first.monthlyUsd;
    }
    return first.id.localeCompare(second.id);
  });
  const kept: RankedJob[] = [];
  const byKey = new Map<string, RankedJob>();
  for (const job of priced) {
    const key = duplicateKey(job, job.monthlyUsd);
    const existing = byKey.get(key);
    if (existing && job.company.trim() !== "") {
      existing.duplicateOf.push(job.id);
      continue;
    }
    byKey.set(key, job);
    kept.push(job);
  }
  return kept;
}
