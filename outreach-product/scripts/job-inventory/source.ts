import { Database } from "bun:sqlite";

export interface InventoryCompensation {
  amountMaximum: number | null;
  amountMinimum: number | null;
  confidence: "exact" | "inferred" | "unknown";
  currency: string | null;
  display: string;
  period: "hour" | "month" | "year" | null;
  qualifier: "exact" | "from" | "range" | "up-to" | null;
}

export interface InventoryJob {
  applyEmail: string;
  applyUrl: string;
  board: string;
  company: string;
  compensation: InventoryCompensation;
  country: string;
  description: string;
  id: string;
  lastSeenAt: string;
  location: string;
  marketSegments: string[];
  salary: string;
  sourceUrl: string;
  title: string;
}

interface SourceJobRow {
  apply_email: string;
  apply_url: string;
  board: string;
  company: string;
  country: string;
  currency: string;
  description: string;
  job_id: string;
  last_seen_at: string;
  location: string;
  raw: string;
  raw_json: string;
  salary: string;
  title: string;
  url: string;
}

interface SourcePayload {
  fields?: Record<string, string | undefined>;
}

export interface SourceInventory {
  active: number;
  closed: number;
  jobs: InventoryJob[];
  total: number;
}

const currencyPatterns = [
  ["AED", /\bAED\b|dirhams?/iu],
  ["AZN", /\bAZN\b|₼|manat/iu],
  ["CNY", /\b(?:CNY|RMB)\b|yuan/iu],
  ["CZK", /\bCZK\b|Kč/iu],
  ["EUR", /\bEUR\b|euros?|€/iu],
  ["GEL", /\bGEL\b|₾/iu],
  ["GBP", /\bGBP\b|pounds?|£/iu],
  ["HUF", /\bHUF\b|forints?|\bFt\b/iu],
  ["IDR", /\bIDR\b|rupiah|\bRp\b/iu],
  ["JPY", /\bJPY\b|yen/iu],
  ["KRW", /\bKRW\b|won|₩/iu],
  ["KZT", /\bKZT\b|tenge|₸/iu],
  ["MYR", /\bMYR\b|ringgit|\bRM\b/iu],
  ["PLN", /\bPLN\b|zł|\bzl\b/iu],
  ["RON", /\bRON\b|\blei?\b/iu],
  ["RUB", /\bRUB\b|rubles?|₽/iu],
  ["SAR", /\bSAR\b|riyals?/iu],
  ["THB", /\bTHB\b|baht|฿/iu],
  ["TRY", /\bTRY\b|lira|₺/iu],
  ["TWD", /\bTWD\b|NT\$/iu],
  ["UAH", /\bUAH\b|hryvnia|₴/iu],
  ["USD", /\bUSD\b|US\$|\$/iu],
  ["VND", /\bVND\b|₫|đồng/iu],
] as const;

const numberPattern =
  /\d+(?:[ ,]\d{3})*(?:\.\d+)?\s*(?:k|thousand|million|m)?/giu;
const COUNTRY_FOOTNOTE_PATTERN = /\*+$/u;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u;
const FROM_AMOUNT_PATTERN =
  /\b(?:from|starting(?: at| from)?|at least|minimum|min\.?)\b/u;
const HOURLY_PERIOD_PATTERN =
  /\b(?:per|an|each)\s+hour\b|\/\s*(?:hour|hr)\b|\bhourly\b/u;
const MONTHLY_PERIOD_PATTERN =
  /\b(?:per|a|each)\s+month\b|\/\s*(?:month|mo)\b|\bmonthly\b/u;
const TAIWAN_DOLLAR_PATTERN = /(?:NT\$|\$\s*[\d,.]+\s*NT\b)/iu;
const UP_TO_AMOUNT_PATTERN = /\b(?:up to|maximum|max\.?|not more than)\b/u;
const YEARLY_PERIOD_PATTERN =
  /\b(?:per|a|each)\s+year\b|\/\s*(?:year|yr)\b|\b(?:annual|annually|annum)\b/u;

