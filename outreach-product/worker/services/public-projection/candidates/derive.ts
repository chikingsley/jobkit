import { statedHourlyValue } from "../../../../src/features/jobs/economics";
import type { JobMatchFacts } from "../../../../src/features/matching/schema";
import {
  PUBLIC_JOB_DETAIL_SCHEMA_VERSION,
  PublicJobDetailResponseSchema,
  PublicJobListItemSchema,
} from "../../../public-jobs/schemas";
import { canonicalJson } from "../hash";
import type {
  CandidateAllocationRow,
  CandidateLocationRow,
  CandidateSourceRow,
  PublicProjectionCandidate,
} from "./model";
import {
  CandidateInputError,
  type readCandidatePolicy,
  type readCandidatePrimaryInput,
} from "./read-input";

const requiredPublicFields = [
  "description",
  "locations",
  "organization_name",
  "title",
] as const;

type CandidateLocation = PublicProjectionCandidate["locations"][number];

export function publicJobId(allocation: CandidateAllocationRow) {
  const id =
    allocation.winning_public_job_id ?? allocation.proposed_public_job_id;
  if (!id) {
    throw new CandidateInputError(
      "candidate_public_job_missing",
      "The promotable allocation lacks a public job identity"
    );
  }
  return id;
}

export function candidateLocations(rows: CandidateLocationRow[]) {
  return rows.map(candidateLocation);
}

function candidateLocation(row: CandidateLocationRow): CandidateLocation {
  const publicValue = publicLocation(row);
  return {
    inputLabel: row.literal_label,
    locationId: row.proposed_canonical_location_id,
    ordinal: row.ordinal,
    providerPlaceId: row.provider_place_id,
    publicValue,
    resolutionEvidence: {
      resolutionHash: row.resolution_hash,
      resolutionId: row.resolution_id,
    },
  };
}

function publicLocation(row: CandidateLocationRow) {
  const coordinateKind = publicCoordinateKind(row.coordinate_kind);
  if (
    !(
      row.country_code &&
      row.latitude !== null &&
      row.longitude !== null &&
      (row.role === "worksite" || row.role === "applicant_area") &&
      ["address", "countrywide", "locality", "region"].includes(row.scope) &&
      coordinateKind !== null
    )
  ) {
    throw new CandidateInputError(
      "candidate_location_invalid",
      "A resolved location cannot be represented by the public schema"
    );
  }
  return {
    bounds: row.bounds_json
      ? (JSON.parse(row.bounds_json) as [number, number, number, number])
      : null,
    coordinateKind,
    coordinates: { latitude: row.latitude, longitude: row.longitude },
    countryCode: row.country_code,
    displayName: row.display_name,
    locality: row.locality || null,
    postalCode: row.postal_code || null,
    region: row.region || null,
    role: row.role === "applicant_area" ? "applicantArea" : "worksite",
    scope: row.scope as "address" | "countrywide" | "locality" | "region",
  } as const;
}

/**
 * Sealed resolutions written before the coordinate-kind normalization carry
 * the provider-internal `provider_point` label for the provider-supplied
 * coordinates of a finite feature. The public vocabulary calls that a
 * `point`; resolution rows are immutable, so the value maps forward here.
 */
function publicCoordinateKind(kind: string) {
  if (kind === "point" || kind === "provider_point") {
    return "point" as const;
  }
  if (kind === "centroid") {
    return "centroid" as const;
  }
  return null;
}

export function publicWorkplaceType(rows: CandidateLocationRow[]) {
  const values = new Set(rows.map((row) => row.workplace_type));
  if (values.has("hybrid")) {
    return "hybrid" as const;
  }
  if (values.has("onsite")) {
    return "onsite" as const;
  }
  if (values.has("remote")) {
    return "remote" as const;
  }
  throw new CandidateInputError(
    "candidate_workplace_type_unknown",
    "The resolved location lacks a public workplace type"
  );
}

export function publicFields(
  allowedFields: Set<string>,
  primary: Awaited<ReturnType<typeof readCandidatePrimaryInput>>,
  enabled: boolean
) {
  if (!enabled) {
    return [];
  }
  const available = [
    "title",
    "organization_name",
    "locations",
    "description",
    ...(primary.snapshot.material.sourceDates.posted ? ["date_posted"] : []),
    ...(primary.snapshot.material.sourceDates.expires ? ["valid_through"] : []),
    ...(primary.position.employmentTypes.length > 0
      ? ["employment_types"]
      : []),
    ...(primary.facts.economics.compensation.kind === "unstated"
      ? []
      : ["compensation"]),
    "source_name",
    "source_url",
  ];
  return available.filter((field) => allowedFields.has(field));
}

