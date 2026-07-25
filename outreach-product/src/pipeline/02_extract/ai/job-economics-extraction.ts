import {
  type JobEconomics,
  JobEconomicsSchema,
} from "../../../features/jobs/economics";
import {
  isAsciiDigit,
  normalizeCurrency,
} from "./job-economics-extraction/currency";
import type { ProviderJobEconomics } from "./job-economics-extraction/model";
import { supportedWorkload } from "./job-economics-extraction/validation";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export {
  JOB_ECONOMICS_INSTRUCTIONS,
  ProviderJobEconomicsSchema,
} from "./job-economics-extraction/model";

export function normalizeExtractedEconomics(
  output: ProviderJobEconomics,
  source: string,
  reviewNotes: string[]
): JobEconomics {
  const compensationEvidence = output.compensation.evidence
    .map((value) => value.trim())
    .filter((value) => value && source.includes(value))
    .slice(0, 6);
  const compensation = normalizeCompensation(
    { ...output.compensation, evidence: compensationEvidence },
    reviewNotes
  );
  requireSupportedCurrency(compensation, reviewNotes);
  requireSupportedPeriod(compensation, reviewNotes);
  if (
    output.compensation.kind !== "unstated" &&
    compensationEvidence.length === 0
  ) {
    reviewNotes.push(
      "Compensation was excluded because its quoted evidence was not present in the listing."
    );
    compensation.kind = "unstated";
    compensation.amountMaximum = null;
    compensation.amountMinimum = null;
    compensation.currency = null;
    compensation.period = null;
    compensation.qualifier = null;
    compensation.taxBasis = "unspecified";
  }

  return JobEconomicsSchema.parse({
    compensation,
    workload: supportedWorkload(output.workload, source, reviewNotes),
  });
}

function requireSupportedCurrency(
  compensation: ReturnType<typeof normalizeCompensation>,
  reviewNotes: string[]
) {
  const { currency } = compensation;
  if (!(currency && compensation.kind === "amount")) {
    return;
  }
  const evidence = compensation.evidence
    .join("\n")
    .normalize("NFKC")
    .toLocaleLowerCase("en");
  const aliases: Record<string, string[]> = {
    AED: ["aed", "dirham"],
    ALL: ["all", "lek"],
    AZN: ["azn", "₼", "manat"],
    CNY: ["cny", "rmb", "yuan", "¥", "元"],
    CZK: ["czk", "koruna", "kč"],
    EUR: ["eur", "euro", "€"],
    GBP: ["gbp", "pound", "£"],
    GEL: ["gel", "lari", "₾"],
    HKD: ["hkd", "hk$", "hong kong dollar"],
    HUF: ["huf", "forint", "ft"],
    IDR: ["idr", "rupiah", "rp"],
    JPY: ["jpy", "yen", "¥", "円"],
    KRW: ["krw", "won", "₩"],
    KZT: ["kzt", "tenge", "₸"],
    MXN: ["mxn", "mxp", "peso", "mx$"],
    MYR: ["myr", "ringgit", "rm"],
    OMR: ["omr", "rial", "riyal"],
    PLN: ["pln", "zł", "zl", "zloty", "złoty"],
    RON: ["ron", "leu", "lei"],
    RUB: ["rub", "ruble", "rouble", "₽"],
    SAR: ["sar", "riyal", "rial"],
    SGD: ["sgd", "s$", "singapore dollar"],
    THB: ["thb", "baht", "฿"],
    TRY: ["try", "lira", "₺", "tl"],
    TWD: ["twd", "ntd", "nt$", "new taiwan dollar"],
    USD: ["usd", "dollar", "us$", "$"],
    VND: ["vnd", "dong", "₫", "đ"],
  };
  const terms = aliases[currency] ?? [currency.toLocaleLowerCase("en")];
  if (terms.some((term) => evidence.includes(term))) {
    return;
  }
  compensation.currency = null;
  reviewNotes.push(
    "Compensation currency was excluded because its quoted evidence did not state that currency."
  );
}

