import { describe, expect, it } from "bun:test";
import {
  candidateDecision,
  jobPostingLocationEligible,
} from "../../worker/services/public-projection/candidates/derive";
import type { CandidateLocationRow } from "../../worker/services/public-projection/candidates/model";

function locationRow(overrides: Partial<CandidateLocationRow>) {
  return {
    bounds_json: null,
    coordinate_kind: "point",
    country_code: "GE",
    display_name: "Tbilisi, Georgia",
    latitude: 41.7151,
    literal_label: "Tbilisi, Georgia",
    locality: "Tbilisi",
    longitude: 44.8271,
    ordinal: 0,
    postal_code: "",
    proposed_canonical_location_id: "cloc_fixture",
    provider_place_id: "place.tbilisi",
    region: "",
    resolution_hash: "a".repeat(64),
    resolution_id: "resolution",
    role: "worksite",
    scope: "locality",
    state: "resolved",
    workplace_type: "onsite",
    ...overrides,
  } satisfies CandidateLocationRow;
}

describe("JobPosting candidate decisions", () => {
  it("marks eligible published candidates with the eligibility reason", () => {
    const decision = candidateDecision({
      datePostedPublished: true,
      decisionVersion: 1,
      jobPostingLocationEligible: true,
      predecessorVersion: null,
      publishable: true,
      routeAvailable: true,
    });
    expect(decision.jobPostingEligible).toBe(true);
    expect(decision.reasonCodes).toEqual([
      "candidate_published",
      "job_posting_eligible",
    ]);
  });

  it("records each missing JobPosting requirement as its own reason", () => {
    const decision = candidateDecision({
      datePostedPublished: false,
      decisionVersion: 1,
      jobPostingLocationEligible: false,
      predecessorVersion: null,
      publishable: true,
      routeAvailable: true,
    });
    expect(decision.jobPostingEligible).toBe(false);
    expect(decision.reasonCodes).toEqual([
      "candidate_published",
      "job_posting_original_date_missing",
      "job_posting_location_not_finite",
    ]);
  });

  it("excludes countrywide-only worksites until finite worksites exist", () => {
    expect(
      jobPostingLocationEligible(
        [locationRow({ scope: "countrywide" })],
        "onsite"
      )
    ).toBe(false);
    expect(jobPostingLocationEligible([locationRow({})], "onsite")).toBe(true);
  });

  it("requires applicant areas for remote JobPosting geography", () => {
    expect(jobPostingLocationEligible([locationRow({})], "remote")).toBe(false);
    expect(
      jobPostingLocationEligible(
        [locationRow({ role: "applicant_area", scope: "countrywide" })],
        "remote"
      )
    ).toBe(true);
  });
});