export function candidateIsPublishable(
  policyEnabled: boolean,
  fieldsUsed: string[],
  applicationRouteId: string | null
) {
  return (
    policyEnabled &&
    applicationRouteId !== null &&
    requiredPublicFields.every((field) => fieldsUsed.includes(field))
  );
}

export function publicCompensation(facts: JobMatchFacts, timestamp: string) {
  const pay = facts.economics.compensation;
  const amount = compensationAmount(pay);
  if (pay.kind === "amount" && amount === null) {
    throw new CandidateInputError(
      "candidate_compensation_invalid",
      "Amount compensation lacks its required currency, period, or bound"
    );
  }
  const hourly = statedHourlyValue(facts.economics);
  return {
    amount,
    hourlyUsd:
      hourly?.currency === "USD"
        ? {
            basis: hourly.basis,
            fxAsOf: timestamp.slice(0, 10),
            maximum: hourly.maximum,
            minimum: hourly.minimum,
            taxBasis: hourly.taxBasis,
          }
        : null,
    kind: pay.kind,
  };
}

function compensationAmount(pay: JobMatchFacts["economics"]["compensation"]) {
  if (
    pay.kind !== "amount" ||
    !pay.currency ||
    !pay.period ||
    (pay.amountMinimum === null && pay.amountMaximum === null)
  ) {
    return null;
  }
  return {
    currency: pay.currency,
    maximum: pay.amountMaximum,
    minimum: pay.amountMinimum,
    period: pay.period,
    qualifier: pay.qualifier,
    taxBasis: pay.taxBasis,
  };
}

export function sourceAttribution(input: {
  fieldsUsed: string[];
  materialSourceUrl: string;
  policy: Awaited<ReturnType<typeof readCandidatePolicy>>;
}) {
  const name = input.fieldsUsed.includes("source_name")
    ? input.policy.displayLabel
    : null;
  const url = sourceAttributionUrl(input);
  return name || url ? [{ name, url }] : [];
}

function sourceAttributionUrl(input: {
  fieldsUsed: string[];
  materialSourceUrl: string;
  policy: Awaited<ReturnType<typeof readCandidatePolicy>>;
}) {
  if (
    input.policy.attributionMode !== "source_link" ||
    !input.fieldsUsed.includes("source_url") ||
    input.policy.sourceOriginUrl.length === 0 ||
    !input.materialSourceUrl.startsWith(input.policy.sourceOriginUrl)
  ) {
    return null;
  }
  return input.materialSourceUrl;
}

export function candidateViews(input: {
  canonicalSlug: string;
  compensation: ReturnType<typeof publicCompensation>;
  datePosted: string | null;
  descriptionHtml: string;
  employmentTypes: Array<"contract" | "fullTime" | "partTime">;
  fieldsUsed: string[];
  locations: CandidateLocation[];
  materialChangedAt: string;
  organizationName: string;
  publicJobId: string;
  publicJobVersion: number;
  publishable: boolean;
  sources: Array<{ name: string | null; url: string | null }>;
  timestamp: string;
  title: string;
  validThrough: string | null;
  workplaceType: "hybrid" | "onsite" | "remote";
}) {
  const common = {
    application: { available: input.publishable },
    canonicalPath: `/job/${input.publicJobId}/${input.canonicalSlug}`,
    canonicalSlug: input.canonicalSlug,
    compensation: input.fieldsUsed.includes("compensation")
      ? input.compensation
      : null,
    datePosted: publicDate(input.datePosted, input.fieldsUsed, "date_posted"),
    employmentTypes: input.fieldsUsed.includes("employment_types")
      ? input.employmentTypes
      : [],
    freshness: {
      materialChangedAt: input.materialChangedAt,
      verifiedAt: input.timestamp,
    },
    locations: input.locations.map(({ publicValue }) => publicValue),
    organization: { name: input.organizationName },
    publicId: input.publicJobId,
    publicJobVersion: input.publicJobVersion,
    sources: input.sources,
    title: input.title,
    validThrough: publicDate(
      input.validThrough,
      input.fieldsUsed,
      "valid_through"
    ),
    workplaceType: input.workplaceType,
  };
  return {
    detail: PublicJobDetailResponseSchema.parse({
      ...common,
      descriptionHtml: input.descriptionHtml,
      schemaVersion: PUBLIC_JOB_DETAIL_SCHEMA_VERSION,
      status: "active",
    }),
    item: PublicJobListItemSchema.parse({ ...common, status: "active" }),
  };
}

