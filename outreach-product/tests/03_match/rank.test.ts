import { describe, expect, it } from "bun:test";
import type { CanonicalListing } from "../../src/pipeline/02_extract/normalize";
import { rankListings } from "../../src/pipeline/03_match/rank";

function listing(overrides: Partial<CanonicalListing> = {}): CanonicalListing {
  return {
    benefits: [],
    board: "eslcafe-modern",
    company: "Example School",
    country: "China",
    currency: "CNY",
    id: crypto.randomUUID(),
    location: "Beijing",
    monthlyUsd: 2500,
    perHourUsd: null,
    period: "month",
    restrictions: [],
    teachingHours: null,
    title: "English Teacher",
    ...overrides,
  };
}

describe("ranking canonical listings", () => {
  it("orders by monthly pay and breaks ties on identifier", () => {
    const ranked = rankListings([
      listing({ company: "A", id: "z", monthlyUsd: 1000 }),
      listing({ company: "B", id: "y", monthlyUsd: 3000 }),
      listing({ company: "C", id: "x", monthlyUsd: 3000 }),
    ]);
    expect(ranked.map((entry) => entry.id)).toEqual(["x", "y", "z"]);
  });

  it("keeps a listing with no established pay and marks it unknown", () => {
    const ranked = rankListings([listing({ id: "a", monthlyUsd: null })]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.payKnown).toBe(false);
    expect(ranked[0]?.monthlyUsd).toBeNull();
  });

  it("orders every priced listing ahead of every unpriced one", () => {
    const ranked = rankListings([
      listing({ company: "A", id: "unpriced-high", monthlyUsd: null }),
      listing({ company: "B", id: "priced-low", monthlyUsd: 900 }),
      listing({ company: "C", id: "unpriced-low", monthlyUsd: null }),
      listing({ company: "D", id: "priced-high", monthlyUsd: 5000 }),
    ]);
    expect(ranked.map((entry) => entry.id)).toEqual([
      "priced-high",
      "priced-low",
      "unpriced-high",
      "unpriced-low",
    ]);
    expect(ranked.map((entry) => entry.payKnown)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("collapses an employer reposting with pay unstated on both", () => {
    const ranked = rankListings([
      listing({ company: "Same School", id: "a", monthlyUsd: null }),
      listing({ company: "Same School", id: "b", monthlyUsd: null }),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.repostedAs).toEqual(["b"]);
  });

  it("keeps an unpriced listing apart from the same employer's priced one", () => {
    const ranked = rankListings([
      listing({ company: "Same School", id: "a", monthlyUsd: 2500 }),
      listing({ company: "Same School", id: "b", monthlyUsd: null }),
    ]);
    expect(ranked).toHaveLength(2);
  });

  it("collapses the same employer reposting at the same pay", () => {
    const ranked = rankListings([
      listing({ company: "Bright Future", id: "a" }),
      listing({ company: "Bright Future", id: "b" }),
      listing({ company: "Bright Future", id: "c" }),
      listing({ company: "Other School", id: "d" }),
    ]);
    expect(ranked).toHaveLength(2);
    expect(
      ranked.find((entry) => entry.company === "Bright Future")?.repostedAs
    ).toHaveLength(2);
  });

  it("keeps listings apart when no employer is named", () => {
    const ranked = rankListings([
      listing({ company: "", id: "a" }),
      listing({ company: "", id: "b" }),
    ]);
    expect(ranked).toHaveLength(2);
  });

  it("treats a different pay band as a different listing", () => {
    const ranked = rankListings([
      listing({ company: "Same School", id: "a", monthlyUsd: 2500 }),
      listing({ company: "Same School", id: "b", monthlyUsd: 4000 }),
    ]);
    expect(ranked).toHaveLength(2);
  });
});
