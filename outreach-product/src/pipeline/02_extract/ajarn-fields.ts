import type { SourceFields } from "./anesl-fields";

const SALARY_PATTERN =
  /(?:at least\s+)?([฿$€£¥₩])?\s?([\d,]+(?:\.\d+)?)\s*([A-Z]{3})?\s*\/\s*(hour|day|week|month|year)/iu;
const FULL_TIME = /\(full time\)/iu;
const PART_TIME = /\(part time\)/iu;
const AT_LEAST = /at least/iu;
const SYMBOL_CURRENCY: Record<string, string> = {
  $: "USD",
  "£": "GBP",
  "£GBP": "GBP",
  "¥": "JPY",
  "฿": "THB",
  "₩": "KRW",
  "€": "EUR",
};

export interface ExtractedAjarnFacts {
  compensation: {
    amountMaximum: null;
    amountMinimum: number;
    currency: string;
    evidence: string[];
    kind: "amount";
    period: string;
    qualifier: "from" | null;
    taxBasis: "unspecified";
  } | null;
  employmentTypes: { evidence: string; value: "fullTime" | "partTime" }[];
}

function employmentTypes(stated: string) {
  if (FULL_TIME.test(stated)) {
    return [{ evidence: stated, value: "fullTime" as const }];
  }
  return PART_TIME.test(stated)
    ? [{ evidence: stated, value: "partTime" as const }]
    : [];
}

export function extractAjarnFacts(fields: SourceFields): ExtractedAjarnFacts {
  const stated = fields.source_salary?.trim() ?? "";
  if (!stated) {
    return { compensation: null, employmentTypes: [] };
  }
  const matched = SALARY_PATTERN.exec(stated);
  if (!(matched?.[2] && matched[4])) {
    return { compensation: null, employmentTypes: employmentTypes(stated) };
  }
  const amount = Number(matched[2].replaceAll(",", ""));
  const currency =
    matched[3]?.toUpperCase() ??
    (matched[1] ? SYMBOL_CURRENCY[matched[1]] : undefined);
  if (!(Number.isFinite(amount) && amount > 0 && currency)) {
    return { compensation: null, employmentTypes: employmentTypes(stated) };
  }
  return {
    compensation: {
      amountMaximum: null,
      amountMinimum: amount,
      currency,
      evidence: [stated],
      kind: "amount",
      period: matched[4].toLowerCase(),
      qualifier: AT_LEAST.test(stated) ? "from" : null,
      taxBasis: "unspecified",
    },
    employmentTypes: employmentTypes(stated),
  };
}