export function readSourceInventory(databasePath: string): SourceInventory {
  const database = new Database(databasePath, {
    readonly: true,
    strict: true,
  });
  try {
    const counts = database
      .query(
        `SELECT COUNT(*) total,
                SUM(status='active') active,
                SUM(status<>'active') closed
           FROM jobs`
      )
      .get() as { active: number; closed: number; total: number };
    const rows = database
      .query(
        `SELECT apply_email,apply_url,board,company,country,currency,
                description,job_id,last_seen_at,location,raw,raw_json,
                salary,title,url
           FROM jobs
          WHERE status='active'
          ORDER BY board,job_id`
      )
      .all() as SourceJobRow[];
    return {
      ...counts,
      jobs: rows.map(toInventoryJob),
    };
  } finally {
    database.close();
  }
}

function toInventoryJob(row: SourceJobRow): InventoryJob {
  const fields = sourceFields(row.raw_json);
  const salary = payStatement(row, fields);
  const description =
    row.description || fields.description || fields.body || row.raw;
  return {
    applyEmail: row.apply_email.trim().toLocaleLowerCase("en"),
    applyUrl: row.apply_url || row.url,
    board: row.board,
    company: row.company || fields.company || "",
    compensation: parseCompensation(salary, row.currency, countryFor(row)),
    country: countryFor(row),
    description: description.slice(0, 12_000),
    id:
      row.board === "seriousteachers"
        ? row.job_id
        : `${row.board}:${row.job_id}`,
    lastSeenAt: row.last_seen_at || new Date().toISOString(),
    location: row.location,
    marketSegments: marketSegments(row, fields),
    salary,
    sourceUrl: row.url,
    title: row.title,
  };
}

function sourceFields(rawJson: string): Record<string, string | undefined> {
  try {
    return (JSON.parse(rawJson) as SourcePayload).fields ?? {};
  } catch {
    return {};
  }
}

function payStatement(
  row: SourceJobRow,
  fields: Record<string, string | undefined>
) {
  const monthly = fields["Salary/M"]?.trim();
  if (monthly) {
    return `${monthly} / month`;
  }
  if (row.board === "anesl" && row.salary.trim()) {
    return `${row.salary.trim()} / month`;
  }
  return fields.Salary?.trim() || row.salary.trim();
}

function countryFor(row: SourceJobRow) {
  if (row.board === "anesl") {
    return "China";
  }
  if (row.board === "ajarn") {
    return "Thailand";
  }
  return row.country.replace(COUNTRY_FOOTNOTE_PATTERN, "").trim();
}

function marketSegments(
  row: SourceJobRow,
  fields: Record<string, string | undefined>
): string[] {
  const source = [
    row.title,
    row.company,
    fields["Employer’s Type"] ?? "",
    fields["Employer's Type"] ?? "",
  ]
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("en");
  const segments = new Set<string>();
  if (source.includes("training center")) {
    segments.add("training_center");
  }
  if (source.includes("language center")) {
    segments.add("language_center");
  }
  if (source.includes("international school")) {
    segments.add("international_school");
  }
  if (source.includes("public school")) {
    segments.add("public_school");
  }
  if (source.includes("private school")) {
    segments.add("private_school");
  }
  if (source.includes("university") || source.includes("college")) {
    segments.add("university");
  }
  if (source.includes("kindergarten") || source.includes("preschool")) {
    segments.add("kindergarten");
  }
  if (source.includes("online") || source.includes("remote")) {
    segments.add("online");
  }
  if (segments.size === 0 && source.includes("school")) {
    segments.add("school");
  }
  return [...segments];
}

