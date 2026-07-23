import { describe, expect, it } from "bun:test";
import {
  jobSitemap,
  marketSitemap,
  robotsText,
  sitemapIndex,
  staticSitemap,
} from "../../worker/services/public-search-assets";

const origin = "https://outreach-product.peacockery.studio";

describe("public search assets", () => {
  it("keeps private product routes out of crawling and advertises the index", () => {
    const robots = robotsText(origin);

    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Disallow: /app/");
    expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`);
    expect(sitemapIndex(origin)).toContain(
      `<loc>${origin}/sitemaps/jobs.xml</loc>`
    );
  });

  it("publishes stable foundation, market, and canonical job URLs", () => {
    expect(staticSitemap(origin)).toContain(`<loc>${origin}/jobs</loc>`);
    expect(
      marketSitemap(origin, [
        {
          city_slug: null,
          country_code: "GE",
          country_slug: "georgia",
          material_changed_at: "2026-07-23T10:00:00.000Z",
        },
        {
          city_slug: "tbilisi",
          country_code: "GE",
          country_slug: "georgia",
          material_changed_at: "2026-07-23T10:00:00.000Z",
        },
      ])
    ).toContain(`<loc>${origin}/jobs/georgia/tbilisi</loc>`);
    expect(
      jobSitemap(origin, [
        {
          canonical_slug: "english-teacher-tbilisi",
          material_changed_at: "2026-07-23T10:00:00.000Z",
          public_job_id: `pjob_v1_${"a".repeat(64)}`,
        },
      ])
    ).toContain(
      `<loc>${origin}/job/pjob_v1_${"a".repeat(64)}/english-teacher-tbilisi</loc>`
    );
  });
});
