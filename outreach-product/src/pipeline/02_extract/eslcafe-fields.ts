import type { JobMatchFacts } from "../03_match/schema";
import type { SourceFields } from "./anesl-fields";
import { isoCurrencyCode } from "./currency";

type Audience = JobMatchFacts["audiences"][number]["value"];

const SALARY_LABEL = /\bSalary\b/gu;
const WHITESPACE = /\s+/gu;
const SALARY_BLOCK =
  /\bSalary\b[^.\n]{0,120}?([₩$€£¥฿])?\s?([\d][\d,.]*)\s*(million|m\b)?\s*([A-Z]{3})?[^.\n]{0,40}?\b(hourly|monthly|yearly|annually|per\s+hour|per\s+month|per\s+year|a\s+month|a\s+year)\b/iu;
const STUDENT_TYPE = /Student Type\s+([^\n]{0,80})/iu;
const SYMBOL_CURRENCY: Record<string, string> = {
  $: "USD",
  "¥": "JPY",
  "฿": "THB",
  "₩": "KRW",
  "€": "EUR",
};
const PERIOD_WORDS: [RegExp, string][] = [
  [/hourly|per\s+hour/iu, "hour"],
  [/monthly|per\s+month|a\s+month/iu, "month"],
  [/yearly|annually|per\s+year|a\s+year/iu, "year"],
];
const MILLION = 1_000_000;
const CURRENCY_CODE = /\b[A-Z]{3}\b/gu;
const YEAR_LIKE_FLOOR = 1990;
const YEAR_LIKE_CEILING = 2100;

const AUDIENCE_WORDS: [RegExp, Audience][] = [
  [/kindergarten|pre-?k|preschool|nursery/iu, "preschool"],
  [/elementary|primary/iu, "primary"],
  [/middle school|high school|secondary|teen/iu, "teenagers"],
  [/university|college/iu, "college"],
  [/adult|business/iu, "adults"],
];

export interface ExtractedEslCafeFacts {
  audiences: { evidence: string; value: Audience }[];
  compensation: {
    amountMaximum: null;
    amountMinimum: number;
    currency: string;
    evidence: string[];
    kind: "amount";
    period: string;
    qualifier: null;
    taxBasis: "unspecified";
  } | null;
  positionsInPost: number;
}

export function positionsInPost(body: string) {
  return [...body.matchAll(SALARY_LABEL)].length;
}

function audiences(body: string) {
  const stated = STUDENT_TYPE.exec(body);
  if (!stated?.[1]) {
    return [];
  }
  const [, group] = stated;
  const evidence = `Student Type ${group.trim()}`;
  return AUDIENCE_WORDS.filter(([pattern]) => pattern.test(group)).map(
    ([, value]) => ({ evidence, value })
  );
}

function statedCurrency(block: string, symbol: string | undefined) {
  for (const code of block.match(CURRENCY_CODE) ?? []) {
    const resolved = isoCurrencyCode(code);
    if (resolved) {
      return resolved;
    }
  }
  return symbol ? (SYMBOL_CURRENCY[symbol] ?? null) : null;
}

function compensation(body: string) {
  const matched = SALARY_BLOCK.exec(body);
  if (!(matched?.[2] && matched[5])) {
    return null;
  }
  const currency = statedCurrency(matched[0], matched[1]);
  if (!currency) {
    return null;
  }
  const [, , figure, millions, , cadence] = matched;
  const scale = millions ? MILLION : 1;
  const amount = Number(figure.replaceAll(",", "")) * scale;
  const period = PERIOD_WORDS.find(([pattern]) => pattern.test(cadence));
  if (!(Number.isFinite(amount) && amount > 0 && period)) {
    return null;
  }
  if (
    period[1] !== "hour" &&
    amount >= YEAR_LIKE_FLOOR &&
    amount <= YEAR_LIKE_CEILING
  ) {
    return null;
  }
  return {
    amountMaximum: null,
    amountMinimum: amount,
    currency,
    evidence: [matched[0].replace(WHITESPACE, " ").trim().slice(0, 200)],
    kind: "amount" as const,
    period: period[1],
    qualifier: null,
    taxBasis: "unspecified" as const,
  };
}

export function extractEslCafeFacts(
  fields: SourceFields
): ExtractedEslCafeFacts {
  const body = (fields.body ?? "").replace(WHITESPACE, " ");
  const positions = positionsInPost(body);
  return {
    audiences: audiences(body),
    compensation: positions === 1 ? compensation(body) : null,
    positionsInPost: positions,
  };
}
