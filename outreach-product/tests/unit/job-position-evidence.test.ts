import { describe, expect, test } from "bun:test";
import { JobPositionAnalysisSchema } from "../../src/features/jobs/position-variants";
import {
  canonicalizeJobPositionEvidence,
  unsupportedPositionEvidence,
} from "../../worker/ai/job-position-extraction";

describe("job position location evidence", () => {
  test("rejects unsupported parent and address-component quotes", () => {
    const analysis = positionAnalysis({
      addressEvidence: "13 Rustaveli Avenue",
      locationEvidence: "Tbilisi",
      parentEvidence: "Kutaisi",
    });

    expect(
      unsupportedPositionEvidence(
        analysis,
        "English teacher at 12 Rustaveli Avenue in Tbilisi, Georgia."
      )
    ).toEqual(["Kutaisi", "13 Rustaveli Avenue"]);
  });

  test("canonicalizes nested location quotes to exact source substrings", () => {
    const analysis = positionAnalysis({
      addressEvidence: "rustaveli avenue",
      locationEvidence: "tbilisi",
      parentEvidence: "georgia",
    });

    const canonical = canonicalizeJobPositionEvidence(
      analysis,
      "English teacher at Rustaveli Avenue in Tbilisi, Georgia."
    );
    const [location] = canonical.positions[0]?.locations ?? [];

    expect(location?.evidence).toBe("Tbilisi");
    expect(location?.parentGeographies[0]?.evidence).toBe("Georgia");
    expect(location?.addressComponents[0]?.evidence).toBe("Rustaveli Avenue");
    expect(
      unsupportedPositionEvidence(
        canonical,
        "English teacher at Rustaveli Avenue in Tbilisi, Georgia."
      )
    ).toEqual([]);
  });
});

function positionAnalysis(input: {
  addressEvidence: string;
  locationEvidence: string;
  parentEvidence: string;
}) {
  return JobPositionAnalysisSchema.parse({
    positions: [
      {
        audiences: [],
        certainty: "explicit",
        compensationEvidence: [],
        employmentTypes: [],
        evidence: ["English teacher"],
        locations: [
          {
            addressComponents: [
              {
                evidence: input.addressEvidence,
                kind: "street",
                value: "Rustaveli Avenue",
              },
            ],
            evidence: input.locationEvidence,
            parentGeographies: [
              {
                evidence: input.parentEvidence,
                semanticKind: "country",
                value: "Georgia",
              },
            ],
            role: "worksite",
            scope: "address",
            semanticKind: "address",
            value: "Rustaveli Avenue",
            workplaceType: "onsite",
          },
        ],
        requirements: [],
        roleFamily: "english_language",
        subjects: [],
        title: "English teacher",
      },
    ],
    reviewNotes: [],
    scope: "direct",
  });
}
