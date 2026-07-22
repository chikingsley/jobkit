import { describe, expect, test } from "bun:test";
import type { JobContentAnalysis } from "../../src/features/jobs/content-analysis";
import type { JobPositionVariant } from "../../src/features/jobs/position-variants";
import type { JobMatchFacts } from "../../src/features/matching/schema";
import {
  buildPublicDescription,
  containsPrivateContactValue,
} from "../../src/features/public/description";

describe("public description renderer", () => {
  test("renders the fixed section order and omits empty sections", () => {
    const description = buildPublicDescription({
      analysis: contentAnalysis(),
      facts: matchFacts(),
      position: position(),
    });

    expect(description.sections.map(({ heading }) => heading)).toEqual([
      "Overview",
      "Responsibilities",
      "Qualifications",
      "Teaching context",
      "Schedule and contract",
      "Compensation and benefits",
      "Location and visa",
      "Application process",
      "Additional details",
    ]);
    expect(description.html).toContain(
      "<section><h2>Overview</h2><p>Teach English to adult learners.</p></section>"
    );
    expect(description.html).toContain("CNY 25,000–30,000 per month (gross)");
    expect(description.html.match(/Visa sponsorship:/gu)).toHaveLength(1);
    expect(description.canonicalJson).toContain(
      '"contractVersion":"public-description-v1"'
    );
  });

  test("escapes source text and removes contact destinations", () => {
    const analysis = contentAnalysis();
    analysis.overview[0] = {
      evidence: ["Teach <strong>English</strong> & science."],
      text: "Teach <strong>English</strong> & science.",
    };
    analysis.applicationProcess = [
      {
        evidence: ["Email private@example.test"],
        text: "Email private@example.test",
      },
      {
        evidence: ["Submit a resume and diploma."],
        text: "Submit a resume and diploma.",
      },
    ];

    const description = buildPublicDescription({
      analysis,
      facts: matchFacts(),
      position: position(),
    });

    expect(description.html).toContain(
      "Teach &lt;strong&gt;English&lt;/strong&gt; &amp; science."
    );
    expect(description.html).not.toContain("private@example.test");
    expect(description.html).toContain("Submit a resume and diploma.");
    expect(description.redactedItems).toEqual(["Email private@example.test"]);
  });

  test("detects email, URL, and telephone destinations", () => {
    expect(containsPrivateContactValue("teacher@example.com")).toBe(true);
    expect(containsPrivateContactValue("https://example.com/apply")).toBe(true);
    expect(containsPrivateContactValue("Call +1 (304) 216-8700")).toBe(true);
    expect(containsPrivateContactValue("Apply by 2026-07-21")).toBe(false);
    expect(containsPrivateContactValue("Submit a resume and diploma")).toBe(
      false
    );
  });
});

function contentAnalysis(): JobContentAnalysis {
  return {
    additionalSections: [
      {
        items: [
          {
            evidence: ["The school provides curriculum materials."],
            text: "The school provides curriculum materials.",
          },
        ],
        title: "Curriculum",
      },
    ],
    applicationProcess: [
      {
        evidence: ["Submit a resume and diploma."],
        text: "Submit a resume and diploma.",
      },
    ],
    overview: [
      {
        evidence: ["Teach English to adult learners."],
        text: "Teach English to adult learners.",
      },
    ],
    responsibilities: [
      {
        evidence: ["Plan and deliver lessons."],
        text: "Plan and deliver lessons.",
      },
    ],
    scheduleAndContract: [
      {
        evidence: ["Monday to Friday"],
        label: "Work days",
        value: "Monday to Friday",
      },
    ],
    teachingContext: [
      {
        evidence: ["Classes of up to 20 adults"],
        label: "Class size",
        value: "Up to 20 adults",
      },
    ],
    unplacedEvidence: [],
  };
}

function position(): JobPositionVariant {
  return {
    audiences: [],
    certainty: "explicit",
    compensationEvidence: [],
    employmentTypes: [],
    evidence: ["English teacher"],
    locations: [
      {
        addressComponents: [],
        evidence: "Beijing",
        parentGeographies: [],
        role: "worksite",
        scope: "locality",
        semanticKind: "city",
        value: "Beijing, China",
        workplaceType: "onsite",
      },
    ],
    requirements: [
      {
        alternativeGroup: null,
        evidence: "Bachelor's degree required",
        importance: "required",
        kind: "degree",
        label: "Bachelor's degree",
        minimumDegreeLevel: "bachelor",
        minimumLanguageLevel: null,
        minimumYears: null,
        values: [],
      },
    ],
    roleFamily: "english_language",
    subjects: [],
    title: "English teacher",
  };
}

function matchFacts(): JobMatchFacts {
  return {
    audiences: [{ evidence: "adult learners", value: "adults" }],
    benefits: [
      {
        evidence: "Health insurance provided",
        level: "provided",
        value: "healthInsurance",
      },
      {
        evidence: "Visa support",
        level: "assistance",
        value: "visaSponsorship",
      },
    ],
    economics: {
      compensation: {
        amountMaximum: 30_000,
        amountMinimum: 25_000,
        currency: "CNY",
        evidence: ["25000-30000 CNY per month"],
        kind: "amount",
        period: "month",
        qualifier: "range",
        taxBasis: "gross",
      },
      workload: null,
    },
    employmentTypes: [],
    marketSegments: [],
    requirements: [],
    reviewNotes: [],
  };
}
