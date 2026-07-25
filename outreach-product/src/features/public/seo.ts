// Head metadata for the public site pages: landing, privacy, terms,
// methodology, corrections. The job-catalog heads live with the catalog in
// old/src/features/public/seo.ts and come back if that projection does.
import { CANONICAL_SITE_ORIGIN } from "../../lib/site-origin";

export const PUBLIC_SITE_ORIGIN = CANONICAL_SITE_ORIGIN;

export function absoluteUrl(path: string) {
  return new URL(path, PUBLIC_SITE_ORIGIN).toString();
}

function canonicalLink(path: string) {
  return { href: absoluteUrl(path), rel: "canonical" };
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
