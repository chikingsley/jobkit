import type {
  JobPositionAnalysis,
  JobPositionVariant,
} from "../../../../../src/features/jobs/position-variants";

export function matchFacts() {
  return {
    audiences: [],
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
    marketSegments: [],
    requirements: [],
    reviewNotes: [],
  };
}

export function contentAnalysis(evidence: string) {
  return {
    additionalSections: [],
    applicationProcess: [],
    overview: [{ evidence: [evidence], text: "Teach English in Tbilisi." }],
    responsibilities: [],
    scheduleAndContract: [],
    teachingContext: [],
    unplacedEvidence: [],
  };
}

export function directAnalysis(): JobPositionAnalysis {
  return {
    positions: [position("English Teacher", "English")],
    reviewNotes: [],
    scope: "direct",
  };
}

export function parentAndChildAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  return {
    positions: [
      {
        ...value,
        locations: [
          {
            addressComponents: [],
            evidence: "Georgia",
            parentGeographies: [],
            role: "worksite",
            scope: "countrywide",
            semanticKind: "country",
            value: "Georgia",
            workplaceType: "onsite",
          },
          ...value.locations,
        ],
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

export function manyLocationAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  return {
    positions: [
      {
        ...value,
        locations: Array.from({ length: 10 }, (_, index) => ({
          addressComponents: [],
          evidence: `City ${index}`,
          parentGeographies: [
            {
              evidence: "Georgia",
              semanticKind: "country" as const,
              value: "Georgia",
            },
          ],
          role: "worksite" as const,
          scope: "locality" as const,
          semanticKind: "city" as const,
          value: `City ${index}`,
          workplaceType: "onsite" as const,
        })),
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

export function parentMismatchAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  const [location] = value.locations;
  if (!location) {
    throw new Error("The position fixture requires one location");
  }
  return {
    positions: [
      {
        ...value,
        locations: [
          {
            ...location,
            parentGeographies: [
              ...location.parentGeographies,
              {
                evidence: "Kartli",
                semanticKind: "region",
                value: "Kartli",
              },
            ],
          },
        ],
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

export function sourceCountryConflictAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  const [location] = value.locations;
  if (!location) {
    throw new Error("The position fixture requires one location");
  }
  return {
    positions: [
      {
        ...value,
        locations: [
          {
            ...location,
            parentGeographies: [
              {
                evidence: "Armenia",
                semanticKind: "country",
                value: "Armenia",
              },
            ],
          },
        ],
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

export function sourceParentConflictAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  const [location] = value.locations;
  if (!location) {
    throw new Error("The position fixture requires one location");
  }
  return {
    positions: [
      {
        ...value,
        locations: [
          {
            ...location,
            parentGeographies: [
              ...location.parentGeographies,
              {
                evidence: "Kartli",
                semanticKind: "region",
                value: "Kartli",
              },
              {
                evidence: "Imereti",
                semanticKind: "region",
                value: "Imereti",
              },
            ],
          },
        ],
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

export function sameLabelRoleAndScopeAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  const [location] = value.locations;
  if (!location) {
    throw new Error("The position fixture requires one location");
  }
  return {
    positions: [
      {
        ...value,
        locations: [
          {
            ...location,
            role: "applicant_area",
            scope: "region",
            workplaceType: "remote",
          },
          {
            ...location,
            scope: "region",
          },
          location,
        ],
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

export function addressAnalysis(): JobPositionAnalysis {
  const value = position("English Teacher", "English");
  return {
    positions: [
      {
        ...value,
        locations: [
          {
            addressComponents: [
              {
                evidence: "12",
                kind: "address_number",
                value: "12",
              },
              {
                evidence: "Rustaveli Avenue",
                kind: "street",
                value: "Rustaveli Avenue",
              },
            ],
            evidence: "12 Rustaveli Avenue",
            parentGeographies: [
              {
                evidence: "Georgia",
                semanticKind: "country",
                value: "Georgia",
              },
              {
                evidence: "Tbilisi",
                semanticKind: "city",
                value: "Tbilisi",
              },
            ],
            role: "worksite",
            scope: "address",
            semanticKind: "address",
            value: "12 Rustaveli Avenue",
            workplaceType: "onsite",
          },
        ],
      },
    ],
    reviewNotes: [],
    scope: "direct",
  };
}

export function position(
  title: string,
  subject = "English"
): JobPositionVariant {
  return {
    audiences: [],
    certainty: "explicit",
    compensationEvidence: [],
    employmentTypes: [],
    evidence: [`Position: ${title}`],
    locations: [
      {
        addressComponents: [],
        evidence: "Tbilisi",
        parentGeographies: [
          {
            evidence: "Georgia",
            semanticKind: "country",
            value: "Georgia",
          },
        ],
        role: "worksite",
        scope: "locality",
        semanticKind: "city",
        value: "Tbilisi",
        workplaceType: "onsite",
      },
    ],
    requirements: [],
    roleFamily:
      subject === "English" ? "english_language" : "subject_specialist",
    subjects: [{ evidence: subject, value: subject }],
    title,
  };
}
