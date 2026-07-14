import { describe, expect, it } from "vitest";
import { normalizeCompensation } from "../../../worker/jobs/compensation";

describe("compensation import normalization", () => {
  it("uses a labeled description currency when the board field is numeric", () => {
    expect(
      normalizeCompensation({
        description:
          "Fields of Expertise: University, Salary: ¥240,000 JPY Details: Teaching role",
        salary: "240,000",
      })
    ).toMatchObject({
      amountMin: 240_000,
      confidence: "exact",
      currency: "JPY",
      source: "listing-description",
    });
  });

  it("extracts a labeled pay rate when the salary field is empty", () => {
    expect(
      normalizeCompensation({
        description:
          "Contract Type: Full time. Pay Rates: 7500 PLN nett/ month.",
        salary: "",
      })
    ).toMatchObject({
      amountMin: 7500,
      currency: "PLN",
      period: "month",
    });
  });

  it("records conflicting field and description currencies without converting", () => {
    expect(
      normalizeCompensation({
        description: "Salary: ¥358,500 JPY Details: Kindergarten teacher",
        salary: "RMB 358,500",
      })
    ).toMatchObject({
      amountMin: null,
      confidence: "conflict",
      currency: null,
    });
  });
});