function publicDate(value: string | null, fields: string[], field: string) {
  return value && fields.includes(field)
    ? { provenance: "board-published" as const, value }
    : null;
}

/**
 * A `JobPosting` page needs the posting date the source board published and
 * a finite worksite (or, for remote work, at least one applicant area whose
 * countries can express `applicantLocationRequirements`).
 */
export function jobPostingLocationEligible(
  rows: CandidateLocationRow[],
  workplaceType: "hybrid" | "onsite" | "remote"
) {
  if (workplaceType === "remote") {
    return rows.some((row) => row.role === "applicant_area");
  }
  return rows.some(
    (row) => row.role === "worksite" && row.scope !== "countrywide"
  );
}

export function candidateDecision(input: {
  datePostedPublished: boolean;
  decisionVersion: number;
  jobPostingLocationEligible: boolean;
  predecessorVersion: number | null;
  publishable: boolean;
  routeAvailable: boolean;
}): PublicProjectionCandidate["decision"] {
  const jobPostingEligible =
    input.publishable &&
    input.datePostedPublished &&
    input.jobPostingLocationEligible;
  return {
    browseEligible: input.publishable,
    contentReviewState: "approved",
    decisionVersion: input.decisionVersion,
    jobPostingEligible,
    organicIndexEligible: input.publishable,
    predecessorVersion: input.predecessorVersion,
    privacyState: "passed",
    publicationState: input.publishable ? "published" : "private",
    reasonCodes: input.publishable
      ? [
          "candidate_published",
          ...(jobPostingEligible ? ["job_posting_eligible"] : []),
          ...(input.datePostedPublished
            ? []
            : ["job_posting_original_date_missing"]),
          ...(input.jobPostingLocationEligible
            ? []
            : ["job_posting_location_not_finite"]),
        ]
      : [
          input.routeAvailable
            ? "source_policy_private"
            : "application_route_missing",
        ],
    routeDisposition: input.publishable ? "serve" : "private",
  };
}

export function candidateVersion(input: {
  canonicalSlug: string;
  compensation: ReturnType<typeof publicCompensation>;
  datePosted: string | null;
  descriptionHtml: string;
  employmentTypes: Array<"contract" | "fullTime" | "partTime">;
  materialChangedAt: string;
  organizationId: string;
  organizationName: string;
  title: string;
  validThrough: string | null;
  workplaceType: "hybrid" | "onsite" | "remote";
}): PublicProjectionCandidate["version"] {
  return {
    canonicalSlug: input.canonicalSlug,
    compensationJson: canonicalJson(input.compensation),
    contentSchemaVersion: 1,
    datePosted: input.datePosted,
    datePostedProvenance: input.datePosted ? "board-published" : "unknown",
    descriptionHtml: input.descriptionHtml,
    employmentTypesJson: canonicalJson(input.employmentTypes),
    materialChangedAt: input.materialChangedAt,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    title: input.title,
    validThrough: input.validThrough,
    validThroughProvenance: input.validThrough ? "board-published" : "unknown",
    workplaceType: input.workplaceType,
  };
}

export function candidateSourceMappings(
  sources: CandidateSourceRow[],
  primarySourcePositionId: string,
  fieldsUsed: string[]
) {
  return sources.map((source) => ({
    fieldsUsed:
      source.source_position_id === primarySourcePositionId ? fieldsUsed : [],
    inputHash: source.input_hash,
    listingId: source.listing_id,
    materialVersion: source.material_version,
    policyVersion: source.policy_version,
    predecessorMappingVersion: source.mapping_version,
    sourceKey: source.source_key,
    sourcePositionId: source.source_position_id,
  }));
}

export function slugify(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLocaleLowerCase("und")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 200)
    .replace(/-+$/gu, "");
  return slug || "job";
}

export function unique<T>(values: T[]) {
  return [...new Set(values)];
}
