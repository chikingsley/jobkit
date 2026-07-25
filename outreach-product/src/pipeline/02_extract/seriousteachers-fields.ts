import type { JobMatchFacts } from "../03_match/schema";
import type { SourceFields } from "./anesl-fields";

type Audience = JobMatchFacts["audiences"][number]["value"];
type Segment = JobMatchFacts["marketSegments"][number]["value"];
type DegreeLevel = JobMatchFacts["requirements"][number]["minimumDegreeLevel"];

const SALARY_PATTERN = /([\d,]+(?:\.\d+)?)\s*([A-Z]{3})\b/u;
const NEGOTIABLE_PATTERN = /negotiable|competitive|doe|depending/iu;
const LIST_SEPARATOR = /\s*,\s*/u;
const MAX_EXPERTISE_ENTRIES = 40;
const MAX_VALUE_LENGTH = 200;

const DEGREE_LEVELS: [RegExp, NonNullable<DegreeLevel>][] = [
  [/\bphd\b|doctorate|\bedd\b/iu, "doctorate"],
  [/master|\bma\b|\bmsc\b|\bmed\b|post ?graduate/iu, "master"],
  [/bachelor|\bba\b|\bbsc\b|\bbed\b|\bdegree\b/iu, "bachelor"],
  [/diploma|\bpgce\b|\bceta\b|celta|\btefl\b|\btesol\b/iu, "certificate"],
];

const DEGREE_LABELS: Record<string, string> = {
  bachelor: "Bachelor's degree or above",
  certificate: "Teaching certificate or above",
  doctorate: "Doctorate or above",
  master: "Master's degree or above",
};

const EXPERTISE_AUDIENCES: [RegExp, Audience][] = [
  [
    /nursery|kindergarten|preschool|pre-school|early years|toddler/iu,
    "preschool",
  ],
  [/primary|elementary|children|young learners|\byl\b/iu, "primary"],
  [
    /high school|secondary|middle school|teenager|igcse|\ba ?level\b/iu,
    "teenagers",
  ],
  [/university|college|tertiary/iu, "college"],
  [/adult|business english|corporate|\bielts\b|\btoefl\b/iu, "adults"],
];

const EXPERTISE_SEGMENTS: [RegExp, Segment][] = [
  [/international school/iu, "international_school"],
  [/kindergarten|nursery|preschool/iu, "kindergarten"],
  [
    /language (center|centre|school)|esl\/efl|\besl\b|\befl\b/iu,
    "language_center",
  ],
  [/private school/iu, "private_school"],
  [/public school|government school/iu, "public_school"],
  [/training (center|centre)/iu, "training_center"],
  [/university|college/iu, "university"],
  [/online|remote|virtual/iu, "online"],
];

function fact<Value>(value: Value, evidence: string) {
  return { evidence, value };
}

function expertiseEntries(fields: SourceFields) {
  const raw = fields["Fields of Expertise"];
  if (!raw) {
    return { entries: [] as string[], raw: "" };
  }
  const entries = raw
    .split(LIST_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "" && entry.length <= MAX_VALUE_LENGTH)
    .slice(0, MAX_EXPERTISE_ENTRIES);
  return { entries, raw };
}

function audiences(fields: SourceFields) {
  const { entries, raw } = expertiseEntries(fields);
  if (entries.length === 0) {
    return [];
  }
  const haystack = entries.join(", ");
  const evidence = `Fields of Expertise: ${raw.slice(0, MAX_VALUE_LENGTH)}`;
  return EXPERTISE_AUDIENCES.filter(([pattern]) => pattern.test(haystack)).map(
    ([, value]) => fact(value, evidence)
  );
}

function marketSegments(fields: SourceFields) {
  const { entries, raw } = expertiseEntries(fields);
  if (entries.length === 0) {
    return [];
  }
  const haystack = entries.join(", ");
  const evidence = `Fields of Expertise: ${raw.slice(0, MAX_VALUE_LENGTH)}`;
  return EXPERTISE_SEGMENTS.filter(([pattern]) => pattern.test(haystack)).map(
    ([, value]) => fact(value, evidence)
  );
}

function degreeRequirement(fields: SourceFields) {
  const raw = fields["Required Degrees"]?.trim();
  if (!raw) {
    return null;
  }
  const matched = DEGREE_LEVELS.find(([pattern]) => pattern.test(raw));
  if (!matched) {
    return null;
  }
  const [, level] = matched;
  const label = DEGREE_LABELS[level] ?? "Degree or above";
  return {
    alternativeGroup: null,
    evidence: `Required Degrees: ${raw.slice(0, MAX_VALUE_LENGTH)}`,
    importance: "required" as const,
    kind: "degree" as const,
    label,
    minimumDegreeLevel: level,
    minimumLanguageLevel: null,
    minimumYears: null,
    values: [label],
  };
}

function compensation(fields: SourceFields) {
  const raw = fields.Salary?.trim();
  if (!raw) {
    return null;
  }
  const matched = SALARY_PATTERN.exec(raw);
  if (!(matched?.[1] && matched[2])) {
    return NEGOTIABLE_PATTERN.test(raw)
      ? {
          amountMaximum: null,
          amountMinimum: null,
          currency: null,
          evidence: [`Salary: ${raw.slice(0, MAX_VALUE_LENGTH)}`],
          kind: "negotiable" as const,
          period: null,
          qualifier: null,
          taxBasis: "unspecified" as const,
        }
      : null;
  }
  const amount = Number(matched[1].replaceAll(",", ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return {
    amountMaximum: null,
    amountMinimum: amount,
    currency: matched[2].toUpperCase(),
    evidence: [`Salary: ${raw.slice(0, MAX_VALUE_LENGTH)}`],
    kind: "amount" as const,
    period: null,
    qualifier: null,
    taxBasis: "unspecified" as const,
  };
}

export interface ExtractedSeriousTeachersFacts {
  audiences: ReturnType<typeof audiences>;
  compensation: ReturnType<typeof compensation>;
  marketSegments: ReturnType<typeof marketSegments>;
  requirements: NonNullable<ReturnType<typeof degreeRequirement>>[];
}

export function extractSeriousTeachersFacts(
  fields: SourceFields
): ExtractedSeriousTeachersFacts {
  return {
    audiences: audiences(fields),
    compensation: compensation(fields),
    marketSegments: marketSegments(fields),
    requirements: [degreeRequirement(fields)].filter(
      (requirement) => requirement !== null
    ),
  };
}
