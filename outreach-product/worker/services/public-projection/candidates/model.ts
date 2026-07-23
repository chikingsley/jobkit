import { z } from "zod";
import {
  PublicJobDetailResponseSchema,
  PublicJobListItemSchema,
  PublicLocationSchema,
} from "../../../public-jobs/schemas";

const sourceMappingSchema = z
  .object({
    fieldsUsed: z.array(z.string()),
    inputHash: z.string().length(64),
    listingId: z.string().min(1),
    materialVersion: z.number().int().positive(),
    policyVersion: z.number().int().positive(),
    predecessorMappingVersion: z.number().int().positive().nullable(),
    sourceKey: z.string().min(1),
    sourcePositionId: z.string().min(1),
  })
  .strict();

const candidateLocationSchema = z
  .object({
    inputLabel: z.string(),
    locationId: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    providerPlaceId: z.string().min(1),
    publicValue: PublicLocationSchema,
    resolutionEvidence: z.record(z.string(), z.unknown()),
  })
  .strict();

export const PublicProjectionCandidateSchema = z
  .object({
    allocationId: z.string().min(1),
    applicationRouteId: z.string().min(1).nullable(),
    candidateId: z.string().min(1),
    contractVersion: z.literal(1),
    decision: z
      .object({
        browseEligible: z.boolean(),
        contentReviewState: z.literal("approved"),
        decisionVersion: z.number().int().positive(),
        jobPostingEligible: z.boolean(),
        organicIndexEligible: z.boolean(),
        predecessorVersion: z.number().int().positive().nullable(),
        privacyState: z.literal("passed"),
        publicationState: z.enum(["private", "published"]),
        reasonCodes: z.array(z.string()).min(1),
        routeDisposition: z.enum(["private", "serve"]),
      })
      .strict(),
    detail: PublicJobDetailResponseSchema,
    finalDuplicateSealHash: z.string().length(64),
    identitySignalHash: z.string().length(64),
    item: PublicJobListItemSchema,
    locations: z.array(candidateLocationSchema).min(1),
    policyHeadsHash: z.string().length(64),
    publicContentHash: z.string().length(64),
    publicJobId: z.string().min(1),
    publicJobVersion: z.number().int().positive(),
    publicJobVersionPredecessor: z.number().int().positive().nullable(),
    runId: z.string().min(1),
    sourceMappings: z.array(sourceMappingSchema).min(1),
    sourcePositionId: z.string().min(1),
    sourceWatermarkJson: z.string().min(1),
    version: z
      .object({
        canonicalSlug: z.string().min(1),
        compensationJson: z.string(),
        contentSchemaVersion: z.number().int().positive(),
        datePosted: z.string().nullable(),
        datePostedProvenance: z.enum(["board-published", "unknown"]),
        descriptionHtml: z.string().min(1),
        employmentTypesJson: z.string(),
        materialChangedAt: z.string().min(1),
        organizationId: z.string().min(1),
        organizationName: z.string().min(1),
        title: z.string().min(1),
        validThrough: z.string().nullable(),
        validThroughProvenance: z.enum(["board-published", "unknown"]),
        workplaceType: z.enum(["hybrid", "onsite", "remote"]),
      })
      .strict(),
  })
  .strict();

export type PublicProjectionCandidate = z.infer<
  typeof PublicProjectionCandidateSchema
>;

export interface CandidateAllocationRow {
  allocation_hash: string;
  allocation_id: string;
  final_duplicate_seal_hash: string;
  founding_source_position_id: string;
  policy_heads_hash: string;
  proposed_public_job_id: string | null;
  reason_code: string;
  run_id: string;
  source_watermark_json: string;
  state: "blocked" | "promotable";
  winning_public_job_id: string | null;
}

export interface CandidateSourceRow {
  input_hash: string;
  listing_id: string;
  listing_item_id: string;
  mapping_version: number | null;
  material_version: number;
  policy_version: number;
  position_item_id: string;
  source_key: string;
  source_position_id: string;
}

export interface CandidateLocationRow {
  bounds_json: string | null;
  coordinate_kind: string;
  country_code: string | null;
  display_name: string;
  latitude: number | null;
  literal_label: string;
  locality: string;
  longitude: number | null;
  ordinal: number;
  postal_code: string;
  proposed_canonical_location_id: string;
  provider_place_id: string;
  region: string;
  resolution_hash: string;
  resolution_id: string;
  role: string;
  scope: string;
  state: string;
  workplace_type: string;
}
