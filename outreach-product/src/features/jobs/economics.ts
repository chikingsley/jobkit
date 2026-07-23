import { z } from "zod";

export interface Compensation {
  amountMax: number | null;
  amountMin: number | null;
  confidence: "exact" | "inferred" | "conflict" | "unknown";
  currency: string | null;
  display: string;
  notes: string[];
  period:
    | "contract"
    | "day"
    | "fortnight"
    | "hour"
    | "week"
    | "month"
    | "year"
    | null;
  qualifier: "exact" | "range" | "up-to" | "from" | null;
  source:
    | "listing-field"
    | "listing-description"
    | "curated-review"
    | "unknown";
}

export interface FxData {
  rates: Record<string, number>;
  updatedAt: string | null;
}

export const CompensationKindSchema = z.enum([
  "amount",
  "conflict",
  "negotiable",
  "unstated",
]);
export const CompensationQualifierSchema = z.enum([
  "exact",
  "from",
  "range",
  "up-to",
]);
export const PayPeriodSchema = z.enum([
  "contract",
  "day",
  "fortnight",
  "hour",
  "week",
  "month",
  "year",
]);
export const TaxBasisSchema = z.enum(["gross", "net", "unspecified"]);
export const StatedHourlyBasisSchema = z.enum([
  "onsite",
  "teaching",
  "teaching-plus-office",
]);
export const WorkloadPeriodSchema = z.enum([
  "contract",
  "day",
  "fortnight",
  "week",
  "month",
]);

export const StatedWorkloadSchema = z
  .object({
    basis: StatedHourlyBasisSchema,
    evidence: z.array(z.string().min(1).max(1200)).min(1).max(3),
    maximum: z.number().positive().max(10_000).nullable(),
    minimum: z.number().positive().max(10_000).nullable(),
    period: WorkloadPeriodSchema.nullable(),
  })
  .strict()
  .refine((value) => value.minimum !== null || value.maximum !== null, {
    message: "A stated workload needs at least one bound",
  })
  .refine(
    (value) =>
      value.period !== "week" ||
      ((value.minimum ?? 0) <= 168 && (value.maximum ?? 0) <= 168),
    {
      message: "A weekly workload cannot exceed 168 hours",
    }
  );

export const JobEconomicsSchema = z
  .object({
    compensation: z
      .object({
        amountMaximum: z.number().positive().max(1_000_000_000).nullable(),
        amountMinimum: z.number().positive().max(1_000_000_000).nullable(),
        currency: z.string().length(3).nullable(),
        evidence: z.array(z.string().min(1).max(1200)).max(6),
        kind: CompensationKindSchema,
        period: PayPeriodSchema.nullable(),
        qualifier: CompensationQualifierSchema.nullable(),
        taxBasis: TaxBasisSchema,
      })
      .strict(),
    workload: StatedWorkloadSchema.nullable(),
  })
  .strict();

export type JobEconomics = z.infer<typeof JobEconomicsSchema>;
export type StatedWorkload = z.infer<typeof StatedWorkloadSchema>;

export type StatedHourlyBasis =
  | "listed"
  | z.infer<typeof StatedHourlyBasisSchema>;

export interface StatedHourlyValue {
  basis: StatedHourlyBasis;
  currency: string;
  maximum: number | null;
  minimum: number | null;
  taxBasis: z.infer<typeof TaxBasisSchema>;
}

export function statedHourlyValue(
  economics: JobEconomics
): StatedHourlyValue | null {
  const pay = economics.compensation;
  if (
    pay.kind !== "amount" ||
    !pay.currency ||
    !(pay.amountMinimum || pay.amountMaximum) ||
    !pay.period
  ) {
    return null;
  }
  if (pay.period === "hour") {
    const { amountMaximum, amountMinimum } = pay;
    return {
      basis: "listed",
      currency: pay.currency,
      maximum: amountMaximum ?? amountMinimum,
      minimum: amountMinimum ?? null,
      taxBasis: pay.taxBasis,
    };
  }

  const { workload } = economics;
  if (!workload?.period) {
    return null;
  }
  const multipliers = periodMultipliers(pay.period, workload.period);
  if (!multipliers) {
    return null;
  }
  const { payMultiplier, workloadMultiplier } = multipliers;
  const { amountMaximum, amountMinimum } = pay;
  const minimum = hourlyBound(
    amountMinimum,
    workload.maximum,
    payMultiplier,
    workloadMultiplier
  );
  const maximum = hourlyBound(
    amountMaximum ?? amountMinimum,
    workload.minimum,
    payMultiplier,
    workloadMultiplier
  );
  if (!(minimum || maximum)) {
    return null;
  }
  return {
    basis: workload.basis,
    currency: pay.currency,
    maximum,
    minimum,
    taxBasis: pay.taxBasis,
  };
}

