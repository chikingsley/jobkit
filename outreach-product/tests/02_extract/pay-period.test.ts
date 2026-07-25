import { describe, expect, it } from "bun:test";
import {
  CONFIDENT_MONTHLY_CEILING_USD,
  CONFIDENT_MONTHLY_FLOOR_USD,
  needsPeriodReading,
  quoteIsGrounded,
  quoteShowsPayPeriod,
} from "../../src/pipeline/02_extract/pay-period";

describe("deciding which listings need reading", () => {
  it("leaves a figure that is only plausible as a monthly wage alone", () => {
    expect(needsPeriodReading(1800)).toBe(false);
    expect(needsPeriodReading(600)).toBe(false);
    expect(needsPeriodReading(2520)).toBe(false);
  });

  it("asks about a figure too small to be a monthly wage", () => {
    expect(needsPeriodReading(8)).toBe(true);
    expect(needsPeriodReading(19)).toBe(true);
    expect(needsPeriodReading(CONFIDENT_MONTHLY_FLOOR_USD - 1)).toBe(true);
  });

  it("asks about a figure too large to be a monthly wage", () => {
    expect(needsPeriodReading(27_500)).toBe(true);
    expect(needsPeriodReading(CONFIDENT_MONTHLY_CEILING_USD + 1)).toBe(true);
  });
});

describe("holding a quote to the advert", () => {
  const question = {
    body: "We pay our teachers $500 a month which includes $100 per month as a flight reimbursement.",
    country: "Kyrgyzstan",
    salary: "$500 USD",
  };

  it("accepts a quote copied from the advert", () => {
    expect(quoteIsGrounded("$500 a month", question)).toBe(true);
  });

  it("accepts a quote copied from the salary field", () => {
    expect(quoteIsGrounded("$500 USD", question)).toBe(true);
  });

  it("rejects a quote the advert never contained", () => {
    expect(quoteIsGrounded("$500 per year", question)).toBe(false);
    expect(quoteIsGrounded("", question)).toBe(false);
  });

  it("ignores differences in whitespace", () => {
    expect(quoteIsGrounded("$500   a  month", question)).toBe(true);
  });
});

describe("requiring a quote to establish the period", () => {
  it("accepts the phrasings real adverts use", () => {
    for (const quote of [
      "$6.50 USD per hour",
      "Salary 2500 yen per hour",
      "$15/hr",
      "20,000 per hour",
      "$300 per month",
      "Monthly Salary commensurate with experience",
      "¥3,500,000 – ¥4,500,000 per year",
      "Annual Salary between 27,500 USD to 47,500 USD",
      "paid every 15th & 30th",
    ]) {
      expect(quoteShowsPayPeriod(quote)).toBe(true);
    }
  });

  it("rejects a bare amount, which proves nothing", () => {
    expect(quoteShowsPayPeriod("$40,000 USD")).toBe(false);
    expect(quoteShowsPayPeriod("¥600 CNY")).toBe(false);
    expect(quoteShowsPayPeriod("$ 300")).toBe(false);
  });

  it("rejects a period attached to a benefit rather than to pay", () => {
    for (const quote of [
      "We offer 300$ as monthly food stipend",
      "one flight per year",
      "36 days holiday per year",
      "Yearly return air ticket",
      "Free annual flights for employee",
      "$100 per month that is given as a reimbursement",
    ]) {
      expect(quoteShowsPayPeriod(quote)).toBe(false);
    }
  });
});
