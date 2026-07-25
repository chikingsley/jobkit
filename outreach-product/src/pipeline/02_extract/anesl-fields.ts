import type { JobMatchFacts } from "../03_match/schema";

export type SourceFields = Record<string, string | undefined>;

const ONLY_PREFIX = /^only\s+/iu;
const YEARS_PATTERN = /at least\s+(\d+)\s+years?/iu;
const AGE_RANGE_PATTERN = /from:\s*(\d+)\s*to:\s*(\d+)/iu;

const SALARY_PATTERN =
  /from\s+([A-Z]{2,4}):\s*([\d,]+)(?:\s*to\s+(?:[A-Z]{2,4}:?\s*)?([\d,]+))?/iu;
const TEACHING_HOURS_PATTERN = /teaching hours:\s*(\d+)/iu;
const OFFICE_HOURS_PATTERN = /office working hours:\s*(\d+)/iu;
const WEEKLY_HOUR_CEILING = 168;
const NO_DEGREE_PATTERN = /^nothing/iu;
const ANY_NATIONALITY_PATTERN = /unrequired|any/iu;
const LIST_SEPARATOR = /\s*,\s*/u;
const MAX_VALUE_LENGTH = 160;
const EMPTY_BENEFIT_PATTERN = /^(no|none|0)$/iu;
const ALLOWANCE_PATTERN = /allowance|\/year|\/month/iu;

const CURRENCY_ALIASES: Record<string, string> = { RMB: "CNY", RNB: "CNY" };

function isoCurrency(code: string) {
  const upper = code.toUpperCase();
  return CURRENCY_ALIASES[upper] ?? upper;
}

function clean(value: string | undefined) {
  return value?.replace(ONLY_PREFIX, "").trim() ?? "";
}

function fact<Value>(value: Value, evidence: string) {
  return { evidence, value };
}

type DegreeLevel = JobMatchFacts["requirements"][number]["minimumDegreeLevel"];
const DEGREE_LEVELS: [RegExp, DegreeLevel][] = [
  [/phd|doctorate/iu, "doctorate"],
  [/master|post graduate/iu, "master"],
  [/bachelor/iu, "bachelor"],
  [/diploma|non degree/iu, "diploma"],
];

function degreeRequirement(fields: SourceFields) {
  const raw = fields.Degree;
  const value = clean(raw);
  if (!(raw && value) || NO_DEGREE_PATTERN.test(value)) {
    return null;
  }
  const matched = DEGREE_LEVELS.find(([pattern]) => pattern.test(value));
  if (!matched) {
    return null;
  }

  const label =
    value.length <= MAX_VALUE_LENGTH ? value : (matched[1] ?? value);
  return {
    alternativeGroup: null,
    evidence: `Degree: ${raw}`,
    importance: "required" as const,
    kind: "degree" as const,
    label,
    minimumDegreeLevel: matched[1],
    minimumLanguageLevel: null,
    minimumYears: null,
    values: [label],
  };
}

function experienceRequirement(fields: SourceFields) {
  const raw = fields["Work Experience"];
  const years = YEARS_PATTERN.exec(clean(raw));
  if (!(raw && years?.[1])) {
    return null;
  }
  return {
    alternativeGroup: null,
    evidence: `Work Experience: ${raw}`,
    importance: "required" as const,
    kind: "experience" as const,
    label: `At least ${years[1]} years of experience`,
    minimumDegreeLevel: null,
    minimumLanguageLevel: null,
    minimumYears: Number(years[1]),
    values: [`${years[1]} years`],
  };
}

function nationalityRequirement(fields: SourceFields) {
  const raw = fields.Nationality;
  const value = clean(raw);
  if (!(raw && value) || ANY_NATIONALITY_PATTERN.test(value)) {
    return null;
  }

  const countries = value
    .split(LIST_SEPARATOR)
    .filter((country) => country && country.length <= MAX_VALUE_LENGTH);
  if (countries.length === 0) {
    return null;
  }
  return {
    alternativeGroup: "nationality",
    evidence: `Nationality: ${raw}`,
    importance: "required" as const,
    kind: "citizenship" as const,
    label: "Accepted nationalities",
    minimumDegreeLevel: null,
    minimumLanguageLevel: null,
    minimumYears: null,
    values: countries,
  };
}

type Audience = JobMatchFacts["audiences"][number]["value"];
const AUDIENCE_BANDS: [number, number, Audience][] = [
  [0, 6, "preschool"],
  [6, 12, "primary"],
  [12, 18, "teenagers"],
  [18, 23, "college"],
  [23, 120, "adults"],
];

