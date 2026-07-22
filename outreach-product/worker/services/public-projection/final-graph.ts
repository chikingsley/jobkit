import {
  type FinalDuplicateSeal,
  PUBLIC_DUPLICATE_FINALIZATION_VERSION,
  PUBLIC_JOB_ALLOCATION_VERSION,
  readFinalDuplicateSeal,
  storeFinalDuplicateGraph,
} from "../../repositories/public-projection-final-graph";
import {
  claimFinalWork,
  ensureFinalWork,
  readFinalWork,
} from "../../repositories/public-projection-final-work/controller";
import { readFinalComponentSummary } from "../../repositories/public-projection-final-work/summary";
import type { FinalWorkController } from "../../repositories/public-projection-final-work/types";
import { readValidatedFinalBoundary } from "./final-graph/boundary";
import {
  type FinalBoundaryContext,
  FinalDuplicateSnapshotError,
} from "./final-graph/model";
import { advanceFinalWorkClaim } from "./final-graph/phase-controller";
import { canonicalSha256 } from "./hash";

export {
  deterministicPublicJobId,
  finalDuplicateRelationId,
  finalPublicMemberKey,
  finalShadowMemberKey,
} from "./final-graph/identity";
export { FinalDuplicateSnapshotError } from "./final-graph/model";
export {
  appendFinalPhaseDigest,
  FINAL_PHASE_REDUCTION_DOMAINS,
} from "./final-graph/reduction";
export {
  LIVE_CANONICAL_MATCH_KEYSET_SQL,
  LIVE_CANONICAL_SHADOW_PAGE_SQL,
  readLiveCanonicalPairPage,
  readSameRunCanonicalPairPage,
  SAME_RUN_CANONICAL_LEFT_KEYSET_SQL,
  SAME_RUN_CANONICAL_RIGHT_PAGE_SQL,
} from "./final-graph/relation-pairs";

export async function finalizeCanonicalDuplicateGraph(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  const existingSeal = await readFinalDuplicateSeal(db, runId);
  if (existingSeal) {
    return completeResult(existingSeal, true);
  }
  const context = await readValidatedFinalBoundary(db, runId);
  if (
    context.boundary.resolutionCount < context.boundary.duplicateMemberCount
  ) {
    return pendingResult();
  }
  const inputDigest = await canonicalSha256({
    blockedResolutionCount: context.boundary.blockedResolutionCount,
    duplicateBatchInputHash: context.duplicateBatch.inputHash,
    duplicateMemberCount: context.boundary.duplicateMemberCount,
    finalizationAlgorithmVersion: PUBLIC_DUPLICATE_FINALIZATION_VERSION,
    resolvedPositionCount: context.boundary.resolvedPositionCount,
    runId,
  });
  let work: FinalWorkController;
  try {
    work = await ensureFinalWork(db, {
      frozenAt: timestamp,
      inputDigest,
      runId,
    });
  } catch (error) {
    throw new FinalDuplicateSnapshotError(
      "The durable final duplicate boundary changed",
      { cause: error }
    );
  }
  if (work.status === "failed" || work.status === "superseded") {
    throw new FinalDuplicateSnapshotError(
      `The durable final duplicate work is ${work.status}`
    );
  }
  if (work.phase !== "ready") {
    const claim = await claimFinalWork(db, runId);
    if (claim) {
      await advanceFinalWorkClaim(db, context, claim);
    }
    return pendingResult();
  }
  return finalizeReadyDuplicateGraph(db, context, runId, work.frozenAt);
}

