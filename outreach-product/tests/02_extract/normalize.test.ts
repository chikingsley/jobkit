import { describe, expect, it } from "bun:test";
import {
  canonicalCountry,
  cleanTitle,
  credibleTeachingHours,
  normalizeListing,
  type RawListing,
  statedRestrictions,
} from "../../src/pipeline/02_extract/normalize";

function raw(overrides: Partial<RawListing> = {}): RawListing {
  return {
    amountMaximum: 20_000,
    amountMinimum: 18_000,
    benefits: [],
    board: "eslcafe-modern",
    company: "Example School",
    country: "China",
    currency: "CNY",
    description: "",
    evidence: [],
    id: "job-1",
    location: "Beijing",
    period: "month",
    teachingHours: 20,
    title: "English Teacher",
    ...overrides,
  };
}

describe("title cleaning", () => {
  it("strips the decoration boards put in titles", () => {
    expect(cleanTitle("⭐⭐⭐ High Paying Kindergarten")).toBe(
      "High Paying Kindergarten"
    );
    expect(cleanTitle("🎓🎓 1-Year University Post 🎓")).toBe(
      "1-Year University Post"
    );
    expect(cleanTitle("Updated: ▄▅▇████ High Paying")).toBe(
      "Updated: High Paying"
    );
    expect(cleanTitle("📢[Direct HIre] Fvisa teachers")).toBe(
      "[Direct HIre] Fvisa teachers"
    );
  });

  it("collapses repeated punctuation and whitespace", () => {
    expect(cleanTitle("Teacher!!!  Wanted---  Now")).toBe(
      "Teacher! Wanted- Now"
    );
  });

  it("leaves an ordinary title untouched", () => {
    expect(cleanTitle("IGCSE Physics Teacher (ASAP Start)")).toBe(
      "IGCSE Physics Teacher (ASAP Start)"
    );
  });
});

describe("country normalisation", () => {
  it("keeps a stated country and resolves its common aliases", () => {
    expect(canonicalCountry("China", "", "")).toBe("China");
    expect(canonicalCountry("USA", "", "")).toBe("United States");
    expect(canonicalCountry("uk", "", "")).toBe("United Kingdom");
    expect(canonicalCountry("Korea", "", "")).toBe("South Korea");
  });

  it("recovers an empty country from the location or the title", () => {
    expect(canonicalCountry("", "Gang-dong-gu", "")).toBe("South Korea");
    expect(canonicalCountry("", "", "Teachers needed in Beijing")).toBe(
      "China"
    );
    expect(canonicalCountry("", "Puli", "International School Teacher")).toBe(
      "Taiwan"
    );
    expect(canonicalCountry("", "Ulaanbaatar", "")).toBe("Mongolia");
    expect(canonicalCountry("", "Rio de Janeiro", "")).toBe("Brazil");
  });

  it("stays empty when nothing names a country", () => {
    expect(canonicalCountry("", "Remote", "Online ESL Teacher")).toBe("");
  });
});

describe("stated restrictions", () => {
  it("records a restriction the listing states", () => {
    expect(
      statedRestrictions("Female Special Educational Needs Teacher")
    ).toEqual(["female-only"]);
    expect(statedRestrictions("Native English speakers only")).toEqual([
      "native-speaker-only",
    ]);
    expect(
      statedRestrictions("IGCSE Physics Teacher - local candidates only")
    ).toEqual(["local-candidates-only"]);
    expect(statedRestrictions("Applicants must be under 35")).toEqual([
      "age-limited",
    ]);
  });

  it("records nothing when the listing states no restriction", () => {
    expect(statedRestrictions("English Teacher, Beijing")).toEqual([]);
  });
});

describe("listing normalisation", () => {
  it("produces one canonical record with pay converted", () => {
    const listing = normalizeListing(raw());
    expect(listing.monthlyUsd).toBe(2660);
    expect(listing.perHourUsd).toBe(31);
    expect(listing.currency).toBe("CNY");
  });

  it("recovers a currency the extractor omitted", () => {
    const listing = normalizeListing(
      raw({
        amountMaximum: 3_000_000,
        amountMinimum: 2_600_000,
        country: "",
        currency: null,
        location: "Gyeonggi",
        teachingHours: null,
      })
    );
    expect(listing.currency).toBe("KRW");
    expect(listing.country).toBe("South Korea");
    expect(listing.monthlyUsd).toBeGreaterThan(1500);
  });

  it("scales a salary the extractor recorded in bare millions", () => {
    const listing = normalizeListing(
      raw({
        amountMaximum: null,
        amountMinimum: 2.5,
        country: "South Korea",
        currency: null,
        teachingHours: 26,
      })
    );
    expect(listing.monthlyUsd).toBeGreaterThan(1500);
  });

  it("treats a per-lesson fee as a rate rather than a monthly salary", () => {
    const listing = normalizeListing(
      raw({
        amountMaximum: null,
        amountMinimum: 1000,
        country: "Japan",
        currency: "JPY",
        evidence: ["Rate: Japanese yen - ¥1,000 per 25-minute private lesson"],
        period: null,
        teachingHours: null,
      })
    );
    expect(listing.period).toBe("hour");
    expect(listing.monthlyUsd).toBeLessThan(1500);
  });

  it("discards an implausible weekly load rather than deriving a rate from it", () => {
    expect(credibleTeachingHours(85)).toBeNull();
    const listing = normalizeListing(raw({ teachingHours: 85 }));
    expect(listing.teachingHours).toBeNull();
    expect(listing.perHourUsd).toBeNull();
    expect(listing.monthlyUsd).toBe(2660);
  });

  it("collapses repeated benefit entries", () => {
    const listing = normalizeListing(
      raw({
        benefits: [
          "housing",
          "airfare",
          "healthInsurance",
          "airfare",
          "housing",
        ],
      })
    );
    expect(listing.benefits).toEqual(["airfare", "healthInsurance", "housing"]);
  });

  it("leaves pay unset when no currency can be established", () => {
    const listing = normalizeListing(
      raw({
        country: "",
        currency: null,
        location: "Remote",
        title: "Online ESL",
      })
    );
    expect(listing.currency).toBeNull();
    expect(listing.monthlyUsd).toBeNull();
  });
});

describe("gender restriction precision", () => {
  it("does not flag a listing that welcomes both genders", () => {
    expect(
      statedRestrictions(
        "ABOUT YOU: English Teacher: Female/Male Native English speaker Age range: 23-40"
      )
    ).not.toContain("female-only");
    expect(
      statedRestrictions("Female/Male Native English speaker")
    ).not.toContain("male-only");
    expect(statedRestrictions("male or female welcome")).toEqual([]);
    expect(statedRestrictions("open to any gender")).toEqual([]);
  });

  it("does not flag one gendered role inside a list of positions", () => {
    expect(
      statedRestrictions(
        "Position: - Nursery teacher(Female) - Kindergarten homeroom teacher - Primary English teacher"
      )
    ).toEqual([]);
  });

  it("flags only genuinely restrictive phrasing", () => {
    expect(statedRestrictions("Female candidates only")).toEqual([
      "female-only",
    ]);
    expect(statedRestrictions("We hire only female teachers")).toEqual([
      "female-only",
    ]);
    expect(statedRestrictions("Applicant must be female")).toEqual([
      "female-only",
    ]);
    expect(statedRestrictions("Male applicants only")).toEqual(["male-only"]);
    expect(statedRestrictions("women only, boarding school")).toEqual([
      "female-only",
    ]);
  });
});