function audiences(fields: SourceFields) {
  const raw = fields["Student’s age"] ?? fields["Student's age"];
  const range = AGE_RANGE_PATTERN.exec(raw ?? "");
  if (!(raw && range?.[1] && range[2])) {
    return [];
  }
  const from = Number(range[1]);
  const to = Number(range[2]);
  const evidence = `Student’s age: ${raw}`;
  return AUDIENCE_BANDS.filter(([low, high]) => from < high && to > low).map(
    ([, , value]) => fact(value, evidence)
  );
}

type Segment = JobMatchFacts["marketSegments"][number]["value"];
const SEGMENTS: [RegExp, Segment][] = [
  [/university|college/iu, "university"],
  [/kindergarten|nursery/iu, "kindergarten"],
  [/international school/iu, "international_school"],
  [/training cent(er|re)/iu, "training_center"],
  [/langu?age school|language cent(er|re)/iu, "language_center"],
  [/public (middle|primary|high) school/iu, "public_school"],
  [/private (middle|primary|high) school/iu, "private_school"],
];

function marketSegments(fields: SourceFields) {
  const raw = fields["Employer’s Type"] ?? fields["Employer's Type"];
  if (!raw) {
    return [];
  }
  const matched = SEGMENTS.find(([pattern]) => pattern.test(raw));
  return matched
    ? [fact(matched[1], `Employer’s Type: ${raw}`)]
    : [fact("school" as const, `Employer’s Type: ${raw}`)];
}

const BENEFITS: [string, JobMatchFacts["benefits"][number]["value"]][] = [
  ["Airfare", "airfare"],
  ["Medical/Insurance", "healthInsurance"],
  ["Allowance Apartment", "housing"],
  ["Apartment Detail", "housing"],
];

function benefits(fields: SourceFields) {
  const found = new Map<
    JobMatchFacts["benefits"][number]["value"],
    { evidence: string; level: "allowance" | "provided" }
  >();
  for (const [key, value] of BENEFITS) {
    const raw = fields[key];
    if (!raw || EMPTY_BENEFIT_PATTERN.test(raw.trim())) {
      continue;
    }
    if (!found.has(value)) {
      found.set(value, {
        evidence: `${key}: ${raw}`,
        level: ALLOWANCE_PATTERN.test(raw) ? "allowance" : "provided",
      });
    }
  }
  return [...found].map(([value, detail]) => ({
    evidence: detail.evidence,
    level: detail.level,
    value,
  }));
}

function compensation(fields: SourceFields) {
  const raw = fields["Salary/M"] ?? fields.Salary;
  const matched = SALARY_PATTERN.exec(raw ?? "");
  if (!(raw && matched?.[1] && matched[2])) {
    return null;
  }
  const minimum = Number(matched[2].replaceAll(",", ""));
  const maximum = matched[3] ? Number(matched[3].replaceAll(",", "")) : minimum;

  if (minimum <= 0) {
    return null;
  }

  const credible = maximum >= minimum ? maximum : null;
  return {
    amountMaximum: credible,
    amountMinimum: minimum,
    currency: isoCurrency(matched[1]),
    evidence: [`Salary/M: ${raw}`],
    kind: "amount" as const,
    period: "month" as const,
    qualifier: null,
    taxBasis: "unspecified" as const,
  };
}

function workload(fields: SourceFields) {
  const period = fields["Period/week"];
  const teaching = TEACHING_HOURS_PATTERN.exec(period ?? "");
  if (!(teaching?.[1] && period)) {
    return null;
  }
  const office = Number(OFFICE_HOURS_PATTERN.exec(period)?.[1] ?? 0);
  const teachingHours = Number(teaching[1]);
  const total = teachingHours + office;
  if (total <= 0 || total > WEEKLY_HOUR_CEILING) {
    return null;
  }
  return {
    basis:
      office > 0 ? ("teaching-plus-office" as const) : ("teaching" as const),
    evidence: [`Period/week: ${period}`],
    maximum: total,
    minimum: total,
    period: "week" as const,
  };
}

export interface ExtractedAneslFacts {
  audiences: ReturnType<typeof audiences>;
  benefits: ReturnType<typeof benefits>;
  compensation: ReturnType<typeof compensation>;
  marketSegments: ReturnType<typeof marketSegments>;
  requirements: NonNullable<
    | ReturnType<typeof degreeRequirement>
    | ReturnType<typeof experienceRequirement>
    | ReturnType<typeof nationalityRequirement>
  >[];
  workload: ReturnType<typeof workload>;
}

export function extractAneslFacts(fields: SourceFields): ExtractedAneslFacts {
  return {
    audiences: audiences(fields),
    benefits: benefits(fields),
    compensation: compensation(fields),
    marketSegments: marketSegments(fields),
    requirements: [
      degreeRequirement(fields),
      experienceRequirement(fields),
      nationalityRequirement(fields),
    ].filter((requirement) => requirement !== null),
    workload: workload(fields),
  };
}
