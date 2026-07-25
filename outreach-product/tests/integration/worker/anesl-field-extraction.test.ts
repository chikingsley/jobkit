import { describe, expect, it } from "vitest";
import { extractAneslFacts } from "../../../src/pipeline/02_extract/anesl-fields";

// Every value below is copied verbatim from the collector ledger.
const REAL_LISTING = {
  Age: "From:20 To: 60 years old",
  Airfare: "RMB 8000 /Year",
  "Apartment Detail": "Private Bedroom , TV,Private Kitchen",
  "Contact Person": "Mr.Corey Yang",
  Degree: "Only Bachelors/ Degree or Above",
  "E-Mail": "hr@anesl.com",
  "Employer’s Type": "Public University",
  Gender: "Unrequired",
  "Job’s Type": "Teaching Job",
  Location: "Haidian District Beijing",
  "Medical/Insurance": "RMB 1360 /Year",
  Nationality: "Canada,United Kingdom,United States,Australia",
  "Period/week": "Teaching hours: 14 Office working Hours: 5",
  "Salary/M": "From RMB: 17000 To RMB: 20000",
  "Student’s age": "from: 18 to: 25 years old",
  "Work Experience": "Only at least 2 years",
};

describe("anesl source field extraction", () => {
  it("reads requirements, audience, segment, pay, and workload without a model", () => {
    const facts = extractAneslFacts(REAL_LISTING);

    expect(facts.requirements).toEqual([
      {
        alternativeGroup: null,
        evidence: "Degree: Only Bachelors/ Degree or Above",
        importance: "required",
        kind: "degree",
        label: "Bachelors/ Degree or Above",
        minimumDegreeLevel: "bachelor",
        minimumLanguageLevel: null,
        minimumYears: null,
        values: ["Bachelors/ Degree or Above"],
      },
      {
        alternativeGroup: null,
        evidence: "Work Experience: Only at least 2 years",
        importance: "required",
        kind: "experience",
        label: "At least 2 years of experience",
        minimumDegreeLevel: null,
        minimumLanguageLevel: null,
        minimumYears: 2,
        values: ["2 years"],
      },
      {
        alternativeGroup: "nationality",
        evidence: "Nationality: Canada,United Kingdom,United States,Australia",
        importance: "required",
        kind: "citizenship",
        label: "Accepted nationalities",
        minimumDegreeLevel: null,
        minimumLanguageLevel: null,
        minimumYears: null,
        values: ["Canada", "United Kingdom", "United States", "Australia"],
      },
    ]);

    expect(facts.marketSegments).toEqual([
      { evidence: "Employer’s Type: Public University", value: "university" },
    ]);
    expect(facts.compensation).toMatchObject({
      amountMaximum: 20_000,
      amountMinimum: 17_000,
      currency: "RMB",
      period: "month",
    });
    expect(facts.workload).toMatchObject({ teachingHoursPerWeek: 14 });
    expect(facts.benefits.map((benefit) => benefit.value).sort()).toEqual([
      "airfare",
      "healthInsurance",
      "housing",
    ]);
  });

  it("derives every learner band the stated age range touches", () => {
    const spanning = extractAneslFacts({
      "Student’s age": "from: 3 to: 12 years old",
    });
    expect(spanning.audiences.map((entry) => entry.value)).toEqual([
      "preschool",
      "primary",
    ]);

    const adult = extractAneslFacts({
      "Student’s age": "from: 18 to: 25 years old",
    });
    expect(adult.audiences.map((entry) => entry.value)).toEqual([
      "college",
      "adults",
    ]);
  });

  it("tolerates the malformed values the board actually emits", () => {
    // A missing colon on the upper bound appears once in 4,005 listings.
    expect(
      extractAneslFacts({ "Salary/M": "From RMB: 6500 To RMB 6500" })
        .compensation
    ).toMatchObject({ amountMaximum: 6500, amountMinimum: 6500 });

    // An upper bound below the lower one is not a credible range.
    expect(
      extractAneslFacts({ "Salary/M": "From RMB: 17000 To RMB: 1700" })
        .compensation
    ).toMatchObject({ amountMaximum: null, amountMinimum: 17_000 });
  });

  it("omits facts the listing does not state rather than inventing them", () => {
    const sparse = extractAneslFacts({
      Degree: "Nothing or Above",
      Gender: "Unrequired",
      Nationality: "Unrequired",
    });

    expect(sparse.requirements).toEqual([]);
    expect(sparse.audiences).toEqual([]);
    expect(sparse.benefits).toEqual([]);
    expect(sparse.compensation).toBeNull();
    expect(sparse.workload).toBeNull();
  });
});
