import { parse } from "node-html-parser";
import { z } from "zod";
import { containsPrivateContactValue } from "../../src/features/public/description";

export const PUBLIC_JOB_LIST_SCHEMA_VERSION = "public-job-list-v1" as const;
export const PUBLIC_JOB_DETAIL_SCHEMA_VERSION = "public-job-detail-v1" as const;
export const PUBLIC_JOB_SERIALIZER_VERSION =
  "public-job-serializer-v1" as const;

const utcTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u)
  .refine((value) => Number.isFinite(Date.parse(value)));
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.valueOf()) &&
      parsed.toISOString().startsWith(value)
    );
  });
const publicId = z.string().regex(/^pjob_v1_[0-9a-f]{64}$/u);
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(200);
const finiteNumber = z.number().finite();
const nullableFiniteNumber = finiteNumber.nullable();
const countryCode = z.string().regex(/^[A-Z]{2}$/u);
const currency = z.string().regex(/^[A-Z]{3}$/u);

export const PublicWorkplaceTypeSchema = z.enum(["onsite", "hybrid", "remote"]);
export const PublicEmploymentTypeSchema = z.enum([
  "fullTime",
  "partTime",
  "contract",
]);

export const PublicSourceDateSchema = z
  .object({
    provenance: z.enum(["employer-original", "board-published"]),
    value: calendarDate,
  })
  .strict();

const CoordinatesSchema = z
  .object({
    latitude: finiteNumber.min(-90).max(90),
    longitude: finiteNumber.min(-180).max(180),
  })
  .strict();

const BoundsSchema = z
  .tuple([
    finiteNumber.min(-180).max(180),
    finiteNumber.min(-90).max(90),
    finiteNumber.min(-180).max(180),
    finiteNumber.min(-90).max(90),
  ])
  .refine(([west, south, east, north]) => west <= east && south <= north);

export const PublicLocationSchema = z
  .object({
    bounds: BoundsSchema.nullable(),
    coordinateKind: z.enum(["point", "centroid"]),
    coordinates: CoordinatesSchema,
    countryCode,
    displayName: z.string().trim().min(1).max(300),
    locality: z.string().trim().min(1).max(200).nullable(),
    postalCode: z.string().trim().min(1).max(40).nullable(),
    region: z.string().trim().min(1).max(200).nullable(),
    role: z.enum(["worksite", "applicantArea"]),
    scope: z.enum(["address", "locality", "region", "countrywide"]),
  })
  .strict();

const CompensationAmountSchema = z
  .object({
    currency,
    maximum: nullableFiniteNumber,
    minimum: nullableFiniteNumber,
    period: z.enum([
      "hour",
      "day",
      "week",
      "fortnight",
      "month",
      "year",
      "contract",
    ]),
    qualifier: z.enum(["exact", "range", "up-to", "from"]).nullable(),
    taxBasis: z.enum(["gross", "net", "unspecified"]),
  })
  .strict()
  .refine(({ maximum, minimum }) => maximum !== null || minimum !== null)
  .refine(
    ({ maximum, minimum }) =>
      maximum === null || minimum === null || minimum <= maximum
  );

const HourlyUsdSchema = z
  .object({
    basis: z.enum(["listed", "onsite", "teaching", "teaching-plus-office"]),
    fxAsOf: calendarDate,
    maximum: nullableFiniteNumber,
    minimum: nullableFiniteNumber,
    taxBasis: z.enum(["gross", "net", "unspecified"]),
  })
  .strict()
  .refine(({ maximum, minimum }) => maximum !== null || minimum !== null)
  .refine(
    ({ maximum, minimum }) =>
      maximum === null || minimum === null || minimum <= maximum
  );

