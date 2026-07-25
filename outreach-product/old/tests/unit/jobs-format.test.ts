import { describe, expect, test } from "bun:test";
import { humanize } from "../../src/features/jobs/format";

describe("job display formatting", () => {
  test("separates structured camel-case benefit names", () => {
    expect(humanize("healthInsurance")).toBe("Health Insurance");
    expect(humanize("visaSponsorship")).toBe("Visa Sponsorship");
    expect(humanize("paidLeave")).toBe("Paid Leave");
  });
});
