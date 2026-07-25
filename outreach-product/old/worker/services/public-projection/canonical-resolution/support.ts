import { getDomain } from "tldts";
import { canonicalJson, compareUtf8Bytes, sha256Hex } from "../hash";
import { projectionRunCounterStatement } from "../listing-items";
import type {
  LocationProviderError,
  LocationProviderErrorCode,
} from "../mapbox-location-resolver";
import {
  assertClaimedPositionUpdate,
  type ClaimedProjectionPosition,
  claimedPositionUpdateStatement,
} from "../position-items";
import {
  type CanonicalResolutionResult,
  COUNTRY_CODE_PATTERN,
  countryAliases,
  countryCodeByName,
  type OrganizationRouteIdentity,
  TRAILING_PATH_SEPARATOR_PATTERN,
  TRAILING_PERIOD_PATTERN,
} from "./model";

export function providerFailureShouldRetry(
  code: LocationProviderErrorCode,
  claim: ClaimedProjectionPosition
) {
  return (
    [
      "location_provider_rate_limit",
      "location_provider_timeout",
      "location_provider_transport",
    ].includes(code) && claim.attemptCount < claim.maxAttempts
  );
}

export async function retryProviderFailure(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  error: LocationProviderError,
  checkpoint: Record<string, unknown>
): Promise<CanonicalResolutionResult> {
  const result = await claimedPositionUpdateStatement(db, claim, {
    checkpoint: {
      ...checkpoint,
      canonicalResolution: {
        attempt: claim.attemptCount,
        reasonCode: error.code,
        state: "retry",
      },
    },
    errorCode: error.code,
    errorDetail: error.message,
    stage: "canonical_resolution",
    status: "queued",
  }).run();
  assertClaimedPositionUpdate(result, "canonical resolution retry");
  return { blocked: 0, resolved: 0, retried: 1, sealed: 0, state: "retry" };
}

export async function blockInputClaim(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  timestamp: string,
  errorCode: string,
  errorDetail: string,
  checkpoint: Record<string, unknown>
): Promise<CanonicalResolutionResult> {
  const results = await db.batch([
    claimedPositionUpdateStatement(db, claim, {
      checkpoint: {
        ...checkpoint,
        canonicalResolution: { reasonCode: errorCode, state: "blocked" },
      },
      errorCode,
      errorDetail,
      stage: "canonical_resolution",
      status: "blocked",
    }),
    projectionRunCounterStatement(db, claim.runId, timestamp),
  ]);
  assertClaimedPositionUpdate(results[0], "canonical resolution input block");
  return { blocked: 1, resolved: 0, retried: 0, sealed: 0, state: "blocked" };
}

export async function canonicalLocationId(providerPlaceId: string) {
  return `loc_v1_${await sha256Hex(
    `jobkit-canonical-location/v1\0mapbox-geocoding-v6\0${providerPlaceId}`
  )}`;
}

export async function sha256Id(prefix: string, input: string) {
  return `${prefix}${await sha256Hex(input)}`;
}

export function countryCodeForLabel(value: string): string | null {
  const normalized = normalizeText(value);
  if (COUNTRY_CODE_PATTERN.test(normalized)) {
    return normalized.toUpperCase();
  }
  return (
    countryAliases.get(normalized) ?? countryCodeByName.get(normalized) ?? null
  );
}

export function normalizedHost(value: string) {
  try {
    return normalizeDomain(new URL(value).hostname);
  } catch {
    return "";
  }
}

export function organizationRouteIdentities(values: string[]) {
  const identities = new Map<string, OrganizationRouteIdentity>();
  for (const value of values) {
    try {
      const url = new URL(value);
      const host = normalizeDomain(url.hostname);
      const registrableDomain = registrableDomainForHost(host);
      if (!host) {
        continue;
      }
      const identity = {
        host,
        path: normalizedPathPrefix(url.pathname) || "/",
        registrableDomain,
      };
      identities.set(canonicalJson(identity), identity);
    } catch {
      // Malformed route values provide no organization identity evidence.
    }
  }
  return [...identities.values()].sort((left, right) =>
    compareUtf8Bytes(canonicalJson(left), canonicalJson(right))
  );
}

export function registrableDomainForHost(host: string) {
  const domain = getDomain(host, {
    allowIcannDomains: true,
    allowPrivateDomains: false,
    extractHostname: false,
  });
  return domain ? normalizeDomain(domain) : "";
}

export function normalizedPathPrefix(value: string) {
  const trimmed = value.trim().replace(TRAILING_PATH_SEPARATOR_PATTERN, "");
  return trimmed || "";
}

export function normalizeDomain(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(TRAILING_PERIOD_PATTERN, "");
}

export function normalizeText(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
