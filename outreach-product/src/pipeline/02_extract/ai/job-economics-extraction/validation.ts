import type { z } from "zod";
import type { StatedHourlyBasisSchema } from "../../../../features/jobs/economics";
import type { ProviderJobEconomics } from "./model";

export function supportedWorkload(
  value: ProviderJobEconomics["workload"],
  source: string,
  reviewNotes: string[]
) {
  if (!value) {
    return null;
  }
  if (value.minimum === null && value.maximum === null) {
    reviewNotes.push("Workload was excluded because it had no stated bounds.");
    return null;
  }
  const evidence = supportedWorkloadEvidence(value.evidence, source);
  if (!evidence) {
    reviewNotes.push("Workload evidence was not present in the listing.");
    return null;
  }
  const normalizedEvidence = evidence
    .join("\n")
    .normalize("NFKC")
    .toLocaleLowerCase("en");
  if (unsupportedClassPeriod(value.basis, normalizedEvidence)) {
    reviewNotes.push(
      "Workload was excluded because class periods had no stated duration."
    );
    return null;
  }
  normalizeWorkloadPeriod(value, normalizedEvidence, reviewNotes);
  if (hasInvalidWorkloadBounds(value)) {
    reviewNotes.push("Workload contained invalid bounds.");
    return null;
  }
  return { ...value, evidence };
}

function supportedWorkloadEvidence(evidence: string[], source: string) {
  const supported = evidence
    .map((item) => item.trim())
    .filter((item) => item && source.includes(item))
    .slice(0, 3);
  return supported.length === evidence.length && supported.length > 0
    ? supported
    : null;
}

function normalizeWorkloadPeriod(
  value: NonNullable<ProviderJobEconomics["workload"]>,
  evidence: string,
  reviewNotes: string[]
) {
  if (
    value.basis === "onsite" &&
    value.period === "week" &&
    !supportsWeeklyOnsiteHours(evidence)
  ) {
    reviewNotes.push(
      "On-site workload period was excluded because the evidence did not state a weekly total or the workdays."
    );
    value.period = null;
    return;
  }
  if (value.period && !supportsWorkloadPeriod(value.period, evidence)) {
    reviewNotes.push(
      "Workload period was excluded because its evidence did not state the selected period."
    );
    value.period = null;
  }
}

function hasInvalidWorkloadBounds(
  value: NonNullable<ProviderJobEconomics["workload"]>
) {
  let maximumHours = 10_000;
  if (value.period === "day") {
    maximumHours = 24;
  } else if (value.period === "week") {
    maximumHours = 168;
  } else if (value.period === "fortnight") {
    maximumHours = 336;
  } else if (value.period === "month") {
    maximumHours = 744;
  }
  return (
    (value.minimum !== null && value.minimum <= 0) ||
    (value.maximum !== null && value.maximum <= 0) ||
    (value.minimum !== null && value.minimum > maximumHours) ||
    (value.maximum !== null && value.maximum > maximumHours) ||
    (value.minimum !== null &&
      value.maximum !== null &&
      value.minimum > value.maximum)
  );
}

function unsupportedClassPeriod(
  basis: z.infer<typeof StatedHourlyBasisSchema>,
  evidence: string
) {
  if (basis !== "teaching") {
    return false;
  }
  const mentionsClassPeriod = ["classes", "class period", "lesson"].some(
    (term) => evidence.includes(term)
  );
  const statesDuration = [
    "minute",
    " min",
    "hour-long",
    "hour each",
    "hours each",
    " hr",
  ].some((term) => evidence.includes(term));
  return mentionsClassPeriod && !statesDuration;
}

function supportsWorkloadPeriod(
  period: "contract" | "day" | "fortnight" | "month" | "week",
  evidence: string
) {
  let terms = ["contract", "term", "between", "academic year", "school year"];
  if (period === "day") {
    terms = ["per day", "/day", "/ day", "daily", "each day", "a day"];
  } else if (period === "fortnight") {
    terms = ["per fortnight", "/fortnight", "/ fortnight", "fortnightly"];
  } else if (period === "month") {
    terms = ["per month", "/month", "/ month", "monthly", "each month"];
  } else if (period === "week") {
    terms = [
      "per week",
      "per-week",
      "/week",
      "/ week",
      "weekly",
      "each week",
      "a week",
      " pw",
      "p/w",
      "per wk",
      "/wk",
      "-day week",
      "monday",
      "monday-friday",
      "monday - friday",
      "mon-fri",
      "mon - fri",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
      "weekdays",
      "weekends",
    ];
  }
  return terms.some((term) => evidence.includes(term));
}

function supportsWeeklyOnsiteHours(evidence: string) {
  return [
    "monday",
    "monday-friday",
    "monday - friday",
    "mon-fri",
    "mon - fri",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "weekdays",
    "weekends",
    "working week",
    "work week",
    "days per week",
    "days a week",
    "-day week",
    "hours per week",
    "hours a week",
  ].some((term) => evidence.includes(term));
}
