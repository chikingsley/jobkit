import { canonicalSha256 } from "../services/public-projection/hash";
import {
  PUBLIC_JOB_DETAIL_SCHEMA_VERSION,
  PUBLIC_JOB_LIST_SCHEMA_VERSION,
  PUBLIC_JOB_SERIALIZER_VERSION,
} from "./schemas";

const weakEtagPrefixPattern = /^W\//u;

export interface PublicRepresentationValidators {
  etag: string;
  lastModified: string;
}

export function publicJobDetailEtag(input: {
  canonicalPath: string;
  eligibilityDecisionHash: string;
  publicContentHash: string;
}) {
  return strongEtag({
    canonicalPath: input.canonicalPath,
    eligibilityDecisionHash: input.eligibilityDecisionHash,
    publicContentHash: input.publicContentHash,
    schemaVersion: PUBLIC_JOB_DETAIL_SCHEMA_VERSION,
    serializerVersion: PUBLIC_JOB_SERIALIZER_VERSION,
  });
}

export function publicJobListEtag(input: {
  cursor: string | null;
  membershipHash: string;
  queryHash: string;
  scope: unknown;
  searchIndexVersion: string;
}) {
  return strongEtag({
    cursor: input.cursor,
    membershipHash: input.membershipHash,
    queryHash: input.queryHash,
    schemaVersion: PUBLIC_JOB_LIST_SCHEMA_VERSION,
    scope: input.scope,
    searchIndexVersion: input.searchIndexVersion,
    serializerVersion: PUBLIC_JOB_SERIALIZER_VERSION,
  });
}

export function publicValidatorHeaders(
  validators: PublicRepresentationValidators
) {
  return new Headers({
    "Cache-Control": "public, max-age=0, must-revalidate",
    ETag: validators.etag,
    "Last-Modified": httpDate(validators.lastModified),
  });
}

export function publicRepresentationIsFresh(
  requestHeaders: Headers,
  validators: PublicRepresentationValidators
) {
  const ifNoneMatch = requestHeaders.get("if-none-match");
  if (ifNoneMatch !== null) {
    return etagListMatches(ifNoneMatch, validators.etag);
  }
  const ifModifiedSince = requestHeaders.get("if-modified-since");
  if (ifModifiedSince === null) {
    return false;
  }
  const suppliedTime = Date.parse(ifModifiedSince);
  const representationTime = Date.parse(validators.lastModified);
  return (
    Number.isFinite(suppliedTime) &&
    Number.isFinite(representationTime) &&
    Math.floor(representationTime / 1000) <= Math.floor(suppliedTime / 1000)
  );
}

async function strongEtag(value: unknown) {
  return `"${await canonicalSha256(value)}"`;
}

function httpDate(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Public representation timestamp is invalid");
  }
  return new Date(timestamp).toUTCString();
}

function etagListMatches(value: string, currentEtag: string) {
  const currentOpaqueTag = currentEtag.replace(weakEtagPrefixPattern, "");
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return (
      normalized === "*" ||
      normalized.replace(weakEtagPrefixPattern, "") === currentOpaqueTag
    );
  });
}