function requireSupportedPeriod(
  compensation: ReturnType<typeof normalizeCompensation>,
  reviewNotes: string[]
) {
  const { period } = compensation;
  if (!(period && compensation.kind === "amount")) {
    return;
  }
  const evidence = compensation.evidence
    .join("\n")
    .normalize("NFKC")
    .toLocaleLowerCase("en");
  const terms: Record<typeof period, string[]> = {
    contract: ["contract", "term", "between", "academic year", "school year"],
    day: ["per day", "/day", "/ day", "daily", "each day", "a day"],
    fortnight: ["per fortnight", "/fortnight", "/ fortnight", "fortnightly"],
    hour: [
      "per hour",
      "/hour",
      "/ hour",
      "per classroom hour",
      "/ classroom hour",
      "teaching hour",
      "contact hour",
      "hourly",
      "an hour",
      "each hour",
      "/hr",
      "/ hr",
    ],
    month: [
      "per month",
      "/month",
      "/ month",
      "monthly",
      "typical month",
      "in a month",
      "a month",
      "each month",
    ],
    week: [
      "per week",
      "per-week",
      "/week",
      "/ week",
      "weekly",
      "a week",
      "each week",
      " pw",
      "p/w",
      "per wk",
      "/wk",
    ],
    year: [
      "per year",
      "/year",
      "/ year",
      "yearly",
      "annual",
      "annually",
      "annum",
      "a year",
      "each year",
    ],
  };
  if (terms[period].some((term) => evidence.includes(term))) {
    return;
  }
  compensation.period = null;
  reviewNotes.push(
    "Compensation period was excluded because its quoted evidence did not state the selected period."
  );
}

function downgradePlaceholderAmounts(
  compensation: ProviderJobEconomics["compensation"],
  reviewNotes: string[]
) {
  let dropped = false;
  if (compensation.amountMinimum !== null && compensation.amountMinimum <= 0) {
    compensation.amountMinimum = null;
    dropped = true;
  }
  if (compensation.amountMaximum !== null && compensation.amountMaximum <= 0) {
    compensation.amountMaximum = null;
    dropped = true;
  }
  if (
    !dropped ||
    compensation.amountMinimum !== null ||
    compensation.amountMaximum !== null
  ) {
    return false;
  }
  reviewNotes.push(
    "Compensation stated a zero or placeholder amount; treated as unstated."
  );
  compensation.kind = "unstated";
  compensation.currency = null;
  compensation.period = null;
  compensation.qualifier = null;
  compensation.taxBasis = "unspecified";
  return true;
}

function normalizeAmountBounds(
  compensation: ProviderJobEconomics["compensation"]
) {
  const qualifier =
    compensation.qualifier ??
    (compensation.amountMinimum !== null && compensation.amountMaximum !== null
      ? "range"
      : "exact");
  compensation.qualifier = qualifier;
  if (qualifier === "exact" || qualifier === "from") {
    compensation.amountMinimum ??= compensation.amountMaximum;
    compensation.amountMaximum = null;
  } else if (qualifier === "up-to") {
    compensation.amountMaximum ??= compensation.amountMinimum;
    compensation.amountMinimum = null;
  }
}

function normalizeCompensation(
  value: ProviderJobEconomics["compensation"],
  reviewNotes: string[]
) {
  const compensation = {
    ...value,
    currency: normalizeCurrency(value.currency),
  };
  if (value.currency && !compensation.currency) {
    reviewNotes.push("Compensation used an invalid currency code.");
  }
  if (
    compensation.kind === "negotiable" &&
    compensation.evidence.join("\n").split("").some(isAsciiDigit)
  ) {
    compensation.kind = "conflict";
    reviewNotes.push(
      "Numeric compensation was marked for review because it was classified as negotiable."
    );
  }
  if (compensation.kind !== "amount") {
    compensation.amountMaximum = null;
    compensation.amountMinimum = null;
    compensation.currency = null;
    compensation.period = null;
    compensation.qualifier = null;
    compensation.taxBasis = "unspecified";
    return compensation;
  }

  if (downgradePlaceholderAmounts(compensation, reviewNotes)) {
    return compensation;
  }

  normalizeAmountBounds(compensation);
  if (
    compensation.amountMinimum === null &&
    compensation.amountMaximum === null
  ) {
    compensation.kind = "conflict";
    reviewNotes.push("Compensation was marked as an amount without a value.");
  } else if (
    compensation.amountMinimum !== null &&
    compensation.amountMaximum !== null &&
    compensation.amountMinimum > compensation.amountMaximum
  ) {
    compensation.kind = "conflict";
    compensation.amountMaximum = null;
    compensation.amountMinimum = null;
    reviewNotes.push("Compensation contained reversed range bounds.");
  }
  return compensation;
}
