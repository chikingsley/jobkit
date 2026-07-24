import { describe, expect, it } from "vitest";
import {
  evidenceIsPresent,
  foldEvidencePunctuation,
} from "../../worker/ai/evidence-text";
import { canonicalEvidenceQuote } from "../../worker/ai/job-position-extraction";

const CURLY_SOURCE =
  "Employer’s Type: Private Middle School. Students’ age: 12–19. Salary — competitive.";

describe("evidence punctuation folding", () => {
  it("keeps the folded string the same length as the original", () => {
    expect(foldEvidencePunctuation(CURLY_SOURCE)).toHaveLength(
      CURLY_SOURCE.length
    );
  });

  it("matches a straight-apostrophe quote against curly source text", () => {
    expect(
      evidenceIsPresent(CURLY_SOURCE, "Employer's Type: Private Middle School")
    ).toBe(true);
  });

  it("matches straight quotes and hyphens against curly and dash source text", () => {
    expect(evidenceIsPresent(CURLY_SOURCE, "Students' age: 12-19")).toBe(true);
    expect(evidenceIsPresent(CURLY_SOURCE, "Salary - competitive")).toBe(true);
  });

  it("still rejects text that is genuinely absent", () => {
    expect(evidenceIsPresent(CURLY_SOURCE, "Housing allowance provided")).toBe(
      false
    );
    expect(evidenceIsPresent(CURLY_SOURCE, "   ")).toBe(false);
  });

  it("canonicalizes a straight quote back to the source's real typography", () => {
    expect(
      canonicalEvidenceQuote(
        CURLY_SOURCE,
        "Employer's Type: Private Middle School"
      )
    ).toBe("Employer’s Type: Private Middle School");
  });
});
