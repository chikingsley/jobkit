import type {
  PublicJobDetailResponse,
  PublicJobListResponse,
} from "../../../worker/public-jobs/schemas";
import { countrySlugForCode } from "../../lib/country-routing";
import { CANONICAL_SITE_ORIGIN } from "../../lib/site-origin";

export const PUBLIC_SITE_ORIGIN = CANONICAL_SITE_ORIGIN;

export function publicJobListHead(result: unknown, canonicalPath: string) {
  if (!isPublicListSuccess(result)) {
    return unavailableHead("Teaching jobs", canonicalPath);
  }
  const title = listTitle(result.data);
  const description = listDescription(result.data);
  const indexable =
    result.data.items.length > 0 && defaultBrowseQuery(result.data);
  return {
    links: [canonicalLink(canonicalPath)],
    meta: [
      { title: `${title} | JobKit` },
      { content: description, name: "description" },
      {
        content: indexable ? "index,follow" : "noindex,follow",
        name: "robots",
      },
      { content: title, property: "og:title" },
      { content: description, property: "og:description" },
      { content: absoluteUrl(canonicalPath), property: "og:url" },
      { content: "website", property: "og:type" },
      {
        "script:ld+json": breadcrumbList(listBreadcrumbs(result.data)),
      },
    ],
  };
}

export function publicJobDetailHead(result: unknown, requestedPath: string) {
  if (!isPublicDetailSuccess(result)) {
    return unavailableHead("Teaching job", requestedPath);
  }
  const {
    data: job,
    data: { canonicalPath },
  } = result;
  const title = `${job.title} at ${job.organization.name}`;
  const description = detailDescription(job);
  const indexable = job.status === "active" && !result.noindex;
  const metadata: Record<string, unknown>[] = [
    { title: `${title} | JobKit` },
    { content: description, name: "description" },
    { content: indexable ? "index,follow" : "noindex,follow", name: "robots" },
    { content: title, property: "og:title" },
    { content: description, property: "og:description" },
    { content: absoluteUrl(canonicalPath), property: "og:url" },
    { content: "website", property: "og:type" },
    { "script:ld+json": breadcrumbList(detailBreadcrumbs(job)) },
  ];
  if (indexable && result.jobPostingEligible && job.datePosted) {
    metadata.push({ "script:ld+json": jobPosting(job) });
  }
  return {
    links: [canonicalLink(canonicalPath)],
    meta: metadata,
  };
}

function isPublicListSuccess(
  result: unknown
): result is { data: PublicJobListResponse; kind: "success" } {
  return (
    typeof result === "object" &&
    result !== null &&
    "kind" in result &&
    result.kind === "success" &&
    "data" in result
  );
}

function isPublicDetailSuccess(result: unknown): result is {
  data: PublicJobDetailResponse;
  jobPostingEligible: boolean;
  kind: "success";
  noindex: boolean;
} {
  return (
    typeof result === "object" &&
    result !== null &&
    "kind" in result &&
    result.kind === "success" &&
    "data" in result &&
    "jobPostingEligible" in result &&
    "noindex" in result
  );
}

export function foundationHead(
  title: string,
  description: string,
  canonicalPath: string
) {
  return {
    links: [canonicalLink(canonicalPath)],
    meta: [
      { title },
      { content: description, name: "description" },
      { content: "index,follow", name: "robots" },
      { content: title, property: "og:title" },
      { content: description, property: "og:description" },
      { content: absoluteUrl(canonicalPath), property: "og:url" },
      { content: "website", property: "og:type" },
    ],
  };
}

export function absoluteUrl(path: string) {
  return new URL(path, PUBLIC_SITE_ORIGIN).toString();
}

function canonicalLink(path: string) {
  return { href: absoluteUrl(path), rel: "canonical" };
}

function unavailableHead(title: string, canonicalPath: string) {
  return {
    links: [canonicalLink(canonicalPath)],
    meta: [
      { title: `${title} | JobKit` },
      { content: "noindex,follow", name: "robots" },
    ],
  };
}

function listTitle(response: PublicJobListResponse) {
  if (response.scope.kind === "city") {
    return `Teaching jobs in ${response.scope.displayName}`;
  }
  if (response.scope.kind === "country") {
    return `Teaching jobs in ${countryName(response.scope.countryCode)}`;
  }
  return "Teaching jobs abroad";
}

function listDescription(response: PublicJobListResponse) {
  const count = response.items.length.toLocaleString("en-US");
  if (response.scope.kind === "city") {
    return `Browse ${count} current teaching opportunities in ${response.scope.displayName}, with normalized job details and clear application routes.`;
  }
  if (response.scope.kind === "country") {
    return `Browse ${count} current teaching opportunities in ${countryName(response.scope.countryCode)}, with normalized job details and clear application routes.`;
  }
  return `Browse ${count} current international teaching opportunities with normalized job details and clear application routes.`;
}

function defaultBrowseQuery(response: PublicJobListResponse) {
  const { query } = response;
  return (
    query.compensation === null &&
    query.country === null &&
    query.employmentType === null &&
    query.q === null &&
    query.sort === "recent" &&
    query.workplace === null
  );
}

