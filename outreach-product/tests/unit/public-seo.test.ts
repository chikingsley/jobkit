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

  it("covers every Google-required JobPosting property for a worksite job", () => {
    const job = PublicJobDetailResponseSchema.parse({
      ...commonJob,
      descriptionHtml: "<p>Teach adult learners in Tbilisi.</p>",
      schemaVersion: "public-job-detail-v1",
      status: "active",
    });
    const posting = jobPostingFromHead(job);
    expect(posting).toMatchObject({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      datePosted: "2026-07-20",
      description: "<p>Teach adult learners in Tbilisi.</p>",
      employmentType: ["FULL_TIME"],
      hiringOrganization: {
        "@type": "Organization",
        name: "Example School",
      },
      jobLocation: {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          addressCountry: "GE",
          addressLocality: "Tbilisi",
        },
      },
      title: "English Teacher",
    });
    expect(posting.baseSalary).toMatchObject({
      "@type": "MonetaryAmount",
      currency: "USD",
      value: { "@type": "QuantitativeValue", unitText: "HOUR" },
    });
    expect(posting).not.toHaveProperty("directApply");
    expect(posting).not.toHaveProperty("validThrough");
  });

  it("emits applicant countries without a physical place for remote jobs", () => {
    const job = PublicJobDetailResponseSchema.parse({
      ...commonJob,
      descriptionHtml: "<p>Teach online learners anywhere in Georgia.</p>",
      locations: [
        {
          bounds: null,
          coordinateKind: "centroid",
          coordinates: { latitude: 42.3154, longitude: 43.3569 },
          countryCode: "GE",
          displayName: "Georgia",
          locality: null,
          postalCode: null,
          region: null,
          role: "applicantArea",
          scope: "countrywide",
        },
      ],
      schemaVersion: "public-job-detail-v1",
      status: "active",
      workplaceType: "remote",
    });
    const posting = jobPostingFromHead(job);
    expect(posting.jobLocationType).toBe("TELECOMMUTE");
    expect(posting.applicantLocationRequirements).toEqual([
      { "@type": "Country", name: "Georgia" },
    ]);
    expect(posting).not.toHaveProperty("jobLocation");
  });

  it("omits baseSalary rather than misstating a fortnight pay period", () => {
    const job = PublicJobDetailResponseSchema.parse({
      ...commonJob,
      compensation: {
        amount: {
          currency: "USD",
          maximum: 1400,
          minimum: 1200,
          period: "fortnight",
          qualifier: "range",
          taxBasis: "gross",
        },
        hourlyUsd: null,
        kind: "amount",
      },
      descriptionHtml: "<p>Teach adult learners in Tbilisi.</p>",
      schemaVersion: "public-job-detail-v1",
      status: "active",
    });
    expect(jobPostingFromHead(job)).not.toHaveProperty("baseSalary");
  });

  it("withholds JobPosting when the posting date is unknown", () => {
    const job = PublicJobDetailResponseSchema.parse({
      ...commonJob,
      datePosted: null,
      descriptionHtml: "<p>Teach adult learners in Tbilisi.</p>",
      schemaVersion: "public-job-detail-v1",
      status: "active",
    });
    const head = publicJobDetailHead(
      { data: job, jobPostingEligible: true, kind: "success", noindex: false },
      job.canonicalPath
    );
    expect(
      head.meta.some(
        (entry) =>
          "script:ld+json" in entry &&
          (entry["script:ld+json"] as { "@type"?: string })["@type"] ===
            "JobPosting"
      )
    ).toBeFalse();
  });
});

function jobPostingFromHead(
  job: ReturnType<typeof PublicJobDetailResponseSchema.parse>
) {
  const head = publicJobDetailHead(
    { data: job, jobPostingEligible: true, kind: "success", noindex: false },
    job.canonicalPath
  );
  const entry = (head.meta as Record<string, unknown>[]).find(
    (value) =>
      "script:ld+json" in value &&
      (value["script:ld+json"] as { "@type"?: string })["@type"] ===
        "JobPosting"
  );
  if (!entry) {
    throw new Error("The eligible detail head emitted no JobPosting");
  }
  return entry["script:ld+json"] as Record<string, unknown>;
}