function hourlyBound(
  amount: number | null,
  workload: number | null,
  payMultiplier: number,
  workloadMultiplier: number
) {
  return amount && workload
    ? (amount * payMultiplier) / (workload * workloadMultiplier)
    : null;
}

export function statedHourlyUsd(
  economics: JobEconomics,
  fx: FxData
): number | null {
  const hourly = statedHourlyValueUsd(economics, fx);
  return hourly ? (hourly.minimum ?? hourly.maximum ?? null) : null;
}

export function statedHourlyValueUsd(
  economics: JobEconomics,
  fx: FxData
): StatedHourlyValue | null {
  const hourly = statedHourlyValue(economics);
  const rate = hourly ? fx.rates[hourly.currency] : undefined;
  if (!(hourly && rate)) {
    return null;
  }
  return {
    ...hourly,
    currency: "USD",
    maximum: hourly.maximum === null ? null : hourly.maximum / rate,
    minimum: hourly.minimum === null ? null : hourly.minimum / rate,
  };
}

export function listedHourlyValueUsd(
  compensation: Compensation,
  fx: FxData
): StatedHourlyValue | null {
  if (
    compensation.period !== "hour" ||
    !compensation.currency ||
    !(compensation.amountMin || compensation.amountMax) ||
    compensation.confidence === "conflict"
  ) {
    return null;
  }
  const rate = fx.rates[compensation.currency];
  if (!rate) {
    return null;
  }
  return {
    basis: "listed",
    currency: "USD",
    maximum:
      compensation.amountMax === null ? null : compensation.amountMax / rate,
    minimum:
      compensation.amountMin === null ? null : compensation.amountMin / rate,
    taxBasis: "unspecified",
  };
}

export function formatStatedHourly(value: StatedHourlyValue): string {
  const minimum = value.minimum ? rounded(value.minimum) : null;
  const maximum = value.maximum ? rounded(value.maximum) : null;
  let amount = "";
  if (minimum !== null && maximum !== null && minimum !== maximum) {
    amount = `${minimum.toLocaleString()}–${maximum.toLocaleString()}`;
  } else if (minimum !== null && maximum === null) {
    amount = `≥ ${minimum.toLocaleString()}`;
  } else if (maximum !== null && minimum === null) {
    amount = `≤ ${maximum.toLocaleString()}`;
  } else {
    amount = (minimum ?? maximum ?? 0).toLocaleString();
  }
  const tax = value.taxBasis === "unspecified" ? "" : ` (${value.taxBasis})`;
  return `${value.currency} ${amount}/${basisLabel(value.basis)} hr${tax}`;
}

export function formatStatedHourlyUsd(value: StatedHourlyValue): string {
  const minimum = value.minimum ? rounded(value.minimum) : null;
  const maximum = value.maximum ? rounded(value.maximum) : null;
  let amount = "";
  if (minimum !== null && maximum !== null && minimum !== maximum) {
    amount = `${formatUsd(minimum)}–${formatUsd(maximum)}`;
  } else if (minimum !== null && maximum === null) {
    amount = `≥ ${formatUsd(minimum)}`;
  } else if (maximum !== null && minimum === null) {
    amount = `≤ ${formatUsd(maximum)}`;
  } else {
    amount = formatUsd(minimum ?? maximum ?? 0);
  }
  const tax = value.taxBasis === "unspecified" ? "" : ` (${value.taxBasis})`;
  return `${amount} USD/${basisLabel(value.basis)} hr${tax}`;
}

