import { describe, expect, it } from "bun:test";
import { extractTeacherHorizonsFacts } from "../../src/pipeline/02_extract/teacherhorizons-fields";

const REAL_LISTING = {
  boosted: "true",
  city: "Casablanca",
  closing: "2026-08-01",
  country: "Morocco",
  region: "Africa",
  role: "Secondary Subject Teacher",
  role_id: "20",
  start_date: "2026-08-31",
  subject: "Mathematics",
  subject_id: "39",
};

describe("teacherhorizons source field extraction", () => {
  it("reads the learner group, school type, start date, and subject", () => {
    const facts = extractTeacherHorizonsFacts(REAL_LISTING);

    expect(facts.audiences).toEqual([
      { evidence: "role: Secondary Subject Teacher", value: "teenagers" },
    ]);
    expect(facts.marketSegments).toEqual([
      {
        evidence: "role: Secondary Subject Teacher",
        value: "international_school",
      },
    ]);
    expect(facts.requirements.map((entry) => entry.kind)).toEqual([
      "availability",
      "skill",
    ]);
    expect(facts.requirements[0]).toMatchObject({
      label: "Available to start 2026-08-31",
      values: ["2026-08-31"],
    });
    expect(facts.requirements[1]).toMatchObject({
      label: "Teaches Mathematics",
      values: ["Mathematics"],
    });
  });

  it("maps every learner group the board actually publishes", () => {
    const bands = [
      ["Early Years / Kindergarten Teacher", "preschool"],
      ["Primary / Elementary Teacher", "primary"],
      ["Secondary Subject Teacher", "teenagers"],
    ] as const;
    for (const [role, expected] of bands) {
      expect(
        extractTeacherHorizonsFacts({ role }).audiences.map(
          (entry) => entry.value
        )
      ).toEqual([expected]);
    }
  });

  it("omits a learner group for roles that state none", () => {
    // 61 of 363 listings are leadership or coordinator roles with no year group.
    for (const role of [
      "Head of Department",
      "Curriculum Coordinator",
      "Counsellor",
    ]) {
      expect(extractTeacherHorizonsFacts({ role }).audiences).toEqual([]);
    }
  });

  it("skips a placeholder subject rather than recording it as a skill", () => {
    for (const subject of ["Unspecified", "Other Subject"]) {
      expect(
        extractTeacherHorizonsFacts({
          role: "Secondary Subject Teacher",
          subject,
        }).requirements
      ).toEqual([]);
    }
  });

  it("ignores a start date that is not a calendar date", () => {
    expect(
      extractTeacherHorizonsFacts({ start_date: "ASAP" }).requirements
    ).toEqual([]);
  });
});