export const PublicCompensationSchema = z
  .object({
    amount: CompensationAmountSchema.nullable(),
    hourlyUsd: HourlyUsdSchema.nullable(),
    kind: z.enum(["amount", "conflict", "negotiable", "unstated"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "amount" && value.amount === null) {
      context.addIssue({
        code: "custom",
        message: "amount compensation needs an amount",
      });
    }
    if (value.kind !== "amount" && value.amount !== null) {
      context.addIssue({
        code: "custom",
        message: "non-amount compensation omits amount",
      });
    }
  });

export const PublicSourceAttributionSchema = z
  .object({
    name: z.string().trim().min(1).max(200).nullable(),
    url: z
      .url()
      .refine((value) => {
        const parsedUrl = new URL(value);
        return (
          parsedUrl.protocol === "https:" &&
          parsedUrl.username === "" &&
          parsedUrl.password === "" &&
          parsedUrl.hash === ""
        );
      })
      .nullable(),
  })
  .strict()
  .refine(({ name, url }) => name !== null || url !== null);

const FreshnessSchema = z
  .object({
    materialChangedAt: utcTimestamp,
    verifiedAt: utcTimestamp,
  })
  .strict();

const ApplicationAvailabilitySchema = z
  .object({ available: z.boolean() })
  .strict();
const OrganizationSchema = z
  .object({
    name: z.string().trim().min(1).max(300),
  })
  .strict();

const PublicJobCommonSchema = z
  .object({
    application: ApplicationAvailabilitySchema,
    canonicalPath: z.string(),
    canonicalSlug: slug,
    compensation: PublicCompensationSchema.nullable(),
    datePosted: PublicSourceDateSchema.nullable(),
    employmentTypes: z.array(PublicEmploymentTypeSchema).max(3),
    freshness: FreshnessSchema,
    locations: z.array(PublicLocationSchema).min(1).max(100),
    organization: OrganizationSchema,
    publicId,
    publicJobVersion: z.number().int().positive(),
    sources: z.array(PublicSourceAttributionSchema).max(100),
    title: z.string().trim().min(1).max(500),
    validThrough: PublicSourceDateSchema.nullable(),
    workplaceType: PublicWorkplaceTypeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.canonicalPath !== `/job/${value.publicId}/${value.canonicalSlug}`
    ) {
      context.addIssue({
        code: "custom",
        message: "canonical path does not match its job",
      });
    }
    const hasWorksite = value.locations.some(({ role }) => role === "worksite");
    const hasApplicantArea = value.locations.some(
      ({ role }) => role === "applicantArea"
    );
    if (
      !(hasWorksite || (value.workplaceType === "remote" && hasApplicantArea))
    ) {
      context.addIssue({
        code: "custom",
        message: "job has no publishable location",
      });
    }
  });

export const PublicJobListItemSchema = PublicJobCommonSchema.extend({
  status: z.literal("active"),
}).strict();

export const PublicJobDetailResponseSchema = PublicJobCommonSchema.extend({
  descriptionHtml: z.string().min(1),
  schemaVersion: z.literal(PUBLIC_JOB_DETAIL_SCHEMA_VERSION),
  status: z.enum(["active", "closed"]),
}).strict();

export const PublicJobListScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }),
  z.object({
    countryCode,
    countrySlug: slug,
    kind: z.literal("country"),
  }),
  z.object({
    citySlug: slug,
    countryCode,
    countrySlug: slug,
    displayName: z.string().trim().min(1).max(300),
    kind: z.literal("city"),
  }),
]);

export const PublicJobListQuerySchema = z.object({
  compensation: z.enum(["stated", "negotiable"]).nullable(),
  country: countryCode.nullable(),
  employmentType: PublicEmploymentTypeSchema.nullable(),
  limit: z.number().int().min(1).max(50),
  q: z.string().min(1).max(120).nullable(),
  sort: z.enum(["relevance", "recent", "hourlyUsd", "title"]),
  workplace: PublicWorkplaceTypeSchema.nullable(),
});

