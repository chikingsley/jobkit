import type { JobMatchFacts } from "../03_match/schema";
import type { SourceFields } from "./anesl-fields";

type Audience = JobMatchFacts["audiences"][number]["value"];
type Segment = JobMatchFacts["marketSegments"][number]["value"];

const TAGS = /<[^>]*>/gu;
const WHITESPACE = /\s+/gu;

const AUDIENCE_WORDS: [RegExp, Audience][] = [
  [/kindergarten|pre-?school|nursery|young learners/iu, "preschool"],
  [/elementary|primary/iu, "primary"],
  [/secondary|high school|junior high|teenager/iu, "teenagers"],
  [/university|college/iu, "college"],
  [/adult|business english/iu, "adults"],
];

const SEGMENT_WORDS: [RegExp, Segment][] = [
  [/international school/iu, "international_school"],
  [/university|college/iu, "university"],
  [/language (school|centre|center)|eikaiwa/iu, "language_center"],
  [/private school/iu, "private_school"],
  [/public school|board of education/iu, "public_school"],
];

export interface TeflPosting {
  country: string;
  description: string;
  locality: string;
  organisation: string;
}

export interface ExtractedTeflFacts {
  audiences: { evidence: string; value: Audience }[];
  marketSegments: { evidence: string; value: Segment }[];
  posting: TeflPosting | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function teflPosting(fields: SourceFields): TeflPosting | null {
  const raw = fields.job_posting_json_ld;
  if (!raw) {
    return null;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
  const location = parsed.jobLocation as
    | { address?: Record<string, unknown>; name?: unknown }
    | undefined;
  const organisation = parsed.hiringOrganization as
    | { name?: unknown }
    | undefined;
  return {
    country: text(location?.address?.addressCountry),
    description: text(parsed.description)
      .replace(TAGS, " ")
      .replace(WHITESPACE, " ")
      .trim(),
    locality: text(location?.address?.addressLocality) || text(location?.name),
    organisation: text(organisation?.name),
  };
}

export function extractTeflFacts(fields: SourceFields): ExtractedTeflFacts {
  const posting = teflPosting(fields);
  if (!posting) {
    return { audiences: [], marketSegments: [], posting: null };
  }
  const haystack = `${posting.description} ${posting.organisation}`;
  const evidence = posting.description.slice(0, 200) || posting.organisation;
  if (evidence === "") {
    return { audiences: [], marketSegments: [], posting };
  }
  return {
    audiences: AUDIENCE_WORDS.filter(([pattern]) => pattern.test(haystack)).map(
      ([, value]) => ({ evidence, value })
    ),
    marketSegments: SEGMENT_WORDS.filter(([pattern]) =>
      pattern.test(haystack)
    ).map(([, value]) => ({ evidence, value })),
    posting,
  };
}
