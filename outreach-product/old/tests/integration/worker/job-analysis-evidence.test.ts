import { describe, expect, it } from "vitest";
import { canonicalEvidenceQuote } from "../../../worker/ai/job-position-extraction";

describe("job analysis evidence normalization", () => {
  const source = "The school seeks an English Teacher for Years 11-13.";

  it("preserves an exact source quote", () => {
    expect(canonicalEvidenceQuote(source, "English Teacher")).toBe(
      "English Teacher"
    );
  });

  it("recovers source casing", () => {
    expect(canonicalEvidenceQuote(source, "english teacher")).toBe(
      "English Teacher"
    );
  });

  it("removes model-added quotation marks around literal evidence", () => {
    expect(canonicalEvidenceQuote(source, '"English Teacher"')).toBe(
      "English Teacher"
    );
  });

  it("retains unsupported evidence for the persistence guard", () => {
    expect(canonicalEvidenceQuote(source, '"Math Teacher"')).toBe(
      '"Math Teacher"'
    );
  });
});
