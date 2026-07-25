import { type JobMatchFacts, JobMatchFactsSchema } from "../03_match/schema";
import { extractAjarnFacts } from "./ajarn-fields";
import { extractAneslFacts, type SourceFields } from "./anesl-fields";
import { extractEslCafeFacts } from "./eslcafe-fields";
import { extractSeriousTeachersFacts } from "./seriousteachers-fields";
import { extractTeacherHorizonsFacts } from "./teacherhorizons-fields";
import { extractTeflFacts } from "./tefl-fields";

export const DETERMINISTIC_EXTRACTION_PROVIDER = "deterministic";
export const DETERMINISTIC_EXTRACTION_MODEL = "source-fields";

const BOARD_EXTRACTORS: Record<
  string,
  (fields: SourceFields) => JobMatchFacts | null
> = {
  ajarn: ajarnMatchFacts,
  anesl: aneslMatchFacts,
  "eslcafe-modern": eslCafeMatchFacts,
  seriousteachers: seriousTeachersMatchFacts,
  teacherhorizons: teacherHorizonsMatchFacts,
  tefl: teflMatchFacts,
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

const UNSTATED_PAY = {
  amountMaximum: null,
  amountMinimum: null,
  currency: null,
  evidence: [],
  kind: "unstated" as const,
  period: null,
  qualifier: null,
  taxBasis: "unspecified" as const,
};

function ajarnMatchFacts(fields: SourceFields): JobMatchFacts | null {
  const extracted = extractAjarnFacts(fields);
  if (!extracted.compensation && extracted.employmentTypes.length === 0) {
    return null;
  }
  return JobMatchFactsSchema.parse({
    audiences: [],
    benefits: [],
    economics: {
      compensation: extracted.compensation ?? UNSTATED_PAY,
      workload: null,
    },
    employmentTypes: extracted.employmentTypes,
    marketSegments: [],
    requirements: [],
    reviewNotes: [],
  });
}

function eslCafeMatchFacts(fields: SourceFields): JobMatchFacts | null {
  const extracted = extractEslCafeFacts(fields);
  if (!extracted.compensation && extracted.audiences.length === 0) {
    return null;
  }
  return JobMatchFactsSchema.parse({
    audiences: extracted.audiences,
    benefits: [],
    economics: {
      compensation: extracted.compensation ?? UNSTATED_PAY,
      workload: null,
    },
    employmentTypes: [],
    marketSegments: [],
    requirements: [],
    reviewNotes: [],
  });
}

function teflMatchFacts(fields: SourceFields): JobMatchFacts | null {
  const extracted = extractTeflFacts(fields);
  if (
    extracted.audiences.length === 0 &&
    extracted.marketSegments.length === 0
  ) {
    return null;
  }
  return JobMatchFactsSchema.parse({
    audiences: extracted.audiences,
    benefits: [],
    economics: { compensation: UNSTATED_PAY, workload: null },
    employmentTypes: [],
    marketSegments: extracted.marketSegments,
    requirements: [],
    reviewNotes: [],
  });
}
