import type { z } from "zod";
import { resolveLocations } from "./canonical-resolution/location-assertions";
import { blockedProviderLocations } from "./canonical-resolution/location-outcome";
import {
  CanonicalResolutionInputError,
  type CanonicalResolutionResult,
  type DuplicateBatchRow,
  type LocationResolutionArtifact,
  type ResolutionInputs,
  SealedResolutionCheckpointSchema,
} from "./canonical-resolution/model";
import { resolveOrganization } from "./canonical-resolution/organization-candidates";
import { sealResolution } from "./canonical-resolution/seal";
import {
  blockInputClaim,
  parseJsonObject,
  providerFailureShouldRetry,
  retryProviderFailure,
} from "./canonical-resolution/support";
import { canonicalSha256 } from "./hash";
import {
  ProjectionListingSnapshotError,
  readExactProjectionListingSnapshot,
} from "./listing-snapshot";
import {
  LocationProviderError,
  type PermanentLocationResolver,
} from "./mapbox-location-resolver";
import type { ClaimedProjectionPosition } from "./position-items";
import { readProjectionAnalysisPrerequisites } from "./prerequisites";

export async function processProjectionCanonicalResolutionClaim(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  timestamp: string,
  locationResolver: PermanentLocationResolver
): Promise<CanonicalResolutionResult> {
  const rawCheckpoint = parseJsonObject(claim.checkpointJson);
  const checkpoint = SealedResolutionCheckpointSchema.safeParse(rawCheckpoint);
  if (!checkpoint.success) {
    return blockInputClaim(
      db,
      claim,
      timestamp,
      "canonical_resolution_checkpoint_invalid",
      "The sealed canonical-resolution checkpoint is invalid",
      rawCheckpoint
    );
  }

  try {
    const inputs = await readResolutionInputs(db, claim, checkpoint.data);
    let locations: LocationResolutionArtifact[];
    try {
      locations = await resolveLocations(
        claim,
        inputs,
        timestamp,
        locationResolver
      );
    } catch (error) {
      if (!(error instanceof LocationProviderError)) {
        throw error;
      }
      if (providerFailureShouldRetry(error.code, claim)) {
        return retryProviderFailure(db, claim, error, rawCheckpoint);
      }
      locations = await blockedProviderLocations(
        claim,
        inputs,
        timestamp,
        error.code
      );
    }
    const organization = await resolveOrganization(
      db,
      claim,
      inputs,
      locations,
      timestamp
    );
    const result = await sealResolution(
      db,
      claim,
      inputs,
      organization,
      locations,
      rawCheckpoint,
      timestamp
    );
    return result;
  } catch (error) {
    if (error instanceof CanonicalResolutionInputError) {
      return blockInputClaim(
        db,
        claim,
        timestamp,
        error.code,
        error.message,
        rawCheckpoint
      );
    }
    if (error instanceof ProjectionListingSnapshotError) {
      return blockInputClaim(
        db,
        claim,
        timestamp,
        error.code,
        error.message,
        rawCheckpoint
      );
    }
    throw error;
  }
}

async function readResolutionInputs(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  checkpoint: z.infer<typeof SealedResolutionCheckpointSchema>
): Promise<ResolutionInputs> {
  const [listing, batch] = await Promise.all([
    readExactProjectionListingSnapshot(db, claim.listingItemId),
    db
      .prepare(
        `SELECT batch.input_hash,batch.canonical_identity_state,
                member.source_position_id member_source_position_id,
                member.input_hash member_input_hash
           FROM public_projection_duplicate_batches batch
           JOIN public_projection_duplicate_batch_members member
             ON member.run_id=batch.run_id
          WHERE batch.run_id=? AND member.position_item_id=? LIMIT 1`
      )
      .bind(claim.runId, claim.id)
      .first<DuplicateBatchRow>(),
  ]);
  if (batch?.canonical_identity_state !== "pending") {
    throw new CanonicalResolutionInputError(
      "canonical_resolution_d2_missing",
      "The sealed D2 duplicate batch is unavailable"
    );
  }
  const prerequisites = await readProjectionAnalysisPrerequisites(db, listing);
  if (!(prerequisites.ready && prerequisites.position && prerequisites.guard)) {
    throw new CanonicalResolutionInputError(
      "canonical_resolution_analysis_snapshot_changed",
      "The exact analysis snapshot is no longer ready"
    );
  }
  const position = prerequisites.position.positions[checkpoint.sourceOrdinal];
  if (!position) {
    throw new CanonicalResolutionInputError(
      "canonical_resolution_position_missing",
      "The sealed source ordinal is outside the position analysis"
    );
  }
  const positionPayloadHash = await canonicalSha256(position);
  if (
    checkpoint.sourcePositionId !== claim.sourcePositionId ||
    checkpoint.identity.sourcePosition.id !== claim.sourcePositionId ||
    checkpoint.identity.sourcePosition.sourceOrdinal !==
      checkpoint.sourceOrdinal ||
    batch.member_source_position_id !== claim.sourcePositionId ||
    batch.member_input_hash !== claim.inputHash ||
    checkpoint.listingInputHash !== listing.inputHash ||
    checkpoint.materialHash !== listing.materialHash ||
    checkpoint.materialVersion !== listing.materialVersion ||
    checkpoint.positionPayloadHash !== positionPayloadHash ||
    checkpoint.analysisHashes.content !==
      prerequisites.checkpoint.content.payloadHash ||
    checkpoint.analysisHashes.matchFacts !==
      prerequisites.checkpoint.matchFacts.payloadHash ||
    checkpoint.analysisHashes.position !==
      prerequisites.checkpoint.position.payloadHash
  ) {
    throw new CanonicalResolutionInputError(
      "canonical_resolution_input_snapshot_changed",
      "The canonical-resolution inputs no longer match their exact seals"
    );
  }
  return {
    analysisGuard: prerequisites.guard,
    batch,
    checkpoint,
    listing,
    position,
  };
}
