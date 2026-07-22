import { z } from "zod";
import {
  type CountrySweepTaskOutput,
  CountrySweepTaskOutputSchema,
  countrySweepCityKey,
} from "./schema";

export const COUNTRY_SWEEP_OUTPUT_SCHEMA_VERSION = 1;
export const MAX_CANONICAL_CHUNK_BYTES = 1_000_000;
export const MAX_RECORDS_PER_CHUNK = 1000;
export const INITIAL_COUNTRY_OUTPUT_ROLLING_SHA256 = "0".repeat(64);

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const WWW_PREFIX_PATTERN = /^www\./u;

export const CountrySweepChunkKindSchema = z.enum([
  "organizations",
  "contacts",
  "scopes",
]);

export const CountrySweepOrganizationRecordSchema = z
  .object({
    canonicalDomain: z.string().max(255),
    city: z.string().max(160),
    evidenceUrl: z.string().url().or(z.literal("")),
    identityKey: z.string().min(1).max(600),
    lastVerifiedAt: z.iso.datetime().nullable(),
    marketSegment: z.enum([
      "international_school",
      "kindergarten",
      "language_center",
      "private_school",
      "public_school",
      "school",
      "training_center",
      "university",
    ]),
    name: z.string().min(1).max(240),
    outreachEligibility: z.enum(["eligible", "review", "excluded"]),
    region: z.string().max(160),
    status: z.enum(["unverified", "active", "stale", "closed", "invalid"]),
    websiteUrl: z.string().url().or(z.literal("")),
  })
  .strict();

export const CountrySweepContactRecordSchema = z
  .object({
    contactKey: z.string().min(1).max(1800),
    evidenceUrl: z.string().url().or(z.literal("")),
    kind: z.enum(["email", "phone", "contact_form", "careers_page", "website"]),
    label: z.string().max(160),
    lastVerifiedAt: z.iso.datetime().nullable(),
    organizationIdentityKey: z.string().min(1).max(600),
    status: z.enum(["unverified", "active", "stale", "invalid"]),
    value: z.string().min(1).max(1000),
  })
  .strict();

export const CountrySweepScopeRecordSchema = z
  .object({
    city: z.string().max(160),
    query: z.string().max(500),
    scopeKey: z.string().min(1).max(1000),
    source: z.enum(["directories", "known_sources", "maps", "search"]),
  })
  .strict();

const chunkEnvelopeFields = {
  schemaVersion: z.literal(COUNTRY_SWEEP_OUTPUT_SCHEMA_VERSION),
};

export const CountrySweepCanonicalChunkSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...chunkEnvelopeFields,
      kind: z.literal("organizations"),
      records: z
        .array(CountrySweepOrganizationRecordSchema)
        .min(1)
        .max(MAX_RECORDS_PER_CHUNK),
    })
    .strict(),
  z
    .object({
      ...chunkEnvelopeFields,
      kind: z.literal("contacts"),
      records: z
        .array(CountrySweepContactRecordSchema)
        .min(1)
        .max(MAX_RECORDS_PER_CHUNK),
    })
    .strict(),
  z
    .object({
      ...chunkEnvelopeFields,
      kind: z.literal("scopes"),
      records: z
        .array(CountrySweepScopeRecordSchema)
        .min(1)
        .max(MAX_RECORDS_PER_CHUNK),
    })
    .strict(),
]);

export const CountrySweepChunkUploadSchema = z
  .object({
    byteLength: z.number().int().min(1).max(MAX_CANONICAL_CHUNK_BYTES),
    chunk: CountrySweepCanonicalChunkSchema,
    leaseToken: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    recordCount: z.number().int().min(1).max(MAX_RECORDS_PER_CHUNK),
    sha256: z.string().regex(SHA256_PATTERN),
  })
  .strict();

export const CountrySweepManifestSnapshotSchema = z
  .object({
    chunkCount: z.number().int().nonnegative(),
    contactCount: z.number().int().nonnegative(),
    organizationCount: z.number().int().nonnegative(),
    rollingSha256: z.string().regex(SHA256_PATTERN),
    scopeCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  })
  .strict();

export const CountrySweepOutputFinalizeSchema = z
  .object({
    coverageSummary: CountrySweepTaskOutputSchema.shape.coverageSummary,
    manifest: CountrySweepManifestSnapshotSchema,
    notes: CountrySweepTaskOutputSchema.shape.notes,
  })
  .strict();

export const CountrySweepOutputAcceptanceSchema =
  CountrySweepOutputFinalizeSchema.extend({
    leaseToken: z.string().min(1),
  }).strict();

export type CountrySweepCanonicalChunk = z.infer<
  typeof CountrySweepCanonicalChunkSchema
>;
export type CountrySweepChunkKind = z.infer<typeof CountrySweepChunkKindSchema>;
export type CountrySweepManifestSnapshot = z.infer<
  typeof CountrySweepManifestSnapshotSchema
>;

