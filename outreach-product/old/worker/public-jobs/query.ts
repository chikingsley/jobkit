import { z } from "zod";
import { canonicalJson, sha256Hex } from "../services/public-projection/hash";
import {
  PublicEmploymentTypeSchema,
  type PublicJobListQuery,
  type PublicJobListScope,
  PublicWorkplaceTypeSchema,
} from "./schemas";

const CURSOR_CONTRACT_VERSION = 1;
const encoder = new TextEncoder();
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const countryCodePattern = /^[A-Z]{2}$/u;
const integerPattern = /^-?\d+$/u;
const paddingPattern = /[=]+$/u;

const CursorTupleSchema = z.discriminatedUnion("sort", [
  z.object({
    publicId: z.string(),
    recency: z.string(),
    sort: z.literal("recent"),
  }),
  z.object({
    publicId: z.string(),
    rank: z.number().finite(),
    recency: z.string(),
    sort: z.literal("relevance"),
  }),
  z.object({
    hourlyUsd: z.number().finite().nullable(),
    publicId: z.string(),
    recency: z.string(),
    sort: z.literal("hourlyUsd"),
  }),
  z.object({
    publicId: z.string(),
    sort: z.literal("title"),
    title: z.string(),
  }),
]);

const CursorPayloadSchema = z.object({
  catalogVersion: z.string().min(1),
  queryHash: z.string().regex(/^[0-9a-f]{64}$/u),
  tuple: CursorTupleSchema,
  v: z.literal(CURSOR_CONTRACT_VERSION),
});

export type PublicJobCursorTuple = z.infer<typeof CursorTupleSchema>;

export interface NormalizedPublicJobListRequest {
  cursor: string | null;
  query: PublicJobListQuery;
  scope: PublicJobListScope;
}

export class PublicJobQueryError extends Error {
  readonly code: "cursor_too_long" | "query_too_long";

  constructor(code: PublicJobQueryError["code"]) {
    super(
      code === "query_too_long"
        ? "Search query is too long"
        : "Cursor is too long"
    );
    this.code = code;
  }
}

export class PublicJobCursorError extends Error {
  readonly code: "invalid" | "stale";

  constructor(code: PublicJobCursorError["code"], options?: ErrorOptions) {
    super(
      code === "stale"
        ? "Public job cursor is stale"
        : "Public job cursor is invalid",
      options
    );
    this.code = code;
  }
}

export function normalizePublicJobListRequest(
  parameters: URLSearchParams,
  scope: PublicJobListScope = { kind: "global" }
): NormalizedPublicJobListRequest {
  const q = normalizedQuery(parameters.get("q"));
  const requestedSort = firstEnum(parameters, "sort", [
    "relevance",
    "recent",
    "hourlyUsd",
    "title",
  ] as const);
  let sort = requestedSort ?? (q === null ? "recent" : "relevance");
  if (q === null && sort === "relevance") {
    sort = "recent";
  }
  const cursor = first(parameters, "cursor");
  if (cursor !== null && cursor.length > 1024) {
    throw new PublicJobQueryError("cursor_too_long");
  }
  const rawCountry = first(parameters, "country")?.trim().toUpperCase() ?? null;
  const country =
    scope.kind === "global" && countryCodePattern.test(rawCountry ?? "")
      ? rawCountry
      : null;
  return {
    cursor: cursor?.trim() || null,
    query: {
      compensation: firstEnum(parameters, "compensation", [
        "stated",
        "negotiable",
      ] as const),
      country,
      employmentType: firstSchema(
        parameters,
        "employmentType",
        PublicEmploymentTypeSchema
      ),
      limit: normalizedLimit(first(parameters, "limit")),
      q,
      sort,
      workplace: firstSchema(
        parameters,
        "workplace",
        PublicWorkplaceTypeSchema
      ),
    },
    scope,
  };
}

export function publicJobQueryHash(
  request: Pick<NormalizedPublicJobListRequest, "query" | "scope">
) {
  return sha256Hex(
    canonicalJson({ query: request.query, scope: request.scope })
  );
}

export async function encodePublicJobCursor(input: {
  catalogVersion: string;
  queryHash: string;
  secret: string;
  tuple: PublicJobCursorTuple;
}) {
  const payload = CursorPayloadSchema.parse({
    catalogVersion: input.catalogVersion,
    queryHash: input.queryHash,
    tuple: input.tuple,
    v: CURSOR_CONTRACT_VERSION,
  });
  const encodedPayload = base64UrlEncode(
    encoder.encode(canonicalJson(payload))
  );
  const signature = await sign(encodedPayload, input.secret);
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

export async function decodePublicJobCursor(input: {
  catalogVersion: string;
  cursor: string;
  queryHash: string;
  secret: string;
}) {
  const [encodedPayload, encodedSignature, extra] = input.cursor.split(".");
  if (!(encodedPayload && encodedSignature) || extra !== undefined) {
    throw new PublicJobCursorError("invalid");
  }
  let payloadBytes: Uint8Array;
  let suppliedSignature: Uint8Array;
  try {
    payloadBytes = base64UrlDecode(encodedPayload);
    suppliedSignature = base64UrlDecode(encodedSignature);
  } catch (error) {
    throw new PublicJobCursorError("invalid", { cause: error });
  }
  const key = await hmacKey(input.secret);
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    key,
    ownedArrayBuffer(suppliedSignature),
    encoder.encode(encodedPayload)
  );
  if (!validSignature) {
    throw new PublicJobCursorError("invalid");
  }
  let payload: z.infer<typeof CursorPayloadSchema>;
  try {
    payload = CursorPayloadSchema.parse(
      JSON.parse(new TextDecoder().decode(payloadBytes)) as unknown
    );
  } catch (error) {
    throw new PublicJobCursorError("invalid", { cause: error });
  }
  if (
    payload.queryHash !== input.queryHash ||
    payload.tuple.sort === undefined
  ) {
    throw new PublicJobCursorError("invalid");
  }
  if (payload.catalogVersion !== input.catalogVersion) {
    throw new PublicJobCursorError("stale");
  }
  return payload.tuple;
}

function first(parameters: URLSearchParams, name: string) {
  const values = parameters.getAll(name);
  return values.length === 0 ? null : (values[0] ?? null);
}

function firstEnum<const T extends readonly string[]>(
  parameters: URLSearchParams,
  name: string,
  values: T
): T[number] | null {
  const value = first(parameters, name);
  return value !== null && values.includes(value) ? (value as T[number]) : null;
}

function firstSchema<T>(
  parameters: URLSearchParams,
  name: string,
  schema: z.ZodType<T>
) {
  const parsed = schema.safeParse(first(parameters, name));
  return parsed.success ? parsed.data : null;
}

function normalizedLimit(value: string | null) {
  if (value === null || !integerPattern.test(value.trim())) {
    return 20;
  }
  return Math.min(50, Math.max(1, Number.parseInt(value, 10)));
}

function normalizedQuery(value: string | null) {
  if (value === null) {
    return null;
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (normalized === "") {
    return null;
  }
  if ([...normalized].length > 120) {
    throw new PublicJobQueryError("query_too_long");
  }
  return normalized;
}

async function sign(value: string, secret: string) {
  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await hmacKey(secret),
      encoder.encode(value)
    )
  );
}

function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"]
  );
}

function base64UrlEncode(value: Uint8Array) {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(paddingPattern, "");
}

function base64UrlDecode(value: string) {
  if (!base64UrlPattern.test(value)) {
    throw new Error("Invalid base64url value");
  }
  const padded = value
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function ownedArrayBuffer(value: Uint8Array) {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}
