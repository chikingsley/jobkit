import type { PublicProjectionCandidate } from "../candidates/model";
import { canonicalSha256 } from "../hash";
import type { PreparedMapping } from "./model";

export async function preparePromotionMappings(
  candidate: PublicProjectionCandidate
) {
  return await Promise.all(
    candidate.sourceMappings.map(async (source): Promise<PreparedMapping> => {
      const mappingVersion = (source.predecessorMappingVersion ?? 0) + 1;
      return {
        fieldsUsed: source.fieldsUsed,
        inputHash: source.inputHash,
        listingId: source.listingId,
        mappingHash: await canonicalSha256({
          listingId: source.listingId,
          listingMaterialVersion: source.materialVersion,
          mappingState: "mapped",
          predecessorVersion: source.predecessorMappingVersion,
          publicJobId: candidate.publicJobId,
          sourcePositionId: source.sourcePositionId,
          version: mappingVersion,
        }),
        mappingVersion,
        materialVersion: source.materialVersion,
        policyVersion: source.policyVersion,
        predecessorMappingVersion: source.predecessorMappingVersion,
        sourceKey: source.sourceKey,
        sourcePositionId: source.sourcePositionId,
      };
    })
  );
}

export function promotionDecision(candidate: PublicProjectionCandidate) {
  const hasRoute = candidate.applicationRouteId !== null;
  return {
    applicationRouteId: candidate.applicationRouteId,
    applicationRouteState: hasRoute ? "valid" : "unresolved",
    browseEligible: candidate.decision.browseEligible,
    contentReviewState: candidate.decision.contentReviewState,
    decisionVersion: candidate.decision.decisionVersion,
    jobPostingEligible: candidate.decision.jobPostingEligible,
    organicIndexEligible: candidate.decision.organicIndexEligible,
    predecessorVersion: candidate.decision.predecessorVersion,
    privacyState: candidate.decision.privacyState,
    publicationState: candidate.decision.publicationState,
    reasonCodes: candidate.decision.reasonCodes,
    routeDisposition: candidate.decision.routeDisposition,
    sourceOpenState: hasRoute ? "open" : "unknown",
  } as const;
}

export function promotionDecisionHash(candidate: PublicProjectionCandidate) {
  return canonicalSha256({
    ...promotionDecision(candidate),
    publicJobId: candidate.publicJobId,
    publicJobVersion: candidate.publicJobVersion,
  });
}

export function promotionManifestHash(input: {
  activatedCatalogVersion: string;
  authorizedAt: string;
  candidate: PublicProjectionCandidate;
  candidateHash: string;
  candidateSealDigest: string;
  predecessorCatalogVersion: string;
  userId: string;
}) {
  return canonicalSha256({
    activatedCatalogVersion: input.activatedCatalogVersion,
    allocationId: input.candidate.allocationId,
    authorizedAt: input.authorizedAt,
    authorizedByUserId: input.userId,
    candidateHash: input.candidateHash,
    candidateId: input.candidate.candidateId,
    candidateSealDigest: input.candidateSealDigest,
    eligibilityDecisionVersion: input.candidate.decision.decisionVersion,
    predecessorCatalogVersion: input.predecessorCatalogVersion,
    publicJobId: input.candidate.publicJobId,
    publicJobVersion: input.candidate.publicJobVersion,
    runId: input.candidate.runId,
  });
}
