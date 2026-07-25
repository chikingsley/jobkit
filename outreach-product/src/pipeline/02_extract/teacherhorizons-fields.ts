import type { JobMatchFacts } from "../03_match/schema";
import type { SourceFields } from "./anesl-fields";

type Audience = JobMatchFacts["audiences"][number]["value"];
type Segment = JobMatchFacts["marketSegments"][number]["value"];

const ROLE_AUDIENCES: [RegExp, Audience[]][] = [
  [/early years|kindergarten|nursery|pre-?school/iu, ["preschool"]],
  [/primary|elementary/iu, ["primary"]],
  [/secondary|middle school|high school/iu, ["teenagers"]],
];

const SUBJECT_AUDIENCES: [RegExp, Audience[]][] = [
  [/early years|kindergarten/iu, ["preschool"]],
  [/primary|elementary/iu, ["primary"]],
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const PLACEHOLDER_SUBJECT = /unspecified|other/iu;

function collectBands(
  found: Map<Audience, string>,
  bands: [RegExp, Audience[]][],
  text: string,
  label: string
) {
  if (!text) {
    return;
  }
  for (const [pattern, values] of bands) {
    if (!pattern.test(text)) {
      continue;
    }
    for (const value of values) {
      found.set(value, `${label}: ${text}`);
    }
  }
}

function audiences(fields: SourceFields) {
  const found = new Map<Audience, string>();
  collectBands(found, ROLE_AUDIENCES, fields.role ?? "", "role");
  collectBands(found, SUBJECT_AUDIENCES, fields.subject ?? "", "subject");
  return [...found].map(([value, evidence]) => ({ evidence, value }));
}

function marketSegments(fields: SourceFields) {
  const { role } = fields;
  if (!role) {
    return [];
  }
  return [
    {
      evidence: `role: ${role}`,
      value: "international_school" as Segment,
    },
  ];
}

function availabilityRequirement(fields: SourceFields) {
  const start = fields.start_date;
  if (!(start && ISO_DATE.test(start))) {
    return null;
  }
  return {
    alternativeGroup: null,
    evidence: `start_date: ${start}`,
    importance: "required" as const,
    kind: "availability" as const,
    label: `Available to start ${start}`,
    minimumDegreeLevel: null,
    minimumLanguageLevel: null,
    minimumYears: null,
    values: [start],
  };
}

function skillRequirement(fields: SourceFields) {
  const { subject } = fields;
  if (!subject || PLACEHOLDER_SUBJECT.test(subject)) {
    return null;
  }
  return {
    alternativeGroup: null,
    evidence: `subject: ${subject}`,
    importance: "required" as const,
    kind: "skill" as const,
    label: `Teaches ${subject}`,
    minimumDegreeLevel: null,
    minimumLanguageLevel: null,
    minimumYears: null,
    values: [subject],
  };
}

export interface ExtractedTeacherHorizonsFacts {
  audiences: ReturnType<typeof audiences>;
  marketSegments: ReturnType<typeof marketSegments>;
  requirements: NonNullable<
    | ReturnType<typeof availabilityRequirement>
    | ReturnType<typeof skillRequirement>
  >[];
}

export function extractTeacherHorizonsFacts(
  fields: SourceFields
): ExtractedTeacherHorizonsFacts {
  return {
    audiences: audiences(fields),
    marketSegments: marketSegments(fields),
    requirements: [
      availabilityRequirement(fields),
      skillRequirement(fields),
    ].filter((requirement) => requirement !== null),
  };
}
