import { describe, expect, it } from "bun:test";
import {
  correctMagnitude,
  currencyForCountry,
  inferPeriod,
  isoCurrencyCode,
  MONTHLY_FX_TO_USD,
  periodFromMagnitude,
  resolveCurrency,
} from "../../src/pipeline/02_extract/currency";

describe("currency resolution", () => {
  it("normalises the codes boards actually write", () => {
    expect(isoCurrencyCode("RMB")).toBe("CNY");
    expect(isoCurrencyCode("rmb")).toBe("CNY");
    expect(isoCurrencyCode("NTD")).toBe("TWD");
    expect(isoCurrencyCode("won")).toBe("KRW");
    expect(isoCurrencyCode("CNY")).toBe("CNY");
  });

  it("rejects a code it holds no rate for rather than passing it through", () => {
    expect(isoCurrencyCode("XYZ")).toBeNull();
    expect(isoCurrencyCode("")).toBeNull();
    expect(isoCurrencyCode(null)).toBeNull();
  });

  it("recovers the currency from the country when the listing omits it", () => {
    expect(currencyForCountry("South Korea")).toBe("KRW");
    expect(currencyForCountry("taiwan")).toBe("TWD");
    expect(currencyForCountry("China")).toBe("CNY");
    expect(currencyForCountry("Brazil")).toBe("BRL");
    expect(currencyForCountry("Mongolia")).toBe("MNT");
    expect(currencyForCountry("Hong Kong")).toBe("HKD");
    expect(currencyForCountry("")).toBeNull();
  });

  it("prefers a stated code over the country default", () => {
    expect(resolveCurrency("USD", "China")).toBe("USD");
    expect(resolveCurrency(null, "China")).toBe("CNY");
    expect(resolveCurrency("XYZ", "Taiwan")).toBe("TWD");
    expect(resolveCurrency(null, null)).toBeNull();
  });

  it("holds a rate for every currency it maps a country to", () => {
    for (const country of [
      "South Korea",
      "Taiwan",
      "Mongolia",
      "Hong Kong",
      "Indonesia",
      "Maldives",
      "Russia",
      "Brazil",
    ]) {
      const currency = currencyForCountry(country);
      expect(currency).not.toBeNull();
      expect(MONTHLY_FX_TO_USD[currency as string]).toBeGreaterThan(0);
    }
  });

  it("scales an amount the model recorded in millions as a bare number", () => {
    expect(correctMagnitude(2.5, "KRW", "month")).toBe(2_500_000);
    expect(correctMagnitude(1.7, "KRW", "month")).toBe(1_700_000);
    expect(correctMagnitude(3, "KRW", "month")).toBe(3_000_000);
  });

  it("leaves an amount that is already plausible untouched", () => {
    expect(correctMagnitude(2_600_000, "KRW", "month")).toBe(2_600_000);
    expect(correctMagnitude(26_000, "CNY", "month")).toBe(26_000);
    expect(correctMagnitude(3500, "USD", "month")).toBe(3500);
    expect(correctMagnitude(62_000, "TWD", "month")).toBe(62_000);
  });

  it("leaves an amount that is plausible as an hourly rate alone", () => {
    expect(correctMagnitude(20, "CNY", "month")).toBe(20);
    expect(correctMagnitude(3, "USD", "month")).toBe(3);
  });

  it("returns the original when no scaling makes it plausible", () => {
    expect(correctMagnitude(0, "KRW", "month")).toBe(0);
    expect(correctMagnitude(-5, "CNY", "month")).toBe(-5);
  });
});

describe("period inference", () => {
  it("reads an hourly rate the extractor left unlabelled", () => {
    expect(inferPeriod(null, ["Earn $15-$24/h USD"])).toBe("hour");
    expect(inferPeriod(null, ["25 USD per hour"])).toBe("hour");
    expect(inferPeriod(null, ["hourly rate 30"])).toBe("hour");
  });

  it("reads yearly, weekly, and monthly figures", () => {
    expect(inferPeriod(null, ["120,000 per year"])).toBe("year");
    expect(inferPeriod(null, ["Salary: 45000/yr"])).toBe("year");
    expect(inferPeriod(null, ["800 per week"])).toBe("week");
    expect(inferPeriod(null, ["Salary/M: From RMB: 17000"])).toBe("month");
  });

  it("never overrides a period the extractor already stated", () => {
    expect(inferPeriod("month", ["Earn $20/h"])).toBe("month");
  });

  it("stays unknown when the evidence names no period", () => {
    expect(inferPeriod(null, ["Competitive salary"])).toBeNull();
    expect(inferPeriod(null, [])).toBeNull();
  });

  it("never scales an amount that is plausible as an hourly rate", () => {
    expect(correctMagnitude(19.5, "USD", "hour")).toBe(19.5);
    expect(correctMagnitude(19.5, "USD", "month")).toBe(19.5);
    expect(correctMagnitude(1000, "JPY", null)).toBe(1000);
  });
});

describe("period inference from magnitude", () => {
  it("reads a figure that is only plausible as an annual salary", () => {
    expect(periodFromMagnitude(21_000, "EUR", null)).toBe("year");
    expect(periodFromMagnitude(17_500, "GBP", null)).toBe("year");
    expect(periodFromMagnitude(420_000, "MXN", null)).toBe("year");
  });

  it("leaves a figure that is plausible as a monthly salary alone", () => {
    expect(periodFromMagnitude(20_000, "CNY", null)).toBeNull();
    expect(periodFromMagnitude(3_500_000, "KRW", null)).toBeNull();
    expect(periodFromMagnitude(4500, "USD", null)).toBeNull();
    expect(periodFromMagnitude(60_000, "TWD", null)).toBeNull();
  });

  it("never overrides a period the listing stated", () => {
    expect(periodFromMagnitude(21_000, "EUR", "month")).toBe("month");
    expect(periodFromMagnitude(120_000, "USD", "year")).toBe("year");
  });
});
