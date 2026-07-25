import { z } from "zod";
import {
  CompensationKindSchema,
  CompensationQualifierSchema,
  PayPeriodSchema,
  StatedHourlyBasisSchema,
  TaxBasisSchema,
  WorkloadPeriodSchema,
} from "../../../../features/jobs/economics";

export const ProviderWorkloadSchema = z
  .object({
    basis: StatedHourlyBasisSchema,
    evidence: z.array(z.string()),
    maximum: z.number().nullable(),
    minimum: z.number().nullable(),
    period: WorkloadPeriodSchema.nullable(),
  })
  .nullable();

export const ProviderJobEconomicsSchema = z
  .object({
    compensation: z
      .object({
        amountMaximum: z.number().nullable(),
        amountMinimum: z.number().nullable(),
        currency: z.string().nullable(),
        evidence: z.array(z.string()),
        kind: CompensationKindSchema,
        period: PayPeriodSchema.nullable(),
        qualifier: CompensationQualifierSchema.nullable(),
        taxBasis: TaxBasisSchema,
      })
      .strict(),
    workload: ProviderWorkloadSchema,
  })
  .strict();

export const JOB_ECONOMICS_INSTRUCTIONS = `

Economics extraction:
- Extract the primary recurring cash compensation. Repair a truncated salary field such as "CNY25" or "RMB 20" only when the description or title explicitly gives the complete amount.
- When the supplied Salary field contains the complete recurring pay statement, use that exact field as compensation evidence so its amount, qualifier, currency, and period remain linked.
- Normalize RMB to CNY and Polish zł or zl to PLN, and use three-letter currency codes. Leave currency null when it is genuinely absent.
- Combine explicitly additive recurring cash amounts into the compensation total only when the listing makes clear they are paid in addition to base salary. Exclude one-time completion, renewal, signing, performance, flight, holiday, and housing allowances or payments. Keep every form of housing separate from cash compensation so the UI can show + housing, + housing allowance, or + housing help. Never assign a cash value to provided housing.
- A recurring living or cost-of-living allowance is cash compensation unless the listing explicitly identifies it as housing or accommodation. Do not classify meals, transportation, utilities, or a generic living allowance as housing.
- If an allowance is explicitly already included in the salary, do not add it again.
- Use taxBasis net or gross only when the listing says so. Otherwise use unspecified. Do not estimate taxes.
- Use amount whenever a numeric pay amount is stated. A range such as "900-1300 depending on experience" is an amount range, not negotiable. A numeric amount followed by "(Negotiable)" also remains amount. Use negotiable only when the listing explicitly says pay is negotiable and gives no numeric amount, unstated when there is no usable pay statement, and conflict when the listing gives irreconcilable pay facts. Descriptions such as "competitive salary" without an amount are unstated, not negotiable.
- Select hour, day, week, fortnight, month, year, or contract only when the listing explicitly states that pay period. Treat "pw" as per week, "per annum" as per year, and a statement such as "in a typical month, teachers average 1600 euros" as monthly pay. Contract means a total payment for a stated contract or term rather than an annual salary. Include the words that support the period in compensation evidence. Leave period null rather than inferring it from the role or market.
- For an exact amount, set amountMinimum to the amount, amountMaximum null, and qualifier exact. For a range, set both bounds and qualifier range. For "from", set only amountMinimum. For "up to", set only amountMaximum.
- Extract one stated workload denominator that matches the selected compensation. Preserve whether the listing explicitly states it per week, per month, or for the whole contract; leave the workload period null when the source does not say. Prefer required on-site hours when stated; otherwise combine stated teaching and office hours; otherwise use stated teaching hours. Use null when none is stated safely.
- When both total compensation and total hours are stated for the same contract or term, use contract for both periods. For example, EUR 17,002 for 748 teaching hours is contract compensation with a 748-hour contract workload; keep an extra holiday payment separate.
- When the same pay is presented both as a contract total and as a complete periodic equivalent, prefer the periodic amount when the listing also states a workload for that same period. For example, prefer GBP 761.57 per week with 15 teaching hours per week over an undenominated summer total.
- A maximum workload such as "up to 20 hours" has minimum null and maximum 20. An exact workload has equal minimum and maximum. A range has both bounds.
- Convert class periods to clock hours only when the listing states the period duration. For example, twenty 45-minute classes equal 15 teaching hours. Do not assume a period length that is not stated.
- Calculate required on-site hours from an explicit schedule when the workdays and daily start/end times are stated. For example, Monday through Friday from 8:00 to 4:30 is 42.5 on-site hours per week. Subtract a break only when the listing explicitly says the break is free time.
- When on-site hours are calculated from daily times, include the stated workdays in workload evidence. A daily schedule without the number of workdays is not a weekly workload.
- Preserve a stated monthly workload as monthly. For example, 100 teaching hours per month is 100 hours with period month; do not convert it to 25 hours per week.
- For a listing with several positions, use compensation and workload from the same clearly scoped position. Never combine the salary from one position with the schedule from another. Leave workload null when it cannot be linked safely.
- Use basis onsite for required on-site time, teaching-plus-office when those two stated categories were added, and teaching when only teaching hours are available.
- Every compensation and workload fact needs a short exact continuous quote from the supplied source in evidence. Use an empty evidence array only for unstated compensation.`;

export type ProviderJobEconomics = z.infer<typeof ProviderJobEconomicsSchema>;
