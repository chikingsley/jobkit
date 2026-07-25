import { commitFinalAllocationDigest } from "../../../repositories/public-projection-final-work/controller";
import type { FinalWorkClaim } from "../../../repositories/public-projection-final-work/types";
import { advanceComponentWork } from "./component-controller";
import type { FinalBoundaryContext } from "./model";
import {
  advanceCanonicalMatchPage,
  advanceCanonicalRequestPage,
} from "./phase-canonical";
import {
  advanceMappingInputPage,
  advanceResolutionInputPage,
} from "./phase-inputs";
import { advancePublicRootPage, advanceRelationWorkPage } from "./phase-roots";
import { COMPONENT_CONTROLLER_DIGEST_DOMAIN, reductionSeed } from "./reduction";

export async function advanceFinalWorkClaim(
  db: D1Database,
  context: FinalBoundaryContext,
  claim: FinalWorkClaim
) {
  switch (claim.phase) {
    case "resolution_inputs":
      await advanceResolutionInputPage(db, context, claim);
      return;
    case "mapping_inputs":
      await advanceMappingInputPage(db, context, claim);
      return;
    case "canonical_requests":
      await advanceCanonicalRequestPage(db, claim);
      return;
    case "canonical_matches":
      await advanceCanonicalMatchPage(db, claim);
      return;
    case "public_roots":
      await advancePublicRootPage(db, claim);
      return;
    case "relations":
      await advanceRelationWorkPage(db, claim);
      return;
    case "components":
      await advanceComponentWork(db, claim);
      return;
    case "allocation_digest": {
      await commitFinalAllocationDigest(db, {
        bytes: claim.componentBytes,
        claim,
        digest:
          claim.componentDigest ??
          (await reductionSeed(COMPONENT_CONTROLLER_DIGEST_DOMAIN)),
      });
      return;
    }
    case "ready":
    case "sealed":
      return;
    default:
      throw new Error(`Unsupported D3 work phase: ${claim.phase}`);
  }
}
