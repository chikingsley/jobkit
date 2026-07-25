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