export const PublicJobListResponseSchema = z.object({
  catalog: z.object({
    materialChangedAt: utcTimestamp,
    searchIndexVersion: z.string().trim().min(1),
    version: z.string().trim().min(1),
  }),
  items: z.array(PublicJobListItemSchema),
  page: z.object({
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
  query: PublicJobListQuerySchema,
  schemaVersion: z.literal(PUBLIC_JOB_LIST_SCHEMA_VERSION),
  scope: PublicJobListScopeSchema,
});

export type PublicJobDetailResponse = z.infer<
  typeof PublicJobDetailResponseSchema
>;
export type PublicJobListItem = z.infer<typeof PublicJobListItemSchema>;
export type PublicJobListQuery = z.infer<typeof PublicJobListQuerySchema>;
export type PublicJobListResponse = z.infer<typeof PublicJobListResponseSchema>;
export type PublicJobListScope = z.infer<typeof PublicJobListScopeSchema>;

export interface PublicJobReadRow {
  application_available: number;
  canonical_slug: string;
  compensation_json: string | null;
  date_posted: string | null;
  date_posted_provenance: string;
  description_html?: string;
  employment_types_json: string;
  locations_json: string;
  material_changed_at: string;
  organization_name: string;
  public_job_id: string;
  public_job_version: number;
  publication_state: string;
  source_attributions_json: string;
  title: string;
  valid_through: string | null;
  valid_through_provenance: string;
  verified_at: string;
  workplace_type: string;
}

export function serializePublicJobListItem(
  row: PublicJobReadRow
): PublicJobListItem {
  return PublicJobListItemSchema.parse({
    ...serializeCommon(row),
    status: "active",
  });
}

export function serializePublicJobListItemValue(value: unknown) {
  return PublicJobListItemSchema.parse(value);
}

export function serializePublicJobDetailValue(value: unknown) {
  const detail = PublicJobDetailResponseSchema.parse(value);
  return PublicJobDetailResponseSchema.parse({
    ...detail,
    descriptionHtml: sanitizePublicDescription(detail.descriptionHtml),
  });
}

export function serializePublicJobDetail(
  row: PublicJobReadRow
): PublicJobDetailResponse {
  const status = row.publication_state === "closed" ? "closed" : "active";
  return serializePublicJobDetailValue({
    ...serializeCommon(row),
    application: {
      available: status === "active" && row.application_available === 1,
    },
    descriptionHtml: row.description_html ?? "",
    schemaVersion: PUBLIC_JOB_DETAIL_SCHEMA_VERSION,
    status,
  });
}

function serializeCommon(row: PublicJobReadRow) {
  const sources = sourceAttributions(row.source_attributions_json);
  return {
    application: { available: row.application_available === 1 },
    canonicalPath: `/job/${row.public_job_id}/${row.canonical_slug}`,
    canonicalSlug: row.canonical_slug,
    compensation: parseNullableJson(row.compensation_json),
    datePosted: sourceDate(row.date_posted, row.date_posted_provenance),
    employmentTypes: parseJson(row.employment_types_json),
    freshness: {
      materialChangedAt: row.material_changed_at,
      verifiedAt: row.verified_at,
    },
    locations: parseJson(row.locations_json),
    organization: { name: row.organization_name },
    publicId: row.public_job_id,
    publicJobVersion: row.public_job_version,
    sources,
    title: row.title,
    validThrough: sourceDate(row.valid_through, row.valid_through_provenance),
    workplaceType: row.workplace_type,
  };
}

function sourceDate(value: string | null, provenance: string) {
  return value === null ? null : { provenance, value };
}

function sourceAttributions(value: string) {
  const parsed = z.array(PublicSourceAttributionSchema).parse(parseJson(value));
  const unique = new Map<
    string,
    z.infer<typeof PublicSourceAttributionSchema>
  >();
  for (const source of parsed) {
    unique.set(`${source.name ?? ""}\u0000${source.url ?? ""}`, source);
  }
  return [...unique.values()].sort((left, right) =>
    compareBytes(
      `${left.name ?? ""}\u0000${left.url ?? ""}`,
      `${right.name ?? ""}\u0000${right.url ?? ""}`
    )
  );
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function parseNullableJson(value: string | null): unknown {
  return value === null ? null : parseJson(value);
}

function compareBytes(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return leftBytes.length - rightBytes.length;
}

function sanitizePublicDescription(value: string) {
  if (value.includes("<!--")) {
    throw new Error("Public description contains a comment");
  }
  const root = parse(value);
  const allowedTags = new Set(["SECTION", "H2", "P", "UL", "LI"]);
  for (const element of root.querySelectorAll("*")) {
    if (
      !allowedTags.has(element.tagName) ||
      Object.keys(element.attributes).length > 0
    ) {
      throw new Error("Public description contains disallowed markup");
    }
  }
  if (root.querySelectorAll("*").length === 0) {
    throw new Error("Public description contains no allowed elements");
  }
  if (containsPrivateContactValue(root.textContent)) {
    throw new Error("Public description contains a private contact value");
  }
  return root.toString();
}
