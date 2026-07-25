import { describe, expect, it } from "bun:test";
import {
  credibleTeachingHours,
  monthlyAmount,
  normalizeBenefits,
  type RankableJob,
  rankJobs,
} from "../../src/pipeline/03_match/rank";

const RATES = { CNY: 0.14, THB: 0.028, USD: 1 };

function job(overrides: Partial<RankableJob> = {}): RankableJob {
  return {
    amountMaximum: 20_000,
    amountMinimum: 18_000,
    benefits: [],
    board: "eslcafe-modern",
    company: "Example School",
    country: "China",
    currency: "CNY",
    id: crypto.randomUUID(),
    location: "Beijing",
    period: "month",
    teachingHours: 20,
    title: "English Teacher",
    ...overrides,
  };
}

describe("job ranking", () => {
  it("drops an implausible weekly teaching load instead of dividing by it", () => {
    expect(credibleTeachingHours(85)).toBeNull();
    expect(credibleTeachingHours(0)).toBeNull();
    expect(credibleTeachingHours(-4)).toBeNull();
    expect(credibleTeachingHours(25)).toBe(25);

    const [ranked] = rankJobs([job({ teachingHours: 85 })], RATES);
    expect(ranked?.perHourUsd).toBeNull();
    expect(ranked?.monthlyUsd).toBeGreaterThan(0);
  });

  it("removes repeated benefit entries and orders them stably", () => {
    expect(
      normalizeBenefits([
        "housing",
        "airfare",
        "healthInsurance",
        "airfare",
        "healthInsurance",
        "housing",
      ])
    ).toEqual(["airfare", "healthInsurance", "housing"]);
  });

  it("converts a yearly, weekly, or hourly figure to a monthly one", () => {
    expect(
      monthlyAmount(
        job({ amountMaximum: 120_000, amountMinimum: 120_000, period: "year" })
      )
    ).toBe(10_000);
    expect(
      monthlyAmount(
        job({ amountMaximum: 1000, amountMinimum: 1000, period: "week" })
      )
    ).toBeCloseTo(4330, 0);
    expect(
      monthlyAmount(
        job({
          amountMaximum: 50,
          amountMinimum: 50,
          period: "hour",
          teachingHours: 20,
        })
      )
    ).toBeCloseTo(4330, 0);
  });

  it("assumes a normal week when an hourly rate states no hours", () => {
    expect(
      monthlyAmount(
        job({
          amountMaximum: 50,
          amountMinimum: 50,
          period: "hour",
          teachingHours: null,
        })
      )
    ).toBeCloseTo(4330, 0);
  });

  it("collapses the same agency posting repeated at the same pay", () => {
    const ranked = rankJobs(
      [
        job({
          company: "Bright Future",
          id: "a",
          title: "ESL Teacher, Beijing",
        }),
        job({
          company: "Bright Future",
          id: "b",
          title: "ESL Teacher Beijing",
        }),
        job({
          company: "Bright Future",
          id: "c",
          title: "ESL Teachers Beijing",
        }),
        job({ company: "Other School", id: "d" }),
      ],
      RATES
    );

    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.duplicateOf).toHaveLength(2);
  });

  it("keeps separate listings that share no employer name", () => {
    const ranked = rankJobs(
      [job({ company: "", id: "a" }), job({ company: "", id: "b" })],
      RATES
    );
    expect(ranked).toHaveLength(2);
  });

  it("drops a currency it cannot convert rather than ranking it at zero", () => {
    expect(rankJobs([job({ currency: "XYZ" })], RATES)).toEqual([]);
    expect(rankJobs([job({ currency: null })], RATES)).toEqual([]);
  });

  it("drops a monthly figure past the credible ceiling", () => {
    expect(
      rankJobs(
        [
          job({
            amountMaximum: 900_000,
            amountMinimum: 900_000,
            currency: "USD",
          }),
        ],
        RATES
      )
    ).toEqual([]);
  });

  it("orders by monthly pay and breaks ties deterministically", () => {
    const ranked = rankJobs(
      [
        job({
          amountMaximum: 10_000,
          amountMinimum: 10_000,
          company: "A",
          id: "z",
        }),
        job({
          amountMaximum: 30_000,
          amountMinimum: 30_000,
          company: "B",
          id: "y",
        }),
        job({
          amountMaximum: 30_000,
          amountMinimum: 30_000,
          company: "C",
          id: "x",
        }),
      ],
      RATES
    );
    expect(ranked.map((entry) => entry.id)).toEqual(["x", "y", "z"]);
  });
});
