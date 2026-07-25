export const MONTHLY_FX_TO_USD: Record<string, number> = {
  AED: 0.27,
  ARS: 0.001,
  AUD: 0.66,
  BRL: 0.18,
  CAD: 0.73,
  CHF: 1.12,
  CLP: 0.001,
  CNY: 0.14,
  COP: 0.000_25,
  CZK: 0.043,
  EGP: 0.02,
  EUR: 1.08,
  GBP: 1.27,
  GEL: 0.37,
  HKD: 0.128,
  HUF: 0.0027,
  IDR: 0.000_062,
  ILS: 0.27,
  INR: 0.012,
  JPY: 0.0064,
  KRW: 0.000_73,
  KWD: 3.25,
  KZT: 0.0021,
  MAD: 0.1,
  MNT: 0.000_29,
  MVR: 0.065,
  MXN: 0.055,
  MYR: 0.22,
  OMR: 2.6,
  PLN: 0.25,
  QAR: 0.27,
  RON: 0.22,
  RUB: 0.011,
  SAR: 0.27,
  SGD: 0.74,
  THB: 0.028,
  TRY: 0.029,
  TWD: 0.031,
  UAH: 0.024,
  USD: 1,
  UZS: 0.000_079,
  VND: 0.000_039,
  ZAR: 0.055,
};

const COUNTRY_CURRENCY: Record<string, string> = {
  argentina: "ARS",
  australia: "AUD",
  bahrain: "USD",
  brazil: "BRL",
  cambodia: "USD",
  canada: "CAD",
  chile: "CLP",
  china: "CNY",
  colombia: "COP",
  "czech republic": "CZK",
  ecuador: "USD",
  egypt: "EGP",
  georgia: "GEL",
  germany: "EUR",
  "hong kong": "HKD",
  hungary: "HUF",
  india: "INR",
  indonesia: "IDR",
  israel: "ILS",
  italy: "EUR",
  japan: "JPY",
  kazakhstan: "KZT",
  kuwait: "KWD",
  malaysia: "MYR",
  maldives: "MVR",
  mexico: "MXN",
  mongolia: "MNT",
  morocco: "MAD",
  oman: "OMR",
  panama: "USD",
  poland: "PLN",
  qatar: "QAR",
  romania: "RON",
  russia: "RUB",
  "saudi arabia": "SAR",
  singapore: "SGD",
  "south africa": "ZAR",
  "south korea": "KRW",
  spain: "EUR",
  switzerland: "CHF",
  taiwan: "TWD",
  thailand: "THB",
  turkey: "TRY",
  ukraine: "UAH",
  "united arab emirates": "AED",
  "united kingdom": "GBP",
  "united states": "USD",
  "united states of america": "USD",
  uzbekistan: "UZS",
  vietnam: "VND",
};

const ALIASES: Record<string, string> = {
  NTD: "TWD",
  RMB: "CNY",
  RNB: "CNY",
  WON: "KRW",
  YUAN: "CNY",
};

const PLAUSIBLE_MONTHLY_USD_FLOOR = 150;
const PLAUSIBLE_HOURLY_USD_FLOOR = 2;
const MAGNITUDE_STEPS = [1000, 1_000_000];

export function isoCurrencyCode(code: string | null): string | null {
  if (!code) {
    return null;
  }
  const upper = code.trim().toUpperCase();
  const resolved = ALIASES[upper] ?? upper;
  return resolved in MONTHLY_FX_TO_USD ? resolved : null;
}

export function currencyForCountry(country: string | null): string | null {
  if (!country) {
    return null;
  }
  const key = country.trim().toLocaleLowerCase("en");
  return COUNTRY_CURRENCY[key] ?? null;
}

export function resolveCurrency(
  code: string | null,
  country: string | null
): string | null {
  return isoCurrencyCode(code) ?? currencyForCountry(country);
}

export function correctMagnitude(
  amount: number,
  currency: string,
  period: string | null
): number {
  if (period !== null && period !== "month") {
    return amount;
  }
  const rate = MONTHLY_FX_TO_USD[currency];
  if (!rate || amount <= 0) {
    return amount;
  }
  if (amount * rate >= PLAUSIBLE_HOURLY_USD_FLOOR) {
    return amount;
  }
  for (const step of MAGNITUDE_STEPS) {
    if (amount * step * rate >= PLAUSIBLE_MONTHLY_USD_FLOOR) {
      return amount * step;
    }
  }
  return amount;
}

const HOURLY_EVIDENCE =
  /\/\s*h(r|our)?\b|per\s+hour|hourly|an\s+hour|per\s+[\d-]*\s*minute|per\s+(private\s+)?(lesson|class)|a\s+lesson/iu;
const YEARLY_EVIDENCE =
  /\/\s*(y(ea)?r|annum)\b|per\s+year|annual|yearly|p\.?a\.?\b/iu;
const WEEKLY_EVIDENCE = /\/\s*w(k|eek)?\b|per\s+week|weekly/iu;
const MONTHLY_EVIDENCE = /\/\s*m(o|onth)?\b|per\s+month|monthly|a\s+month/iu;

export function inferPeriod(
  period: string | null,
  evidence: string[]
): string | null {
  if (period) {
    return period;
  }
  const text = evidence.join(" ");
  if (HOURLY_EVIDENCE.test(text)) {
    return "hour";
  }
  if (YEARLY_EVIDENCE.test(text)) {
    return "year";
  }
  if (WEEKLY_EVIDENCE.test(text)) {
    return "week";
  }
  if (MONTHLY_EVIDENCE.test(text)) {
    return "month";
  }
  return null;
}

export const CREDIBLE_MONTHLY_USD_CEILING = 9000;
const PLAUSIBLE_ANNUAL_FLOOR_USD = 400;

export function periodFromMagnitude(
  amount: number,
  currency: string,
  period: string | null
): string | null {
  if (period !== null) {
    return period;
  }
  const rate = MONTHLY_FX_TO_USD[currency];
  if (!rate || amount <= 0) {
    return null;
  }
  const asMonthly = amount * rate;
  if (asMonthly <= CREDIBLE_MONTHLY_USD_CEILING) {
    return null;
  }
  return asMonthly / 12 >= PLAUSIBLE_ANNUAL_FLOOR_USD ? "year" : null;
}
