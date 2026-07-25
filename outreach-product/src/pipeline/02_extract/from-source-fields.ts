import { type JobMatchFacts, JobMatchFactsSchema } from "../03_match/schema";
import { extractAneslFacts, type SourceFields } from "./anesl-fields";
import { extractSeriousTeachersFacts } from "./seriousteachers-fields";
import { extractTeacherHorizonsFacts } from "./teacherhorizons-fields";

export const DETERMINISTIC_EXTRACTION_PROVIDER = "deterministic";
export const DETERMINISTIC_EXTRACTION_MODEL = "source-fields";

const BOARD_EXTRACTORS: Record<
  string,
  (fields: SourceFields) => JobMatchFacts | null
> = {
  anesl: aneslMatchFacts,
  seriousteachers: seriousTeachersMatchFacts,
  teacherhorizons: teacherHorizonsMatchFacts,
};

export function supportsDeterministicExtraction(board: string) {
  return board in BOARD_EXTRACTORS;
}

export function matchFactsFromSourceFields(
  board: string,
  fields: SourceFields
): JobMatchFacts | null {
  return BOARD_EXTRACTORS[board]?.(fields) ?? null;
}

function aneslMatchFacts(fields: SourceFields): JobMatchFacts | null {
  const extracted = extractAneslFacts(fields);
  const hasAnything =
    extracted.requirements.length > 0 ||
    extracted.audiences.length > 0 ||
    extracted.marketSegments.length > 0 ||
    extracted.benefits.length > 0 ||
    extracted.compensation !== null;
  if (!hasAnything) {
    return null;
  }
  return JobMatchFactsSchema.parse({
    audiences: extracted.audiences,
    benefits: extracted.benefits,
    economics: {
      compensation: extracted.compensation ?? {
        amountMaximum: null,
        amountMinimum: null,
        currency: null,
        evidence: [],
        kind: "unstated",
        period: null,
        qualifier: null,
        taxBasis: "unspecified",
      },
      workload: extracted.workload,
    },
    employmentTypes: [],
    marketSegments: extracted.marketSegments,
    requirements: extracted.requirements,
    reviewNotes: [],
  });
}

function teacherHorizonsMatchFacts(fields: SourceFields): JobMatchFacts | null {
  const extracted = extractTeacherHorizonsFacts(fields);
  if (
    extracted.requirements.length === 0 &&
    extracted.audiences.length === 0 &&
    extracted.marketSegments.length === 0
  ) {
    return null;
  }
  return JobMatchFactsSchema.parse({
    audiences: extracted.audiences,
    benefits: [],
    economics: {
      compensation: {
        amountMaximum: null,
        amountMinimum: null,
        currency: null,
        evidence: [],
        kind: "unstated",
        period: null,
        qualifier: null,
        taxBasis: "unspecified",
      },
      workload: null,
    },
    employmentTypes: [],
    marketSegments: extracted.marketSegments,
    requirements: extracted.requirements,
    reviewNotes: [],
  });
}

function seriousTeachersMatchFacts(fields: SourceFields): JobMatchFacts | null {
  const extracted = extractSeriousTeachersFacts(fields);
  const hasAnything =
    extracted.requirements.length > 0 ||
    extracted.audiences.length > 0 ||
    extracted.marketSegments.length > 0 ||
    extracted.compensation !== null;
  if (!hasAnything) {
    return null;
  }
  return JobMatchFactsSchema.parse({
    audiences: extracted.audiences,
    benefits: [],
    economics: {
      compensation: extracted.compensation ?? {
        amountMaximum: null,
        amountMinimum: null,
        currency: null,
        evidence: [],
        kind: "unstated",
        period: null,
        qualifier: null,
        taxBasis: "unspecified",
      },
      workload: null,
    },
    employmentTypes: [],
    marketSegments: extracted.marketSegments,
    requirements: extracted.requirements,
    reviewNotes: [],
  });
}
