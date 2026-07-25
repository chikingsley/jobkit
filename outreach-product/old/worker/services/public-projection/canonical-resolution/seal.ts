import { canonicalIdentitySignal } from "../../../../src/features/public/identity-signals";
import { normalizeIdentityText } from "../../../../src/features/public/source-position-identity";
import {
  EXACT_PROJECTION_ANALYSIS_GUARD_SQL,
  exactProjectionAnalysisGuardBindings,
} from "../analysis-guard";
import { canonicalJson, canonicalSha256, compareUtf8Bytes } from "../hash";
import { projectionRunCounterStatement } from "../listing-items";
import {
  assertClaimedPositionUpdate,
  assertPositionClaimLease,
  type ClaimedProjectionPosition,
  claimedPositionUpdateStatement,
} from "../position-items";
import {
  CanonicalResolutionInputError,
  type CanonicalResolutionResult,
  type LocationResolutionArtifact,
  MAX_D3_BATCH_STATEMENTS,
  type OrganizationResolutionArtifact,
  type ResolutionInputs,
  type ResolutionState,
} from "./model";
import {
  canonicalSignalInsert,
  locationCandidateInserts,
  locationEvidenceInserts,
  locationProviderEvidenceInserts,
  locationResolutionInserts,
  organizationCandidatesInserts,
  organizationEvidenceInserts,
  organizationResolutionInsert,
  resolutionSealInsert,
  transactionChangeAssertion,
} from "./persistence";
import { normalizeText } from "./support";

export async function sealResolution(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  inputs: ResolutionInputs,
  organization: OrganizationResolutionArtifact,
  locations: LocationResolutionArtifact[],
  rawCheckpoint: Record<string, unknown>,
  timestamp: string
): Promise<CanonicalResolutionResult> {
  const { reasonCode, state } = canonicalResolutionOutcome(
    organization,
    locations
  );
  const locationIds = locations
    .map((location) => location.proposedCanonicalLocationId)
    .filter(Boolean)
    .sort(compareUtf8Bytes);
  const locationSetHash = await canonicalSha256(
    locations
      .map((location) => ({
        id: location.resolutionId,
        ordinal: location.ordinal,
        resolutionHash: location.resolutionHash,
      }))
      .sort((left, right) => left.ordinal - right.ordinal)
  );
  const normalizedSubjects = [
    ...new Set(
      inputs.position.subjects.map((subject) => normalizeText(subject.value))
    ),
  ]
    .filter(Boolean)
    .sort(compareUtf8Bytes);
  const normalizedTitle = normalizeIdentityText(inputs.position.title);
  const canonicalSignal =
    state === "resolved" && organization.selectedOrganizationId
      ? await canonicalIdentitySignal({
          locationIds,
          organizationId: organization.selectedOrganizationId,
          roleFamily: inputs.position.roleFamily,
          subjects: normalizedSubjects,
          title: inputs.position.title,
        })
      : null;
  const canonicalSignalHash = canonicalSignal ? canonicalSignal.hash : null;
  const signalPayload = {
    locationIds,
    locationSetHash,
    normalizedSubjects,
    normalizedTitle,
    organizationResolutionHash: organization.resolutionHash,
    organizationResolutionId: organization.resolutionId,
    roleFamily: inputs.position.roleFamily,
  };
  const signalPayloadHash = await canonicalSha256(signalPayload);
  const sealWithoutHash = {
    canonicalSignalHash,
    duplicateBatchInputHash: inputs.batch.input_hash,
    locationCount: locations.length,
    locationSetHash,
    organizationResolutionHash: organization.resolutionHash,
    organizationResolutionId: organization.resolutionId,
    positionInputHash: claim.inputHash,
    positionItemId: claim.id,
    reasonCode,
    runId: claim.runId,
    sourcePositionId: claim.sourcePositionId,
    state,
  };
  const sealHash = await canonicalSha256(sealWithoutHash);
  const resolutionGuardToken = crypto.randomUUID();
  await assertPositionClaimLease(db, claim);
  const statements = [
    resolutionGuardStatement(db, claim, inputs, resolutionGuardToken),
    transactionChangeAssertion(db),
    organizationResolutionInsert(
      db,
      claim,
      inputs,
      organization,
      resolutionGuardToken,
      timestamp
    ),
    ...organizationCandidatesInserts(db, organization.candidates),
    ...organizationEvidenceInserts(db, organization.evidence),
    ...locationResolutionInserts(db, claim, locations, resolutionGuardToken),
    ...locationProviderEvidenceInserts(
      db,
      locations.flatMap((location) =>
        location.providerEvidence ? [location.providerEvidence] : []
      )
    ),
    ...locationCandidateInserts(
      db,
      locations.flatMap((location) => location.candidates)
    ),
    ...locationEvidenceInserts(
      db,
      locations.flatMap((location) => location.evidence)
    ),
    canonicalSignalInsert(db, {
      createdAt: timestamp,
      locationIdsJson: canonicalJson(locationIds),
      locationSetHash,
      normalizedSubjectsJson: canonicalJson(normalizedSubjects),
      normalizedTitle,
      organizationResolutionHash: organization.resolutionHash,
      organizationResolutionId: organization.resolutionId,
      positionItemId: claim.id,
      roleFamily: inputs.position.roleFamily,
      runId: claim.runId,
      signalHash: canonicalSignalHash,
      signalPayloadHash,
      state: canonicalSignal ? "resolved" : "blocked",
    }),
    resolutionSealInsert(db, claim, {
      ...sealWithoutHash,
      createdAt: timestamp,
      sealHash,
    }),
    claimedPositionUpdateStatement(db, claim, {
      checkpoint: {
        ...rawCheckpoint,
        canonicalResolution: {
          canonicalSignalHash,
          locationCount: locations.length,
          locationSetHash,
          organizationResolutionHash: organization.resolutionHash,
          organizationResolutionId: organization.resolutionId,
          reasonCode,
          sealHash,
          state,
        },
      },
      checkpointGuardPath: "$.resolutionGuard",
      checkpointGuardToken: resolutionGuardToken,
      errorCode: state === "resolved" ? "" : reasonCode,
      errorDetail:
        state === "resolved"
          ? ""
          : "Canonical organization or location evidence stayed private",
      stage: "canonical_resolution",
      status: state === "resolved" ? "queued" : "blocked",
    }),
    transactionChangeAssertion(db),
    projectionRunCounterStatement(db, claim.runId, timestamp),
  ];
  if (statements.length > MAX_D3_BATCH_STATEMENTS) {
    throw new CanonicalResolutionInputError(
      "canonical_resolution_batch_limit_exceeded",
      `Canonical resolution requires ${statements.length} D1 statements`
    );
  }
  const results = await db.batch(statements);
  assertClaimedPositionUpdate(results.at(-3), "canonical resolution seal");
  return {
    blocked: state === "resolved" ? 0 : 1,
    resolved: state === "resolved" ? 1 : 0,
    retried: 0,
    sealed: 1,
    state,
  };
}