export function prepareCountrySweepChunkRecords(
  rawOutput: CountrySweepTaskOutput
) {
  const output = CountrySweepTaskOutputSchema.parse(rawOutput);
  const organizations = new Map<
    string,
    z.infer<typeof CountrySweepOrganizationRecordSchema>
  >();
  const contacts = new Map<
    string,
    z.infer<typeof CountrySweepContactRecordSchema>
  >();
  for (const organization of output.organizations) {
    const canonicalDomain = normalizeDomain(
      organization.canonicalDomain || organization.websiteUrl
    );
    const identityKey = canonicalDomain
      ? `domain:${canonicalDomain}`
      : `name:${normalizeIdentity(organization.name)}|city:${normalizeIdentity(
          organization.city
        )}`;
    organizations.set(identityKey, {
      canonicalDomain,
      city: organization.city.trim(),
      evidenceUrl: organization.evidenceUrl.trim(),
      identityKey,
      lastVerifiedAt: organization.lastVerifiedAt,
      marketSegment: organization.marketSegment,
      name: organization.name.trim(),
      outreachEligibility: organization.outreachEligibility,
      region: organization.region.trim(),
      status: organization.status,
      websiteUrl: organization.websiteUrl.trim(),
    });
    for (const contact of organization.contactPoints) {
      const value =
        contact.kind === "email"
          ? contact.value.trim().toLowerCase()
          : contact.value.trim();
      const contactKey = `${identityKey}|${contact.kind}:${value}`;
      contacts.set(contactKey, {
        contactKey,
        evidenceUrl: contact.evidenceUrl.trim(),
        kind: contact.kind,
        label: contact.label.trim(),
        lastVerifiedAt: organization.lastVerifiedAt,
        organizationIdentityKey: identityKey,
        status: contact.status,
        value,
      });
    }
  }
  const scopes = new Map<
    string,
    z.infer<typeof CountrySweepScopeRecordSchema>
  >();
  for (const scope of output.coverageSummary.nextScopes) {
    const scopeKey = [
      scope.source,
      countrySweepCityKey(scope.city),
      normalizeIdentity(scope.query),
    ]
      .filter(Boolean)
      .join(":");
    scopes.set(scopeKey, {
      city: scope.city.trim(),
      query: scope.query.trim(),
      scopeKey,
      source: scope.source,
    });
  }
  return {
    contacts: [...contacts.values()].sort((left, right) =>
      left.contactKey.localeCompare(right.contactKey, "en")
    ),
    organizations: [...organizations.values()].sort((left, right) =>
      left.identityKey.localeCompare(right.identityKey, "en")
    ),
    scopes: [...scopes.values()].sort((left, right) =>
      left.scopeKey.localeCompare(right.scopeKey, "en")
    ),
  };
}

export function createCountrySweepCanonicalChunks(
  rawOutput: CountrySweepTaskOutput
): CountrySweepCanonicalChunk[] {
  const records = prepareCountrySweepChunkRecords(rawOutput);
  return [
    ...chunkRecords("organizations", records.organizations),
    ...chunkRecords("contacts", records.contacts),
    ...chunkRecords("scopes", records.scopes),
  ];
}

export function canonicalCountrySweepChunkJson(
  chunk: CountrySweepCanonicalChunk
) {
  return JSON.stringify(CountrySweepCanonicalChunkSchema.parse(chunk));
}

export async function sha256Hex(value: string | Uint8Array) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", ownedBytes.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function chunkRecords<K extends CountrySweepChunkKind>(
  kind: K,
  records: CountrySweepCanonicalChunk["records"]
): CountrySweepCanonicalChunk[] {
  const chunks: CountrySweepCanonicalChunk[] = [];
  let current: CountrySweepCanonicalChunk["records"] = [];
  for (const record of records) {
    const candidate = [
      ...current,
      record,
    ] as CountrySweepCanonicalChunk["records"];
    if (current.length > 0 && candidate.length > MAX_RECORDS_PER_CHUNK) {
      chunks.push({
        kind,
        records: current,
        schemaVersion: COUNTRY_SWEEP_OUTPUT_SCHEMA_VERSION,
      } as CountrySweepCanonicalChunk);
      current = [record] as CountrySweepCanonicalChunk["records"];
      continue;
    }
    const candidateChunk = {
      kind,
      records: candidate,
      schemaVersion: COUNTRY_SWEEP_OUTPUT_SCHEMA_VERSION,
    } as CountrySweepCanonicalChunk;
    const candidateBytes = new TextEncoder().encode(
      canonicalCountrySweepChunkJson(candidateChunk)
    ).byteLength;
    if (current.length > 0 && candidateBytes > MAX_CANONICAL_CHUNK_BYTES) {
      chunks.push({
        kind,
        records: current,
        schemaVersion: COUNTRY_SWEEP_OUTPUT_SCHEMA_VERSION,
      } as CountrySweepCanonicalChunk);
      current = [record] as CountrySweepCanonicalChunk["records"];
      continue;
    }
    if (candidateBytes > MAX_CANONICAL_CHUNK_BYTES) {
      throw new Error(`One ${kind} record exceeds the canonical chunk limit`);
    }
    current = candidate;
  }
  if (current.length > 0) {
    chunks.push({
      kind,
      records: current,
      schemaVersion: COUNTRY_SWEEP_OUTPUT_SCHEMA_VERSION,
    } as CountrySweepCanonicalChunk);
  }
  return chunks;
}

function normalizeDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`
    );
    return url.hostname.replace(WWW_PREFIX_PATTERN, "");
  } catch {
    return "";
  }
}

function normalizeIdentity(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/\p{Mark}+/gu, "")
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
}
