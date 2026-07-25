import { describe, expect, it } from "bun:test";
import {
  criterion,
  summarize,
} from "../../src/pipeline/03_match/evaluate/criteria";
import type { MatchCriterion } from "../../src/profile-types";

function required(label: string, state: MatchCriterion["state"]) {
  return { ...criterion(label, state), importance: "required" as const };
}

function preferred(label: string, state: MatchCriterion["state"]) {
  return { ...criterion(label, state), importance: "preferred" as const };
}

describe("match scoring", () => {
  it("scores two jobs comparably when they state different numbers of facts", () => {
    const sparse = summarize([required("Degree", "match")]);
    const detailed = summarize([
      required("Degree", "match"),
      required("Experience", "match"),
      required("Nationality", "match"),
      required("Audience", "match"),
    ]);

    expect(sparse.score).toBe(100);
    expect(detailed.score).toBe(100);

    const sparseMiss = summarize([
      required("Degree", "match"),
      required("Experience", "unknown"),
    ]);
    const detailedMiss = summarize([
      required("Degree", "match"),
      required("Experience", "match"),
      required("Nationality", "match"),
      required("Audience", "unknown"),
    ]);

    expect(detailedMiss.score).toBeGreaterThan(sparseMiss.score);
  });

  it("weights a required criterion above a preferred one", () => {
    const missedRequired = summarize([
      required("Degree", "unknown"),
      preferred("Housing", "match"),
    ]);
    const missedPreferred = summarize([
      required("Degree", "match"),
      preferred("Housing", "unknown"),
    ]);

    expect(missedPreferred.score).toBeGreaterThan(missedRequired.score);
  });

  it("gives an unknown partial credit rather than treating it as a miss", () => {
    const unknown = summarize([required("Degree", "unknown")]);
    const conflict = summarize([required("Degree", "conflict")]);

    expect(unknown.score).toBeGreaterThan(0);
    expect(unknown.score).toBeLessThan(100);
    expect(conflict.score).toBe(0);
  });

  it("zeroes the score of an ineligible job so it can never outrank an eligible one", () => {
    const ineligible = summarize([
      required("Degree", "match"),
      required("Experience", "match"),
      required("Work authorization", "conflict"),
    ]);
    const weakButEligible = summarize([required("Degree", "unknown")]);

    expect(ineligible.label).toBe("Ineligible");
    expect(ineligible.score).toBe(0);
    expect(weakButEligible.score).toBeGreaterThan(ineligible.score);
  });

  it("keeps a preference miss out of the score and off the ineligible label", () => {
    const result = summarize([
      required("Degree", "match"),
      criterion("Thailand is marked Avoid in preferences", "preference"),
    ]);

    expect(result.label).toBe("Preference mismatch");
    expect(result.score).toBe(100);
  });

  it("labels a strong match by score rather than by how many facts were stated", () => {
    const many = summarize([
      required("A", "match"),
      required("B", "match"),
      required("C", "match"),
      required("D", "unknown"),
      required("E", "unknown"),
    ]);

    expect(many.label).toBe("Needs verification");
    expect(many.score).toBeLessThan(80);
  });
});
