import { describe, expect, it } from "vitest";
import { createJobDisplayFacts } from "../../../src/features/jobs/display-facts";
import type {
  FxData,
  Job,
  JobListItem,
} from "../../../src/features/jobs/types";
import type { JobMatch, JobMatchSummary } from "../../../src/profile-types";

const fx: FxData = { rates: { CNY: 7.2, USD: 1 }, updatedAt: null };
const compensation = {
  amountMax: 30_000,
  amountMin: 25_000,
  confidence: "exact" as const,
  currency: "CNY",
  display: "25,000–30,000 CNY/month",
  notes: [],
  period: "month" as const,
  qualifier: "range" as const,
  source: "listing-description" as const,
};
const analysisStatus = {
  content: "current" as const,
  matchFacts: "current" as const,
  positions: "current" as const,
};
const summary: JobMatchSummary = {
  confirmedRequirements: 1,
  conflicts: 0,
  label: "Likely match",
  score: 75,
  tone: "positive",
  totalRequirements: 2,
  unknowns: 1,
};
const match: JobMatch = {
  criteria: [
    {
      importance: "required",
      label: "Bachelor's degree",
      state: "match",
    },
    {
      importance: "required",
      label: "Two years of experience",
      state: "unknown",
    },
  ],
  label: "Likely match",
  score: 75,
  tone: "positive",
};

describe("job display facts", () => {
  it("keeps queue and detail identity, compensation, and match facts aligned", () => {
    const listFacts = createJobDisplayFacts(listing(), fx, summary);
    const detailFacts = createJobDisplayFacts(detail(), fx, match);

    expect(listFacts).toMatchObject({
      compensationPrimary: "≈ $3,472–$4,167 USD/month",
      employer: "Example University",
      location: "Beijing · China",
      matchSummary: "1 of 2 requirements match",
      positionSummary: "3 positions",
    });
    expect(detailFacts).toMatchObject({
      compensationPrimary: listFacts.compensationPrimary,
      employer: listFacts.employer,
      location: listFacts.location,
      matchSummary: listFacts.matchSummary,
    });
  });
});

function listing(): JobListItem {
  return {
    analysisStatus,
    applicationRoutes: [],
    board: "example",
    company: "Example University",
    compensation,
    country: "China",
    draftTask: null,
    emailAttempt: null,
    housing: null,
    id: "example-job",
    location: "Beijing",
    marketSegments: [],
    messageRoute: "advertised_position",
    opportunityScope: "multi_position",
    positionCount: 3,
    publicJobId: null,
    statedHourly: null,
    status: "new",
    title: "English Teacher",
  };
}

function detail(): Job {
  return {
    analysisStatus,
    applicationRoutes: [],
    applyUrl: "",
    board: "example",
    company: "Example University",
    compensation,
    contentAnalysis: null,
    country: "China",
    description: "",
    draft: null,
    draftTask: null,
    emailAttempt: null,
    id: "example-job",
    location: "Beijing",
    marketSegments: [],
    matchFacts: null,
    messageRoute: "advertised_position",
    opportunityScope: "multi_position",
    positionAnalysis: null,
    publicJobId: null,
    sourceReference: "",
    sourceUrl: "",
    status: "new",
    title: "English Teacher",
  };
}