async function finalizeReadyDuplicateGraph(
  db: D1Database,
  context: FinalBoundaryContext,
  runId: string,
  timestamp: string
) {
  const [work, componentSummary] = await Promise.all([
    readFinalWork(db, runId),
    readFinalComponentSummary(db, runId),
  ]);
  if (
    work?.phase !== "ready" ||
    !work.resolutionDigest ||
    !work.canonicalMatchDigest ||
    !work.sourceMappingDigest ||
    !work.relationDigest ||
    !work.componentDigest ||
    !work.allocationDigest ||
    work.componentDigest !== work.allocationDigest ||
    work.resolutionCount !== context.boundary.resolutionCount ||
    work.componentCount !== componentSummary.componentCount
  ) {
    throw new FinalDuplicateSnapshotError(
      "The sealed durable final duplicate streams disagree"
    );
  }
  const seal = await buildFinalDuplicateSealFromWork({
    componentSummary,
    context,
    runId,
    timestamp,
    work,
  });
  try {
    await storeFinalDuplicateGraph(db, { seal });
  } catch (error) {
    throw new FinalDuplicateSnapshotError(
      "The final duplicate inputs changed during atomic storage",
      { cause: error }
    );
  }
  return completeResult(seal, false);
}

async function buildFinalDuplicateSealFromWork(input: {
  componentSummary: {
    blockedCount: number;
    componentCount: number;
    promotableCount: number;
  };
  context: FinalBoundaryContext;
  runId: string;
  timestamp: string;
  work: FinalWorkController;
}): Promise<FinalDuplicateSeal> {
  const {
    allocationDigest,
    canonicalMatchDigest: canonicalLiveInputDigest,
    relationDigest,
    resolutionDigest,
    sourceMappingDigest: sourceMappingInputDigest,
  } = input.work;
  if (
    !(
      resolutionDigest &&
      canonicalLiveInputDigest &&
      sourceMappingInputDigest &&
      relationDigest &&
      allocationDigest
    )
  ) {
    throw new FinalDuplicateSnapshotError(
      "The durable final duplicate digests are incomplete"
    );
  }
  const sealPayload = {
    allocationAlgorithmVersion: PUBLIC_JOB_ALLOCATION_VERSION,
    allocationCount: input.componentSummary.componentCount,
    allocationDigest,
    blockedAllocationCount: input.componentSummary.blockedCount,
    blockedResolutionCount: input.context.boundary.blockedResolutionCount,
    canonicalLiveInputCount: input.work.canonicalMatchCount,
    canonicalLiveInputDigest,
    duplicateBatchInputHash: input.context.duplicateBatch.inputHash,
    finalizationAlgorithmVersion: PUBLIC_DUPLICATE_FINALIZATION_VERSION,
    promotableCount: input.componentSummary.promotableCount,
    relationCount: input.work.relationCount,
    relationDigest,
    resolutionCount: input.context.boundary.resolutionCount,
    resolutionDigest,
    resolvedPositionCount: input.context.boundary.resolvedPositionCount,
    runId: input.runId,
    sourceMappingInputCount: input.work.sourceMappingCount,
    sourceMappingInputDigest,
  };
  return {
    allocationCount: sealPayload.allocationCount,
    allocationDigest,
    blockedAllocationCount: input.componentSummary.blockedCount,
    blockedResolutionCount: input.context.boundary.blockedResolutionCount,
    canonicalLiveInputCount: input.work.canonicalMatchCount,
    canonicalLiveInputDigest,
    createdAt: input.timestamp,
    duplicateBatchInputHash: input.context.duplicateBatch.inputHash,
    promotableCount: input.componentSummary.promotableCount,
    relationCount: input.work.relationCount,
    relationDigest,
    resolutionCount: input.context.boundary.resolutionCount,
    resolutionDigest,
    resolvedPositionCount: input.context.boundary.resolvedPositionCount,
    runId: input.runId,
    sealHash: await canonicalSha256(sealPayload),
    sourceMappingInputCount: input.work.sourceMappingCount,
    sourceMappingInputDigest,
  };
}

function completeResult(seal: FinalDuplicateSeal, replayed: boolean) {
  return {
    allocationCount: seal.allocationCount,
    blockedAllocationCount: seal.blockedAllocationCount,
    promotableCount: seal.promotableCount,
    relationCount: seal.relationCount,
    replayed,
    sealHash: seal.sealHash,
    state: "complete" as const,
  };
}

function pendingResult() {
  return {
    allocationCount: 0,
    blockedAllocationCount: 0,
    promotableCount: 0,
    relationCount: 0,
    replayed: false,
    sealHash: null,
    state: "pending" as const,
  };
}
