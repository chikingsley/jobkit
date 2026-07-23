import { describe, expect, it } from "bun:test";
import { publicJobHourlyUsd } from "../../src/features/public/job-format";
import { PublicJobListItemSchema } from "../../worker/public-jobs/schemas";

const publicId = `pjob_v1_${"a".repeat(64)}`;

describe("public job formatting", () => {
  it("shows one value when listed hourly pay is already in USD", () => {
    expect(publicJobHourlyUsd(job("USD", "hour", 15, 24))).toBeNull();
  });

  it("shows the normalized hourly value for monthly non-USD pay", () => {
    expect(publicJobHourlyUsd(job("CNY", "month", 25_000, 32_000))).toBe(
      "$15–$24 USD/hour"
    );
  });
});

function job(
  currency: string,
  period: "hour" | "month",
  minimum: number,
  maximum: number
) {
  return PublicJobListItemSchema.parse({
    application: { available: true },
    canonicalPath: `/job/${publicId}/english-teacher`,
    canonicalSlug: "english-teacher",
    compensation: {
      amount: {
        currency,
        maximum,
        minimum,
        period,
        qualifier: "range",
        taxBasis: "unspecified",
      },
      hourlyUsd: {
        basis: "listed",
        fxAsOf: "2026-07-23",
        maximum: 24,
        minimum: 15,
        taxBasis: "unspecified",
      },
      kind: "amount",
    },
    datePosted: null,
    employmentTypes: [],
    freshness: {
      materialChangedAt: "2026-07-23T10:00:00.000Z",
      verifiedAt: "2026-07-23T10:00:00.000Z",
    },
    locations: [
      {
        bounds: null,
        coordinateKind: "point",
        coordinates: { latitude: 31.2304, longitude: 121.4737 },
        countryCode: "CN",
        displayName: "Shanghai, China",
        locality: "Shanghai",
        postalCode: null,
        region: null,
        role: "worksite",
        scope: "locality",
      },
    ],
    organization: { name: "Example School" },
    publicId,
    publicJobVersion: 1,
    sources: [],
    status: "active",
    title: "English Teacher",
    validThrough: null,
    workplaceType: "onsite",
  });
}
