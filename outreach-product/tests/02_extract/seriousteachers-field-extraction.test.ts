import { describe, expect, it } from "bun:test";
import { extractSeriousTeachersFacts } from "../../src/pipeline/02_extract/seriousteachers-fields";

describe("Serious Teachers salary field", () => {
  it("reads the amount and currency the board prints", () => {
    expect(
      extractSeriousTeachersFacts({ Salary: "$27,500 USD" }).compensation
    ).toMatchObject({ amountMinimum: 27_500, currency: "USD", kind: "amount" });
    expect(
      extractSeriousTeachersFacts({ Salary: "¥23,000 CNY" }).compensation
    ).toMatchObject({ amountMinimum: 23_000, currency: "CNY" });
    expect(
      extractSeriousTeachersFacts({ Salary: "฿55,000 THB" }).compensation
    ).toMatchObject({ amountMinimum: 55_000, currency: "THB" });
  });

  it("records no pay when the board states only that pay is negotiable", () => {
    expect(
      extractSeriousTeachersFacts({ Salary: "Negotiable" }).compensation
    ).toBeNull();
  });

  it("never states a period, because the board does not", () => {
    const pay = extractSeriousTeachersFacts({
      Salary: "$27,500 USD",
    }).compensation;
    expect(pay?.period).toBeNull();
  });

  it("omits pay when the board printed no salary", () => {
    expect(extractSeriousTeachersFacts({}).compensation).toBeNull();
    expect(extractSeriousTeachersFacts({ Salary: "" }).compensation).toBeNull();
  });
});

describe("Serious Teachers required degrees", () => {
  it("reads the spellings the board actually publishes", () => {
    for (const stated of [
      "Bachelor",
      "Bachelor Degree",
      "Bachelor’s Degree",
      "BA",
      "Bachelors Degree",
      "Bachelor of Education",
      "Bachelor degree or above",
    ]) {
      const [requirement] = extractSeriousTeachersFacts({
        "Required Degrees": stated,
      }).requirements;
      expect(requirement?.minimumDegreeLevel).toBe("bachelor");
    }
  });

  it("ranks a higher degree above a bachelor", () => {
    expect(
      extractSeriousTeachersFacts({ "Required Degrees": "PhD required" })
        .requirements[0]?.minimumDegreeLevel
    ).toBe("doctorate");
    expect(
      extractSeriousTeachersFacts({ "Required Degrees": "Masters preferred" })
        .requirements[0]?.minimumDegreeLevel
    ).toBe("master");
  });

  it("records a teaching certificate as a certificate, not a degree", () => {
    expect(
      extractSeriousTeachersFacts({ "Required Degrees": "TEFL" })
        .requirements[0]?.minimumDegreeLevel
    ).toBe("certificate");
    expect(
      extractSeriousTeachersFacts({ "Required Degrees": "CELTA or PGCE" })
        .requirements[0]?.minimumDegreeLevel
    ).toBe("certificate");
  });

  it("records nothing when the stated degree names no level", () => {
    expect(
      extractSeriousTeachersFacts({ "Required Degrees": "None required" })
        .requirements
    ).toEqual([]);
  });
});

describe("Serious Teachers fields of expertise", () => {
  const REAL_LISTING =
    "ESL/EFL, Nursery, Elementary, ESL to Children, Kindergarten, High School, Science, Math/Physics, Leadership,Exams Officer,Primary,ICT,Buss.Studies";

  it("derives every learner group the list names", () => {
    const audiences = extractSeriousTeachersFacts({
      "Fields of Expertise": REAL_LISTING,
    }).audiences.map((entry) => entry.value);
    expect(audiences).toContain("preschool");
    expect(audiences).toContain("primary");
    expect(audiences).toContain("teenagers");
  });

  it("derives the segment from the same list", () => {
    const segments = extractSeriousTeachersFacts({
      "Fields of Expertise": REAL_LISTING,
    }).marketSegments.map((entry) => entry.value);
    expect(segments).toContain("language_center");
    expect(segments).toContain("kindergarten");
  });

  it("separates an international school from a language centre", () => {
    expect(
      extractSeriousTeachersFacts({
        "Fields of Expertise": "International School, IGCSE, A Level",
      }).marketSegments.map((entry) => entry.value)
    ).toContain("international_school");
  });

  it("records nothing when the board names no expertise", () => {
    const extracted = extractSeriousTeachersFacts({});
    expect(extracted.audiences).toEqual([]);
    expect(extracted.marketSegments).toEqual([]);
  });

  it("carries the stated list as evidence for what it derived", () => {
    const [audience] = extractSeriousTeachersFacts({
      "Fields of Expertise": "Kindergarten",
    }).audiences;
    expect(audience?.evidence).toBe("Fields of Expertise: Kindergarten");
  });
});
