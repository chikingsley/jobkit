import { describe, expect, it } from "vitest";
import { compensationDisplay, monthlyCompensationUsd } from "./compensation";
import type { Compensation, FxData } from "./types";

const fx: FxData = {
  rates: { JPY: 150, USD: 1 },
  updatedAt: null,
};

const annual: Compensation = {
  amountMax: null,
  amountMin: 24_000,
  confidence: "exact",
  currency: "USD",
  display: "$24,000 USD/year",
  notes: [],
  period: "year",
  qualifier: "exact",
  source: "listing-field",
};

describe("normalized compensation presentation", () => {
  it("uses a persisted annual period for monthly matching", () => {
    expect(monthlyCompensationUsd(annual, fx)).toBe(2000);
  });

  it("does not convert persisted currency conflicts", () => {
    const conflict: Compensation = {
      ...annual,
      confidence: "conflict",
      notes: ["The salary field and description use different currencies."],
    };
    const result = compensationDisplay(conflict, fx);

    expect(result.usd).toBeNull();
    expect(result.warning).toContain("different currencies");
  });
});