function listBreadcrumbs(response: PublicJobListResponse) {
  const crumbs = [{ name: "Jobs", path: "/jobs" }];
  if (response.scope.kind === "global") {
    return crumbs;
  }
  crumbs.push({
    name: countryName(response.scope.countryCode),
    path: `/jobs/${response.scope.countrySlug}`,
  });
  if (response.scope.kind === "city") {
    crumbs.push({
      name: response.scope.displayName,
      path: `/jobs/${response.scope.countrySlug}/${response.scope.citySlug}`,
    });
  }
  return crumbs;
}

function detailBreadcrumbs(job: PublicJobDetailResponse) {
  const location = primaryLocation(job);
  const crumbs = [{ name: "Jobs", path: "/jobs" }];
  if (location) {
    const countrySlug = countrySlugForCode(location.countryCode);
    crumbs.push({
      name: countryName(location.countryCode),
      path: `/jobs/${countrySlug}`,
    });
    if (location.locality) {
      crumbs.push({
        name: location.locality,
        path: `/jobs/${countrySlug}/${slugify(location.locality)}`,
      });
    }
  }
  crumbs.push({ name: job.title, path: job.canonicalPath });
  return crumbs;
}

function breadcrumbList(crumbs: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      item: absoluteUrl(crumb.path),
      name: crumb.name,
      position: index + 1,
    })),
  };
}

function jobPosting(job: PublicJobDetailResponse) {
  const posting: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    datePosted: job.datePosted?.value,
    description: job.descriptionHtml,
    hiringOrganization: {
      "@type": "Organization",
      name: job.organization.name,
    },
    identifier: {
      "@type": "PropertyValue",
      name: "JobKit",
      value: job.publicId,
    },
    title: job.title,
    url: absoluteUrl(job.canonicalPath),
  };
  const employmentType = job.employmentTypes.map(schemaEmploymentType);
  if (employmentType.length > 0) {
    posting.employmentType = employmentType;
  }
  if (job.validThrough) {
    posting.validThrough = job.validThrough.value;
  }
  const applicantAreas =
    job.workplaceType === "remote" ? remoteApplicantAreas(job) : [];
  if (applicantAreas.length > 0) {
    posting.jobLocationType = "TELECOMMUTE";
    posting.applicantLocationRequirements = applicantAreas;
  } else {
    const places = worksitePlaces(job);
    if (places.length > 0) {
      posting.jobLocation = places.length === 1 ? places[0] : places;
    }
  }
  const baseSalary = schemaBaseSalary(job);
  if (baseSalary) {
    posting.baseSalary = baseSalary;
  }
  return posting;
}

function worksitePlaces(job: PublicJobDetailResponse) {
  return job.locations
    .filter(({ role, scope }) => role === "worksite" && scope !== "countrywide")
    .map((location) => ({
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressCountry: location.countryCode,
        ...(location.locality ? { addressLocality: location.locality } : {}),
        ...(location.region ? { addressRegion: location.region } : {}),
        ...(location.postalCode ? { postalCode: location.postalCode } : {}),
      },
    }));
}

const SALARY_UNIT_TEXT: Record<string, string> = {
  day: "DAY",
  hour: "HOUR",
  month: "MONTH",
  week: "WEEK",
  year: "YEAR",
};

function schemaBaseSalary(job: PublicJobDetailResponse) {
  const amount = job.compensation?.amount;
  if (!amount) {
    return null;
  }
  const unitText = SALARY_UNIT_TEXT[amount.period];
  if (!unitText) {
    return null;
  }
  const value: Record<string, unknown> = {
    "@type": "QuantitativeValue",
    unitText,
  };
  if (
    amount.minimum !== null &&
    amount.maximum !== null &&
    amount.minimum === amount.maximum
  ) {
    value.value = amount.minimum;
  } else {
    if (amount.minimum !== null) {
      value.minValue = amount.minimum;
    }
    if (amount.maximum !== null) {
      value.maxValue = amount.maximum;
    }
  }
  return {
    "@type": "MonetaryAmount",
    currency: amount.currency,
    value,
  };
}

function remoteApplicantAreas(job: PublicJobDetailResponse) {
  const countryCodes = [
    ...new Set(
      job.locations
        .filter(({ role }) => role === "applicantArea")
        .map(({ countryCode }) => countryCode)
    ),
  ];
  return countryCodes.map((code) => ({
    "@type": "Country",
    name: countryName(code),
  }));
}

function schemaEmploymentType(
  type: PublicJobDetailResponse["employmentTypes"][number]
) {
  const values = {
    contract: "CONTRACTOR",
    fullTime: "FULL_TIME",
    partTime: "PART_TIME",
  } as const;
  return values[type];
}

function detailDescription(job: PublicJobDetailResponse) {
  const visible = stripHtml(job.descriptionHtml)
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  const summary = `${job.title} at ${job.organization.name} in ${primaryLocation(job)?.displayName ?? "an international market"}. ${visible}`;
  return truncate(summary, 160);
}

function stripHtml(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function primaryLocation(job: PublicJobDetailResponse) {
  return (
    job.locations.find(({ role }) => role === "worksite") ?? job.locations[0]
  );
}

function countryName(countryCode: string) {
  return (
    new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) ??
    countryCode
  );
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function truncate(value: string, maximum: number) {
  if ([...value].length <= maximum) {
    return value;
  }
  return `${[...value]
    .slice(0, maximum - 1)
    .join("")
    .trimEnd()}…`;
}
