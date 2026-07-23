import { describe, expect, it } from "bun:test";
import {
  publicJobDetailHead,
  publicJobListHead,
} from "../../src/features/public/seo";
import {
  PublicJobDetailResponseSchema,
  PublicJobListResponseSchema,
} from "../../worker/public-jobs/schemas";

const publicId = `pjob_v1_${"a".repeat(64)}`;
const timestamp = "2026-07-23T10:00:00.000Z";

const commonJob = {
  application: { available: true },
  canonicalPath: `/job/${publicId}/english-teacher-tbilisi`,
  canonicalSlug: "english-teacher-tbilisi",
  compensation: {
    amount: {
      currency: "USD",
      maximum: 35,
      minimum: 30,
      period: "hour",
      qualifier: "range",
      taxBasis: "gross",
    },
    hourlyUsd: {
      basis: "listed",
      fxAsOf: "2026-07-23",
      maximum: 35,
      minimum: 30,
      taxBasis: "gross",
    },
    kind: "amount",
  },
  datePosted: {
    provenance: "employer-original",
    value: "2026-07-20",
  },
  employmentTypes: ["fullTime"],
  freshness: {
    materialChangedAt: timestamp,
    verifiedAt: timestamp,
  },
  locations: [
    {
      bounds: null,
      coordinateKind: "point",
      coordinates: { latitude: 41.7151, longitude: 44.8271 },
      countryCode: "GE",
      displayName: "Tbilisi, Georgia",
      locality: "Tbilisi",
      postalCode: null,
      region: null,
      role: "worksite",
      scope: "locality",
    },
  ],
  organization: { name: "Example School" },
  publicId,
  publicJobVersion: 1,
  sources: [{ name: "Example board", url: "https://example.test/job" }],
  title: "English Teacher",
  validThrough: null,
  workplaceType: "onsite",
} as const;

describe("public job SEO", () => {
  it("indexes only a populated default market page with its own canonical", () => {
    const response = PublicJobListResponseSchema.parse({
      catalog: {
        materialChangedAt: timestamp,
        searchIndexVersion: "search-v1",
        version: "catalog-v1",
      },
      items: [{ ...commonJob, status: "active" }],
      page: { hasMore: false, nextCursor: null },
      query: {
        compensation: null,
        country: null,
        employmentType: null,
        limit: 20,
        q: null,
        sort: "recent",
        workplace: null,
      },
      schemaVersion: "public-job-list-v1",
      scope: {
        countryCode: "GE",
        countrySlug: "georgia",
        kind: "country",
      },
    });

    const head = publicJobListHead(
      { data: response, kind: "success" },
      "/jobs/georgia"
    );
    expect(head.links).toContainEqual({
      href: "https://outreach-product.peacockery.studio/jobs/georgia",
      rel: "canonical",
    });
    expect(head.meta).toContainEqual({
      content: "index,follow",
      name: "robots",
    });

    const filtered = publicJobListHead(
      {
        data: {
          ...response,
          query: { ...response.query, q: "university" },
        },
        kind: "success",
      },
      "/jobs/georgia"
    );
    expect(filtered.meta).toContainEqual({
      content: "noindex,follow",
      name: "robots",
    });
  });

  it("emits JobPosting only for an eligible visible detail representation", () => {
    const job = PublicJobDetailResponseSchema.parse({
      ...commonJob,
      descriptionHtml:
        "<p>Teach adult learners in Tbilisi.</p><p>Salary is USD 30–35 per hour.</p>",
      schemaVersion: "public-job-detail-v1",
      status: "active",
    });
    const eligible = publicJobDetailHead(
      {
        data: job,
        jobPostingEligible: true,
        kind: "success",
        noindex: false,
      },
      job.canonicalPath
    );
    expect(
      eligible.meta.some(
        (entry) =>
          "script:ld+json" in entry &&
          (entry["script:ld+json"] as { "@type"?: string })["@type"] ===
            "JobPosting"
      )
    ).toBeTrue();

    const organicOnly = publicJobDetailHead(
      {
        data: job,
        jobPostingEligible: false,
        kind: "success",
        noindex: false,
      },
      job.canonicalPath
    );
    expect(
      organicOnly.meta.some(
        (entry) =>
          "script:ld+json" in entry &&
          (entry["script:ld+json"] as { "@type"?: string })["@type"] ===
            "JobPosting"
      )
    ).toBeFalse();
  });
});
