import { describe, expect, it } from "bun:test";
import {
  canonicalCountry,
  cleanTitle,
  credibleTeachingHours,
  normalizeListing,
  type RawListing,
  statedRestrictions,
} from "../../src/pipeline/02_extract/normalize";
import { disqualifying } from "../../src/pipeline/04_compose/candidate";
import { placeFrom } from "../../src/pipeline/04_compose/message";

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

describe("pay readings that are not credible for a teaching role", () => {
  it("prefers the country currency when the stated code gives an incredible figure", () => {
    const listing = normalizeListing(
      raw({
        amountMaximum: null,
        amountMinimum: 250_000,
        country: "Japan",
        currency: "USD",
        evidence: ["$250,000 USD"],
        period: null,
        teachingHours: null,
        title: "Preschool & afterschool Teacher",
      })
    );
    expect(listing.currency).toBe("JPY");
    expect(listing.monthlyUsd).toBeLessThan(2000);
    expect(listing.monthlyUsd).toBeGreaterThan(1000);
  });

  it("leaves pay unset when no reading of the figure is credible", () => {
    const listing = normalizeListing(
      raw({
        amountMaximum: null,
        amountMinimum: 210_000,
        country: "United Kingdom",
        currency: null,
        evidence: ["210,000 per annum"],
        period: "year",
        teachingHours: null,
        title: "Teachers/Admin Officers Wanted.",
      })
    );
    expect(listing.monthlyUsd).toBeNull();
    expect(listing.currency).toBe("GBP");
  });

  it("keeps a genuinely high international salary", () => {
    const listing = normalizeListing(
      raw({
        amountMaximum: 100_000,
        amountMinimum: 75_000,
        country: "China",
        currency: "USD",
        evidence: ["USD 75k-100k per year"],
        period: "year",
        teachingHours: null,
        title: "Director of Curriculum Center",
      })
    );
    expect(listing.monthlyUsd).toBe(7292);
  });
});

describe("hourly rates that are not credible for teaching", () => {
  it("keeps an ordinary hourly rate and converts it", () => {
    const listing = normalizeListing(
      raw({
        amountMaximum: null,
        amountMinimum: 8,
        country: "",
        currency: "USD",
        location: "Remote",
        period: "hour",
        teachingHours: null,
        title: "Online Business English Teacher",
      })
    );
    expect(listing.monthlyUsd).toBe(693);
  });

  it("refuses a rate no teaching job pays by the hour", () => {
    const listing = normalizeListing(
      raw({
        amountMaximum: null,
        amountMinimum: 15_000,
        country: "Japan",
        currency: "JPY",
        period: "hour",
        teachingHours: null,
        title: "Part-Time Eikaiwa Native English Teacher",
      })
    );
    expect(listing.monthlyUsd).toBeNull();
  });
});

describe("falling back to the country currency", () => {
  it("uses the country currency when the stated one gives an impossible figure", () => {
    const listing = normalizeListing(
      raw({
        amountMaximum: null,
        amountMinimum: 20_000,
        country: "Mexico",
        currency: "USD",
        period: null,
        teachingHours: null,
        title: "Kindergarten Teacher",
      })
    );
    expect(listing.currency).toBe("MXN");
    expect(listing.monthlyUsd).toBe(1100);
  });

  it("never reinterprets a stated currency merely because the period is unknown", () => {
    const listing = normalizeListing(
      raw({
        amountMaximum: null,
        amountMinimum: 300,
        country: "Kuwait",
        currency: "USD",
        period: null,
        teachingHours: null,
        title: "teacher",
      })
    );
    expect(listing.monthlyUsd).toBeNull();
  });
});

describe("monthly figures too small to be a wage", () => {
  it("refuses a figure no monthly salary could be, even with a stated period", () => {
    for (const [amount, currency] of [
      [30, "CNY"],
      [260_000, "KRW"],
      [2500, "TRY"],
    ] as [number, string][]) {
      const listing = normalizeListing(
        raw({
          amountMaximum: null,
          amountMinimum: amount,
          country: "",
          currency,
          location: "",
          period: "month",
          teachingHours: null,
        })
      );
      expect(listing.monthlyUsd).toBeNull();
    }
  });

  it("keeps a low but real salary", () => {
    const listing = normalizeListing(
      raw({
        amountMaximum: null,
        amountMinimum: 400,
        country: "Ecuador",
        currency: "USD",
        period: "month",
        teachingHours: null,
      })
    );
    expect(listing.monthlyUsd).toBe(400);
  });
});

describe("place naming", () => {
  it("names the country rather than a mangled city list", () => {
    expect(
      placeFrom("United States", "United States of America, Sarasota")
    ).toBe("United States");
  });

  it("removes a country the location already repeats", () => {
    expect(placeFrom("Bermuda", "Bermuda, Devonshire")).toBe(
      "Devonshire, Bermuda"
    );
  });
});

describe("scaling a bare amount", () => {
  it("scales when the currency belongs to the country", () => {
    expect(
      normalizeListing(
        raw({
          amountMaximum: null,
          amountMinimum: 2.5,
          country: "South Korea",
          currency: "KRW",
          period: "month",
          teachingHours: null,
        })
      ).monthlyUsd
    ).toBe(1825);
  });

  it("never scales a currency the country does not use", () => {
    expect(
      normalizeListing(
        raw({
          amountMaximum: null,
          amountMinimum: 1200,
          country: "Brazil",
          currency: "KRW",
          period: null,
          teachingHours: null,
        })
      ).monthlyUsd
    ).toBeNull();
  });
});

describe("place naming with messy locations", () => {
  it("drops a list of cities and names the country", () => {
    expect(
      placeFrom("United Arab Emirates", "UAE, Dubai, Abu Dhabi, Shahrja")
    ).toBe("United Arab Emirates");
    expect(placeFrom("Malaysia", "Malaysia, Pahang, Johor, Terengganu")).toBe(
      "Malaysia"
    );
  });

  it("keeps a single city", () => {
    expect(placeFrom("Japan", "Nagoya")).toBe("Nagoya, Japan");
  });
});

describe("who a restriction actually rules out", () => {
  it("does not rule a man out of a job that says male", () => {
    expect(disqualifying(["male-only"], "Qatar")).toEqual([]);
  });

  it("rules a man out of a job that says female", () => {
    expect(disqualifying(["female-only"], "Qatar")).toEqual(["female-only"]);
  });

  it("does not rule a native speaker out of a native-speaker job", () => {
    expect(disqualifying(["native-speaker-only"], "Japan")).toEqual([]);
  });

  it("rules out local-only jobs abroad but not at home", () => {
    expect(disqualifying(["local-candidates-only"], "Japan")).toEqual([
      "local-candidates-only",
    ]);
    expect(disqualifying(["local-candidates-only"], "United States")).toEqual(
      []
    );
  });

  it("rules out anything that is not a teaching job", () => {
    expect(disqualifying(["not-teaching"], "Qatar")).toEqual(["not-teaching"]);
  });
});
