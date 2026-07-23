import { countrySlugForCode } from "../../src/lib/country-routing";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

interface SearchAssetEnv {
  APP_ORIGIN: string;
  DB: D1Database;
}

interface SitemapJobRow {
  canonical_slug: string;
  material_changed_at: string;
  public_job_id: string;
}

interface SitemapMarketRow {
  city_slug: string | null;
  country_code: string;
  country_slug: string;
  material_changed_at: string;
}

export async function publicSearchAssetResponse(
  request: Request,
  env: SearchAssetEnv
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/robots.txt") {
    return textResponse(
      robotsText(env.APP_ORIGIN),
      "text/plain; charset=utf-8"
    );
  }
  if (path === "/sitemap.xml") {
    return xmlResponse(sitemapIndex(env.APP_ORIGIN));
  }
  if (path === "/sitemaps/static.xml") {
    return xmlResponse(staticSitemap(env.APP_ORIGIN));
  }
  if (path === "/sitemaps/markets.xml") {
    return xmlResponse(
      marketSitemap(env.APP_ORIGIN, await readSitemapMarkets(env.DB))
    );
  }
  if (path === "/sitemaps/jobs.xml") {
    return xmlResponse(
      jobSitemap(env.APP_ORIGIN, await readSitemapJobs(env.DB))
    );
  }
  return null;
}

export async function readSitemapJobs(db: D1Database) {
  const rows = await db
    .prepare(
      `SELECT public_job_id,canonical_slug,material_changed_at
         FROM organic_index_jobs
        ORDER BY public_job_id`
    )
    .all<SitemapJobRow>();
  return rows.results;
}

export async function readSitemapMarkets(db: D1Database) {
  const rows = await db
    .prepare(
      `SELECT facet.country_code,facet.country_slug,facet.city_slug,
              MAX(browse.material_changed_at) material_changed_at
         FROM public_job_catalog_head_pointer head
         JOIN public_browse_job_locations facet
           ON facet.catalog_version=head.current_version
         JOIN organic_index_jobs browse
           ON browse.catalog_version=facet.catalog_version
          AND browse.public_job_id=facet.public_job_id
          AND browse.public_job_version=facet.public_job_version
        WHERE head.singleton=1
          AND (
            facet.city_slug IS NULL
            OR facet.location_role='worksite'
          )
        GROUP BY facet.country_code,facet.country_slug,facet.city_slug
        ORDER BY facet.country_code,facet.city_slug`
    )
    .all<SitemapMarketRow>();
  const markets = new Map<string, SitemapMarketRow>();
  for (const row of rows.results) {
    const countrySlug = countrySlugForCode(row.country_code);
    const countryKey = `${countrySlug}\u0000`;
    const currentCountry = markets.get(countryKey);
    if (
      !currentCountry ||
      currentCountry.material_changed_at < row.material_changed_at
    ) {
      markets.set(countryKey, {
        city_slug: null,
        country_code: row.country_code,
        country_slug: countrySlug,
        material_changed_at: row.material_changed_at,
      });
    }
    if (row.city_slug) {
      markets.set(`${countrySlug}\u0000${row.city_slug}`, {
        ...row,
        country_slug: countrySlug,
      });
    }
  }
  return [...markets.values()].sort((left, right) =>
    `${left.country_slug}\u0000${left.city_slug ?? ""}`.localeCompare(
      `${right.country_slug}\u0000${right.city_slug ?? ""}`,
      "en"
    )
  );
}

export function robotsText(origin: string) {
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /app/
Disallow: /openapi.json

Sitemap: ${absolute(origin, "/sitemap.xml")}
`;
}

export function sitemapIndex(origin: string) {
  return `${XML_HEADER}
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${["/sitemaps/static.xml", "/sitemaps/markets.xml", "/sitemaps/jobs.xml"]
  .map(
    (path) =>
      `  <sitemap><loc>${escapeXml(absolute(origin, path))}</loc></sitemap>`
  )
  .join("\n")}
</sitemapindex>`;
}

export function staticSitemap(origin: string) {
  return urlSet(
    ["/", "/jobs", "/methodology", "/corrections", "/privacy", "/terms"].map(
      (path) => ({ lastmod: null, path })
    ),
    origin
  );
}

export function marketSitemap(origin: string, rows: SitemapMarketRow[]) {
  return urlSet(
    rows.map((row) => ({
      lastmod: row.material_changed_at,
      path: row.city_slug
        ? `/jobs/${row.country_slug}/${row.city_slug}`
        : `/jobs/${row.country_slug}`,
    })),
    origin
  );
}

export function jobSitemap(origin: string, rows: SitemapJobRow[]) {
  return urlSet(
    rows.map((row) => ({
      lastmod: row.material_changed_at,
      path: `/job/${row.public_job_id}/${row.canonical_slug}`,
    })),
    origin
  );
}

function urlSet(
  entries: Array<{ lastmod: string | null; path: string }>,
  origin: string
) {
  return `${XML_HEADER}
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    ({ lastmod, path }) =>
      `  <url><loc>${escapeXml(absolute(origin, path))}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ""}</url>`
  )
  .join("\n")}
</urlset>`;
}

function absolute(origin: string, path: string) {
  return new URL(path, origin).toString();
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlResponse(body: string) {
  return textResponse(body, "application/xml; charset=utf-8");
}

function textResponse(body: string, contentType: string) {
  return new Response(body, {
    headers: {
      "content-type": contentType,
      "x-content-type-options": "nosniff",
    },
  });
}