function canonicalResolutionOutcome(
  organization: OrganizationResolutionArtifact,
  locations: LocationResolutionArtifact[]
) {
  const locationStates = new Set(locations.map((location) => location.state));
  const state = highestResolutionState(organization.state, locationStates);
  if (state === "resolved") {
    return { reasonCode: "canonical_resolution_resolved", state };
  }
  if (organization.state === state) {
    return { reasonCode: organization.reasonCode, state };
  }
  return {
    reasonCode:
      locations.find((location) => location.state === state)?.reasonCode ??
      "canonical_resolution_blocked",
    state,
  };
}

function highestResolutionState(
  organizationState: ResolutionState,
  locationStates: Set<ResolutionState>
): ResolutionState {
  for (const state of ["blocked", "ambiguous", "unresolved"] as const) {
    if (organizationState === state || locationStates.has(state)) {
      return state;
    }
  }
  return "resolved";
}

function resolutionGuardStatement(
  db: D1Database,
  claim: ClaimedProjectionPosition,
  inputs: ResolutionInputs,
  guardToken: string
) {
  return db
    .prepare(
      `UPDATE public_projection_position_items
          SET checkpoint_json=json_set(
            checkpoint_json,'$.resolutionGuard',?
          )
        WHERE id=? AND run_id=? AND status='processing'
          AND stage='canonical_resolution'
          AND lease_owner=? AND lease_token=?
          AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND input_hash=? AND listing_item_id=? AND source_position_id=?
          AND checkpoint_json=?
          AND EXISTS (
            SELECT 1
              FROM public_projection_duplicate_batches batch
              JOIN public_projection_duplicate_batch_members member
                ON member.run_id=batch.run_id
             WHERE batch.run_id=? AND batch.input_hash=?
               AND batch.canonical_identity_state='pending'
               AND member.position_item_id=?
               AND member.source_position_id=?
               AND member.input_hash=?
          )
          ${EXACT_PROJECTION_ANALYSIS_GUARD_SQL}`
    )
    .bind(
      guardToken,
      claim.id,
      claim.runId,
      claim.leaseOwner,
      claim.leaseToken,
      claim.inputHash,
      claim.listingItemId,
      claim.sourcePositionId,
      claim.checkpointJson,
      claim.runId,
      inputs.batch.input_hash,
      claim.id,
      claim.sourcePositionId,
      claim.inputHash,
      ...exactProjectionAnalysisGuardBindings(
        inputs.listing,
        inputs.analysisGuard
      )
    );
}