function parseCompensation(
  sourceValue: string,
  sourceCurrency: string,
  country: string
): InventoryCompensation {
  const source = sourceValue.split("≈", 1)[0]?.trim() ?? "";
  if (!source) {
    return emptyCompensation("Salary not listed");
  }
  const currency = currencyFor(source, sourceCurrency, country);
  const amounts = amountsFrom(source);
  if (!(currency && amounts.length > 0)) {
    return emptyCompensation(source.slice(0, 240));
  }
  const uniqueAmounts = [...new Set(amounts)];
  if (uniqueAmounts.length > 2) {
    return emptyCompensation(source.slice(0, 240));
  }
  const period = payPeriod(source);
  const lowerSource = source.toLocaleLowerCase("en");
  let qualifier: InventoryCompensation["qualifier"] = "exact";
  let amountMinimum: number | null = uniqueAmounts[0] ?? null;
  let amountMaximum: number | null = null;
  if (uniqueAmounts.length === 2) {
    qualifier = "range";
    amountMinimum = Math.min(...uniqueAmounts);
    amountMaximum = Math.max(...uniqueAmounts);
  } else if (UP_TO_AMOUNT_PATTERN.test(lowerSource)) {
    qualifier = "up-to";
    amountMaximum = amountMinimum;
    amountMinimum = null;
  } else if (FROM_AMOUNT_PATTERN.test(lowerSource)) {
    qualifier = "from";
  }
  return {
    amountMaximum,
    amountMinimum,
    confidence: period ? "exact" : "inferred",
    currency,
    display: formatCompensation(
      amountMinimum,
      amountMaximum,
      currency,
      period,
      qualifier
    ),
    period,
    qualifier,
  };
}

function emptyCompensation(display: string): InventoryCompensation {
  return {
    amountMaximum: null,
    amountMinimum: null,
    confidence: "unknown",
    currency: null,
    display,
    period: null,
    qualifier: null,
  };
}

function currencyFor(source: string, fallback: string, country: string) {
  if (country === "Taiwan" && TAIWAN_DOLLAR_PATTERN.test(source)) {
    return "TWD";
  }
  if (source.includes("¥")) {
    if (country === "Japan") {
      return "JPY";
    }
    return country === "China" ? "CNY" : null;
  }
  const matches = currencyPatterns
    .filter(([, pattern]) => pattern.test(source))
    .map(([currency]) => currency);
  const currencies = [...new Set(matches)];
  if (currencies.length === 1) {
    return currencies[0] ?? null;
  }
  if (currencies.length > 1) {
    return null;
  }
  const normalized = fallback.trim().toLocaleUpperCase("en");
  if (normalized === "RMB") {
    return country === "Japan" ? null : "CNY";
  }
  return CURRENCY_CODE_PATTERN.test(normalized) ? normalized : null;
}

function amountsFrom(source: string) {
  return [...source.matchAll(numberPattern)]
    .map(([value]) => numericValue(value))
    .filter((value): value is number => value !== null && value > 0);
}

function numericValue(value: string): number | null {
  const normalized = value
    .toLocaleLowerCase("en")
    .replaceAll(",", "")
    .replaceAll(" ", "");
  const number = Number.parseFloat(normalized);
  if (!Number.isFinite(number)) {
    return null;
  }
  if (normalized.endsWith("million") || normalized.endsWith("m")) {
    return number * 1_000_000;
  }
  if (normalized.endsWith("thousand") || normalized.endsWith("k")) {
    return number * 1000;
  }
  return number;
}

function payPeriod(source: string): InventoryCompensation["period"] {
  const normalized = source.normalize("NFKC").toLocaleLowerCase("en");
  if (HOURLY_PERIOD_PATTERN.test(normalized)) {
    return "hour";
  }
  if (MONTHLY_PERIOD_PATTERN.test(normalized)) {
    return "month";
  }
  if (YEARLY_PERIOD_PATTERN.test(normalized)) {
    return "year";
  }
  return null;
}

function formatCompensation(
  minimum: number | null,
  maximum: number | null,
  currency: string,
  period: InventoryCompensation["period"],
  qualifier: InventoryCompensation["qualifier"]
) {
  const minimumText = minimum?.toLocaleString("en-US") ?? "";
  const maximumText = maximum?.toLocaleString("en-US") ?? "";
  const amount =
    minimumText && maximumText
      ? `${minimumText}–${maximumText}`
      : minimumText || maximumText;
  let prefix = "";
  if (qualifier === "from") {
    prefix = "From ";
  } else if (qualifier === "up-to") {
    prefix = "Up to ";
  }
  return `${prefix}${amount} ${currency}${period ? `/${period}` : ""}`;
}
