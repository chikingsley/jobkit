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
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{2190}-\u{21FF}\u{2500}-\u{27BF}\u{2B00}-\u{2BFF}\u{3000}-\u{303F}]|\uFE0F/gu;
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
  [/\bmaldives\b/iu, "Maldives"],
  [/\brussia\b|moscow|st\.? petersburg/iu, "Russia"],
  [/\buzbekistan\b|tashkent/iu, "Uzbekistan"],
  [/hong kong/iu, "Hong Kong"],
  [/\bkazakhstan\b|astana|almaty/iu, "Kazakhstan"],
  [/\bmalaysia\b|kuala lumpur|johor bahru|kota kinabalu|penang/iu, "Malaysia"],
  [/\btajikistan\b|dushanbe|khujand/iu, "Tajikistan"],
  [/\bmexico\b|guadalajara|monterrey|puebla/iu, "Mexico"],
  [/\bcambodia\b|phnom penh|siem reap/iu, "Cambodia"],
  [/\bsaudi\b|riyadh|jeddah|dammam/iu, "Saudi Arabia"],
  [/\bpoland\b|warsaw|krakow|kraków/iu, "Poland"],
  [/\bturkey\b|istanbul|ankara/iu, "Turkey"],
  [/\begypt\b|cairo|alexandria/iu, "Egypt"],
  [/\bgeorgia\b|tbilisi|batumi/iu, "Georgia"],
  [/\bkuwait\b/iu, "Kuwait"],
  [/\bqatar\b|doha/iu, "Qatar"],
  [/\boman\b|muscat/iu, "Oman"],
  [/\bindia\b|mumbai|delhi|bangalore/iu, "India"],
  [/대구|서울|부산|경기/u, "South Korea"],
];

const INCLUSIVE_GENDER =
  /\b(fe)?male\s*[/&+]\s*(fe)?male\b|\b(fe)?male\s+or\s+(fe)?male\b|\bany gender\b|\bregardless of gender\b|\ball genders\b/iu;

const RESTRICTIONS: [RegExp, string][] = [
  [
    /\bfemales?\s+(only|candidates?\s+only|applicants?\s+only|teachers?\s+only)\b|\bonly\s+females?\b|\bwomen\s+only\b|\bmust\s+be\s+(a\s+)?female\b/iu,
    "female-only",
  ],
  [
    /\bmales?\s+(only|candidates?\s+only|applicants?\s+only|teachers?\s+only)\b|\bonly\s+males?\b|\bmen\s+only\b|\bmust\s+be\s+(a\s+)?male\b/iu,
    "male-only",
  ],
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

const TITLE_FEMALE_ROLE =
  /^\s*female\s+[\w\s/&-]*\b(teacher|instructor|tutor|educator)/iu;
const TITLE_MALE_ROLE =
  /^\s*male\s+[\w\s/&-]*\b(teacher|instructor|tutor|educator)/iu;

export function statedRestrictions(title: string, description = ""): string[] {
  const text = `${title} ${description}`;
  const inclusive = INCLUSIVE_GENDER.test(text);
  const found = RESTRICTIONS.filter(([pattern, name]) => {
    if (inclusive && (name === "female-only" || name === "male-only")) {
      return false;
    }
    return pattern.test(text);
  }).map(([, name]) => name);
  if (
    !inclusive &&
    TITLE_FEMALE_ROLE.test(title) &&
    !found.includes("female-only")
  ) {
    found.push("female-only");
  }
  if (
    !inclusive &&
    TITLE_MALE_ROLE.test(title) &&
    !found.includes("male-only")
  ) {
    found.push("male-only");
  }
  return found;
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
    restrictions: statedRestrictions(title, raw.description),
    teachingHours: hours,
    title,
  };
}

export function currencyFallbackForCountry(country: string) {
  return currencyForCountry(country);
}