export function housingLabel(
  benefits: Array<{ evidence?: string; level: string; value: string }>,
  economics?: JobEconomics
): string | null {
  const compensationIncludesHousingAllowance = housingAllowanceIncluded(
    economics?.compensation.evidence.join("\n") ?? ""
  );
  const housing = benefits.filter(
    (benefit) =>
      benefit.value === "housing" &&
      !(
        benefit.level === "allowance" &&
        (compensationIncludesHousingAllowance ||
          housingAllowanceIncluded(benefit.evidence ?? ""))
      )
  );
  if (housing.some((benefit) => benefit.level === "provided")) {
    return "+ housing";
  }
  if (housing.some((benefit) => benefit.level === "allowance")) {
    return "+ housing allowance";
  }
  return housing.length > 0 ? "+ housing help" : null;
}

function housingAllowanceIncluded(value: string) {
  const compact = value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replaceAll(" ", "")
    .replaceAll("\n", "");
  return compact.includes("housingallowance") && compact.includes("included");
}

export function compensationFromEconomics(
  economics: JobEconomics
): Compensation {
  const pay = economics.compensation;
  if (pay.kind === "negotiable") {
    return {
      ...emptyCompensation(),
      confidence: "exact",
      display: "Negotiable",
      source: "listing-description",
    };
  }
  if (pay.kind === "conflict") {
    return {
      ...emptyCompensation(),
      confidence: "conflict",
      display: "Compensation needs review",
      notes: pay.evidence,
      source: "listing-description",
    };
  }
  if (pay.kind !== "amount") {
    return emptyCompensation();
  }
  const { amountMaximum, amountMinimum } = pay;
  const notes =
    pay.taxBasis === "unspecified"
      ? []
      : [`The listing states this as ${pay.taxBasis} pay.`];
  return {
    amountMax: amountMaximum === amountMinimum ? null : (amountMaximum ?? null),
    amountMin: amountMinimum,
    confidence: pay.currency && pay.period ? "exact" : "inferred",
    currency: pay.currency,
    display: formatCompensation(pay),
    notes,
    period: pay.period,
    qualifier: pay.qualifier,
    source: "listing-description",
  };
}

function basisLabel(value: StatedHourlyBasis) {
  if (value === "teaching-plus-office") {
    return "teaching + office";
  }
  return value;
}

function rounded(value: number) {
  return value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
}

function formatUsd(value: number) {
  return value.toLocaleString("en-US", {
    currency: "USD",
    maximumFractionDigits: value < 100 ? 1 : 0,
    minimumFractionDigits: 0,
    style: "currency",
  });
}

function annualPayMultiplier(period: "fortnight" | "month" | "week" | "year") {
  if (period === "week") {
    return 52;
  }
  if (period === "fortnight") {
    return 26;
  }
  return period === "month" ? 12 : 1;
}

function annualWorkloadMultiplier(period: "fortnight" | "month" | "week") {
  if (period === "week") {
    return 52;
  }
  return period === "fortnight" ? 26 : 12;
}

function periodMultipliers(
  payPeriod: "contract" | "day" | "fortnight" | "month" | "week" | "year",
  workloadPeriod: "contract" | "day" | "fortnight" | "month" | "week"
) {
  if (
    payPeriod === "contract" ||
    workloadPeriod === "contract" ||
    payPeriod === "day" ||
    workloadPeriod === "day"
  ) {
    return payPeriod === workloadPeriod
      ? { payMultiplier: 1, workloadMultiplier: 1 }
      : null;
  }
  return {
    payMultiplier: annualPayMultiplier(payPeriod),
    workloadMultiplier: annualWorkloadMultiplier(workloadPeriod),
  };
}

function formatCompensation(pay: JobEconomics["compensation"]): string {
  const minimum = pay.amountMinimum?.toLocaleString("en-US") ?? "";
  const maximum = pay.amountMaximum?.toLocaleString("en-US") ?? "";
  const amount =
    minimum && maximum && minimum !== maximum
      ? `${minimum}–${maximum}`
      : minimum || maximum;
  let prefix = "";
  if (pay.qualifier === "from") {
    prefix = "From ";
  } else if (pay.qualifier === "up-to") {
    prefix = "Up to ";
  }
  return `${prefix}${amount}${pay.currency ? ` ${pay.currency}` : ""}${pay.period ? `/${pay.period}` : ""}`;
}

function emptyCompensation(): Compensation {
  return {
    amountMax: null,
    amountMin: null,
    confidence: "unknown",
    currency: null,
    display: "Salary not listed",
    notes: [],
    period: null,
    qualifier: null,
    source: "unknown",
  };
}
