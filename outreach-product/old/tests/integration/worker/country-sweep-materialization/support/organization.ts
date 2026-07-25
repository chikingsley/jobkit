import { exports } from "cloudflare:workers";

export function organization(index: number) {
  const suffix = index.toString();
  return {
    canonicalDomain: `school-${suffix}.example.test`,
    city: "Dushanbe",
    contactPoints: [],
    evidenceUrl: `https://school-${suffix}.example.test`,
    lastVerifiedAt: "2026-07-22T00:00:00.000Z",
    marketSegment: "private_school" as const,
    name: `School ${suffix}`,
    outreachEligibility: "eligible" as const,
    region: "Dushanbe",
    status: "active" as const,
    websiteUrl: `https://school-${suffix}.example.test`,
  };
}

export function authenticatedRequest(
  path: string,
  cookie: string,
  method = "GET",
  body?: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      cookie,
    },
    method,
  });
}

export function runnerRequest(
  path: string,
  token: string,
  body: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

export function publicRequest(path: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
