import {
  correctMagnitude,
  currencyForCountry,
  inferPeriod,
  MONTHLY_FX_TO_USD,
  resolveCurrency,
} from "./currency";

export interface RawListing {
  amountMaximum: number | null;
  amountMinimum: number | null;
  benefits: string[];
  board: string;
  company: string;
  country: string;
  currency: string | null;
  description: string;
  evidence: string[];
  id: string;
  location: string;
  period: string | null;
  teachingHours: number | null;
  title: string;
}

export interface CanonicalListing {
  benefits: string[];
  board: string;
  company: string;
  country: string;
  currency: string | null;
  id: string;
  location: string;
  monthlyUsd: number | null;
  perHourUsd: number | null;
  period: string | null;
  restrictions: string[];
  teachingHours: number | null;
  title: string;
}

export const CREDIBLE_WEEKLY_HOURS = 40;
export const CREDIBLE_MONTHLY_USD_CEILING = 25_000;
const WEEKS_PER_MONTH = 4.33;
const MONTHS_PER_YEAR = 12;
const ASSUMED_WEEKLY_HOURS = 20;

const DECORATION =
  /\p{Extended_Pictographic}|[\u{2500}-\u{25FF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}]|\uFE0F/gu;
const REPEATED_PUNCTUATION = /([!?.,\-–—*_~|])\1{1,}/gu;
const WHITESPACE = /\s+/gu;

const COUNTRY_ALIASES: Record<string, string> = {
  "hong kong sar": "Hong Kong",
  korea: "South Korea",
  prc: "China",
  uae: "United Arab Emirates",
  uk: "United Kingdom",
  "united states of america": "United States",
  usa: "United States",
  "viet nam": "Vietnam",
  vietnam: "Vietnam",
};

const COUNTRY_HINTS: [RegExp, string][] = [
  [/\bchina\b|beijing|shanghai|shenzhen|guangzhou|hangzhou|chengdu/iu, "China"],
  [
    /\bkorea\b|seoul|busan|gyeonggi|incheon|jeju|gangnam|gang-dong/iu,
    "South Korea",
  ],
  [/\btaiwan\b|taipei|kaohsiung|taichung|puli/iu, "Taiwan"],
  [/\bjapan\b|tokyo|osaka|kyoto|nagoya/iu, "Japan"],
  [/\bthailand\b|bangkok|chiang mai|phuket/iu, "Thailand"],
  [/\bvietnam\b|hanoi|ho chi minh|saigon|da nang/iu, "Vietnam"],
  [/\bbrazil\b|rio de janeiro|sao paulo|são paulo/iu, "Brazil"],
  [/\bspain\b|madrid|barcelona|valencia/iu, "Spain"],
  [/\bitaly\b|rome|milan|naples/iu, "Italy"],
  [/\bmongolia\b|ulaanbaatar/iu, "Mongolia"],
  [/\bindonesia\b|jakarta|bali/iu, "Indonesia"],
  [/\bmaldives\b|male/iu, "Maldives"],
  [/\brussia\b|moscow|st\.? petersburg/iu, "Russia"],
  [/\buzbekistan\b|tashkent/iu, "Uzbekistan"],
  [/hong kong/iu, "Hong Kong"],
];

const RESTRICTIONS: [RegExp, string][] = [
  [/\bfemales?\b|\bwomen only\b/iu, "female-only"],
  [/(?<!fe)\bmales?\b|\bmen only\b/iu, "male-only"],
  [
    /\bunder \d{2}\b|\bage limit\b|\bmaximum age\b|\bage under \d{2}\b/iu,
    "age-limited",
  ],
  [
    /\bnative speakers? only\b|\bnative english speakers? only\b/iu,
    "native-speaker-only",
  ],
  [
    /\blocal (candidates?|hires?) only\b|\balready in\b/iu,
    "local-candidates-only",
  ],
];

export function cleanTitle(title: string): string {
  return title
    .replace(DECORATION, " ")
    .replace(REPEATED_PUNCTUATION, "$1")
    .replace(WHITESPACE, " ")
    .trim();
}

export function canonicalCountry(
  country: string,
  location: string,
  title: string
): string {
  const stated = country.trim();
  if (stated) {
    return COUNTRY_ALIASES[stated.toLocaleLowerCase("en")] ?? stated;
  }
  const haystack = `${location} ${title}`;
  const hinted = COUNTRY_HINTS.find(([pattern]) => pattern.test(haystack));
  return hinted ? hinted[1] : "";
}

export function statedRestrictions(text: string): string[] {
  return RESTRICTIONS.filter(([pattern]) => pattern.test(text)).map(
    ([, name]) => name
  );
}

export function credibleTeachingHours(hours: number | null): number | null {
  if (hours === null || hours <= 0 || hours > CREDIBLE_WEEKLY_HOURS) {
    return null;
  }
  return hours;
}

function monthlyAmount(
  low: number,
  high: number,
  period: string | null,
  hours: number | null
): number {
  const midpoint = (low + high) / 2;
  if (period === "year") {
    return midpoint / MONTHS_PER_YEAR;
  }
  if (period === "week") {
    return midpoint * WEEKS_PER_MONTH;
  }
  if (period === "hour") {
    return midpoint * (hours ?? ASSUMED_WEEKLY_HOURS) * WEEKS_PER_MONTH;
  }
  return midpoint;
}

export function normalizeListing(raw: RawListing): CanonicalListing {
  const title = cleanTitle(raw.title);
  const country = canonicalCountry(raw.country, raw.location, title);
  const currency = resolveCurrency(raw.currency, country);
  const period = inferPeriod(raw.period, raw.evidence);
  const hours = credibleTeachingHours(raw.teachingHours);
  const rate = currency ? MONTHLY_FX_TO_USD[currency] : undefined;
  let monthlyUsd: number | null = null;
  if (currency && rate && raw.amountMinimum !== null && raw.amountMinimum > 0) {
    const low = correctMagnitude(raw.amountMinimum, currency, period);
    const high =
      raw.amountMaximum !== null && raw.amountMaximum >= raw.amountMinimum
        ? correctMagnitude(raw.amountMaximum, currency, period)
        : low;
    const candidate = Math.round(
      monthlyAmount(low, high, period, hours) * rate
    );
    if (candidate > 0 && candidate <= CREDIBLE_MONTHLY_USD_CEILING) {
      monthlyUsd = candidate;
    }
  }
  return {
    benefits: [...new Set(raw.benefits.filter(Boolean))].sort(),
    board: raw.board,
    company: raw.company.trim(),
    country,
    currency,
    id: raw.id,
    location: raw.location.trim(),
    monthlyUsd,
    perHourUsd:
      monthlyUsd && hours
        ? Math.round(monthlyUsd / (hours * WEEKS_PER_MONTH))
        : null,
    period,
    restrictions: statedRestrictions(`${title} ${raw.description}`),
    teachingHours: hours,
    title,
  };
}

export function currencyFallbackForCountry(country: string) {
  return currencyForCountry(country);
}
