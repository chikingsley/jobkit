import type {
  PublicJobDetailResponse,
  PublicJobListItem,
} from "../../../worker/public-jobs/schemas";

type PublicJob = PublicJobListItem | PublicJobDetailResponse;

const employmentLabels = {
  contract: "Contract",
  fullTime: "Full-time",
  partTime: "Part-time",
} as const;

const workplaceLabels = {
  hybrid: "Hybrid",
  onsite: "On-site",
  remote: "Remote",
} as const;

const periodLabels = {
  contract: "contract",
  day: "day",
  fortnight: "fortnight",
  hour: "hour",
  month: "month",
  week: "week",
  year: "year",
} as const;

export function publicJobLocation(job: PublicJob) {
  return unique(job.locations.map(({ displayName }) => displayName)).join(
    " · "
  );
}

export function publicJobEmployment(job: PublicJob) {
  const employment: string[] = job.employmentTypes.map(
    (type) => employmentLabels[type]
  );
  employment.push(workplaceLabels[job.workplaceType]);
  return unique(employment).join(" · ");
}

export function publicJobCompensation(job: PublicJob) {
  const { compensation } = job;
  if (compensation === null || compensation.kind === "unstated") {
    return "Compensation not listed";
  }
  if (compensation.kind === "negotiable") {
    return "Compensation negotiable";
  }
  if (compensation.kind === "conflict") {
    return "Compensation varies by source";
  }
  const { amount } = compensation;
  if (amount === null) {
    return "Compensation not listed";
  }
  const range = formatMoneyRange({
    currency: amount.currency,
    maximum: amount.maximum,
    minimum: amount.minimum,
  });
  return `${range} per ${periodLabels[amount.period]}`;
}

export function publicJobHourlyUsd(job: PublicJob) {
  const hourly = job.compensation?.hourlyUsd;
  if (hourly === null || hourly === undefined) {
    return null;
  }
  const amount = job.compensation?.amount;
  if (
    job.compensation?.kind === "amount" &&
    amount?.currency === "USD" &&
    amount.period === "hour" &&
    amount.minimum === hourly.minimum &&
    amount.maximum === hourly.maximum
  ) {
    return null;
  }
  return `${formatMoneyRange({
    currency: "USD",
    maximum: hourly.maximum,
    minimum: hourly.minimum,
  })} USD/hour`;
}

export function publicJobPosted(job: PublicJob) {
  if (job.datePosted === null) {
    return null;
  }
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${job.datePosted.value}T00:00:00.000Z`));
}

export function publicJobSourceLabel(job: PublicJob) {
  return unique(
    job.sources.map((source) => {
      if (source.name) {
        return source.name;
      }
      return source.url ? new URL(source.url).hostname : "Source";
    })
  ).join(" · ");
}

function formatMoneyRange(input: {
  currency: string;
  maximum: number | null;
  minimum: number | null;
}) {
  const formatter = new Intl.NumberFormat("en-US", {
    currency: input.currency,
    maximumFractionDigits: 0,
    style: "currency",
  });
  if (input.minimum !== null && input.maximum !== null) {
    return input.minimum === input.maximum
      ? formatter.format(input.minimum)
      : `${formatter.format(input.minimum)}–${formatter.format(input.maximum)}`;
  }
  if (input.minimum !== null) {
    return `From ${formatter.format(input.minimum)}`;
  }
  return `Up to ${formatter.format(input.maximum ?? 0)}`;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
