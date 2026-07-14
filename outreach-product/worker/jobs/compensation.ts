import type { Compensation } from "../../src/features/jobs/types";

const CURRENCY_CODE = "OMR|JPY|RMB|CNY|PLN|HUF|EUR|USD";
const LABELED_PAY_PATTERN = /(?:salary|pay rates?)\s*:\s*([^.;\n]{1,120})/i;
const MONEY_PATTERN = new RegExp(
  `(?:\\b(up to|from)\\s+)?(?:([$€¥])|(\\b(?:${CURRENCY_CODE})\\b))?\\s*([\\d,]+)(?:\\s*[–-]\\s*([\\d,]+)\\+?)?\\s*(\\b(?:${CURRENCY_CODE})\\b)?`,
  "i"
);
const NEGOTIABLE_PATTERN = /\bnegotiable\b/i;

interface Candidate {
  amountMax: number | null;
  amountMin: number | null;
  currency: string | null;
  period: Compensation["period"];
  qualifier: Compensation["qualifier"];
}

export function normalizeCompensation(input: {
  description: string;
  salary: string;
}): Compensation {
  const salary = input.salary.trim();
  if (NEGOTIABLE_PATTERN.test(salary)) {
    return {
      ...emptyCompensation(),
      confidence: "exact",
      display: "Negotiable",
      source: "listing-field",
    };
  }

  const fieldCandidate = parseCandidate(salary);
  const labeledText = input.description.match(LABELED_PAY_PATTERN)?.[1] ?? "";
  const descriptionCandidate = parseCandidate(labeledText);
  if (
    fieldCandidate?.currency &&
    descriptionCandidate?.currency &&
    fieldCandidate.currency !== descriptionCandidate.currency
  ) {
    return {
      ...emptyCompensation(),
      confidence: "conflict",
      display: `${formatCandidate(descriptionCandidate)} (salary field says ${salary})`,
      notes: [
        `The description identifies ${descriptionCandidate.currency} while the salary field identifies ${fieldCandidate.currency}.`,
      ],
      source: "listing-description",
    };
  }

  const candidate =
    (fieldCandidate?.currency ? fieldCandidate : null) ??
    descriptionCandidate ??
    fieldCandidate;
  if (!candidate) {
    return emptyCompensation();
  }
  const source =
    candidate === fieldCandidate ? "listing-field" : "listing-description";
  return {
    ...candidate,
    confidence: candidate.currency ? "exact" : "inferred",
    display: formatCandidate(candidate),
    notes: [],
    source,
  };
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

function parseCandidate(value: string): Candidate | null {
  if (!value) {
    return null;
  }
  const match = value.match(MONEY_PATTERN);
  const low = number(match?.[4]);
  const high = number(match?.[5]);
  if (!(match && low)) {
    return null;
  }
  const direction = match[1]?.toLowerCase();
  const currency = normalizeCurrency(match[2], match[3] ?? match[6]);
  let qualifier: Compensation["qualifier"] = "exact";
  if (direction === "up to") {
    qualifier = "up-to";
  } else if (direction === "from") {
    qualifier = "from";
  } else if (high) {
    qualifier = "range";
  }
  return {
    amountMax: direction === "up to" ? low : high,
    amountMin: direction === "up to" ? null : low,
    currency,
    period: period(value),
    qualifier,
  };
}

function formatCandidate(value: Candidate) {
  const low = value.amountMin?.toLocaleString("en-US");
  const high = value.amountMax?.toLocaleString("en-US");
  const amount = low && high ? `${low}–${high}` : (low ?? high ?? "");
  let prefix = "";
  if (value.qualifier === "up-to") {
    prefix = "Up to ";
  } else if (value.qualifier === "from") {
    prefix = "From ";
  }
  const periodSuffix = value.period ? `/${value.period}` : "";
  if (value.currency === "JPY") {
    return `${prefix}¥${amount} JPY${periodSuffix}`;
  }
  if (value.currency === "USD") {
    return `${prefix}$${amount} USD${periodSuffix}`;
  }
  if (value.currency === "EUR") {
    return `${prefix}€${amount} EUR${periodSuffix}`;
  }
  return `${prefix}${amount}${value.currency ? ` ${value.currency}` : ""}${periodSuffix}`;
}

function normalizeCurrency(
  symbol: string | undefined,
  code: string | undefined
): string | null {
  if (symbol === "¥") {
    return "JPY";
  }
  if (symbol === "$") {
    return "USD";
  }
  if (symbol === "€") {
    return "EUR";
  }
  const normalized = code?.toUpperCase();
  return normalized === "RMB" ? "CNY" : (normalized ?? null);
}

function period(value: string): Compensation["period"] {
  if (/\b(?:per\s+|\/\s*)hour\b|\bhourly\b/i.test(value)) {
    return "hour";
  }
  if (/\b(?:per\s+|\/\s*)month\b|\bmonthly\b/i.test(value)) {
    return "month";
  }
  if (/\b(?:per\s+|\/\s*)year\b|\bannual(?:ly)?\b/i.test(value)) {
    return "year";
  }
  return null;
}

function number(value: string | undefined) {
  const parsed = Number(value?.replaceAll(",", "") ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
