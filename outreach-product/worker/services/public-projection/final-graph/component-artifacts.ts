import {
  PUBLIC_DUPLICATE_FINALIZATION_VERSION,
  PUBLIC_JOB_ALLOCATION_VERSION,
  readPublicAllocationCollisions,
  type StoredFinalMember,
} from "../../../repositories/public-projection-final-graph";
import {
  finalizeComponentArtifactStatements,
  initializeComponentRootSummaryStatements,
} from "../../../repositories/public-projection-final-work/component-artifacts";
import type { readComponentWork } from "../../../repositories/public-projection-final-work/component-frontier";
import type { readComponentMemberPage } from "../../../repositories/public-projection-final-work/component-members";
import {
  readComponentLowestShadowSourcePositionId,
  readComponentRootSummary,
} from "../../../repositories/public-projection-final-work/component-relations";
import { commitFinalWorkPage } from "../../../repositories/public-projection-final-work/controller";
import { encodedJsonBytes } from "../../../repositories/public-projection-final-work/shared";
import type { FinalWorkClaim } from "../../../repositories/public-projection-final-work/types";
import { canonicalSha256, sha256Hex } from "../hash";
import { deterministicPublicJobId } from "./identity";
import { FinalDuplicateSnapshotError } from "./model";
import { COMPONENT_ID_DIGEST_DOMAIN } from "./reduction";

export async function initializeComponentRootSummary(
  db: D1Database,
  claim: FinalWorkClaim,
  work: NonNullable<Awaited<ReturnType<typeof readComponentWork>>>
) {
  const [summary, lowestShadowSourcePositionId] = await Promise.all([
    readComponentRootSummary(db, {
      runId: claim.runId,
      seedMemberKey: work.seedMemberKey,
    }),
    readComponentLowestShadowSourcePositionId(db, {
      runId: claim.runId,
      seedMemberKey: work.seedMemberKey,
    }),
  ]);
  if (!lowestShadowSourcePositionId) {
    throw new FinalDuplicateSnapshotError(
      `The component ${work.seedMemberKey} lost its founding shadow`
    );
  }
  const blockedReason = componentBlockedReason(work);
  const winner = blockedReason ? null : summary.winner;
  const foundingSourcePositionId =
    winner?.snapshot.foundingSourcePositionId ?? lowestShadowSourcePositionId;
  const proposedPublicJobId =
    blockedReason || winner
      ? null
      : await deterministicPublicJobId(lowestShadowSourcePositionId);
  const reasonCode = componentReasonCode({
    blockedReason,
    rootCount: summary.count,
    sourceMappedWinner: work.sourceMappedWinner,
    winnerPresent: winner !== null,
  });
  await commitFinalWorkPage(db, {
    activeComponentSeed: work.seedMemberKey,
    bytesAdded: 0,
    claim,
    counter: "component",
    nextCursor: claim.phaseCursor,
    nextOrdinal: claim.phaseOrdinal,
    nextPhase: "components",
    rowsAdded: 0,
    statements: initializeComponentRootSummaryStatements(db, {
      allocationState: blockedReason ? "blocked" : "promotable",
      foundingSourcePositionId,
      frozenAt: claim.frozenAt,
      proposedPublicJobId,
      reasonCode,
      rootExpectedCount: summary.count,
      runId: claim.runId,
      seedMemberKey: work.seedMemberKey,
      winningPublicJobId: winner?.snapshot.redirectRootId ?? null,
    }),
  });
}

function componentBlockedReason(
  work: NonNullable<Awaited<ReturnType<typeof readComponentWork>>>
) {
  if (work.oversized) {
    return "promotion_component_too_large" as const;
  }
  if (work.ambiguous) {
    return "public_identity_ambiguous" as const;
  }
  return null;
}

function componentReasonCode(input: {
  blockedReason:
    | "promotion_component_too_large"
    | "public_identity_ambiguous"
    | null;
  rootCount: number;
  sourceMappedWinner: boolean;
  winnerPresent: boolean;
}) {
  if (input.blockedReason) {
    return input.blockedReason;
  }
  if (!input.winnerPresent) {
    return "new_public_entity" as const;
  }
  return input.rootCount === 1 && input.sourceMappedWinner
    ? ("existing_source_mapping" as const)
    : ("existing_duplicate_winner" as const);
}

export function componentRootReason(
  work: NonNullable<Awaited<ReturnType<typeof readComponentWork>>>,
  selected: boolean
) {
  if (work.allocationState === "blocked") {
    return work.reasonCode ?? "public_identity_ambiguous";
  }
  if (!selected) {
    return "merged_into_existing_winner";
  }
  return work.rootExpectedCount === 1 && work.sourceMappedWinner
    ? "existing_source_mapping"
    : "existing_duplicate_winner";
}

export async function finalizeComponentArtifact(
  db: D1Database,
  claim: FinalWorkClaim,
  work: NonNullable<Awaited<ReturnType<typeof readComponentWork>>>
) {
  if (
    !(
      work.memberDigest &&
      work.relationDigest &&
      work.rootDigest &&
      work.foundingSourcePositionId &&
      work.allocationState &&
      work.reasonCode &&
      work.rootExpectedCount !== null &&
      work.rootCount === work.rootExpectedCount
    )
  ) {
    throw new FinalDuplicateSnapshotError(
      `The component ${work.seedMemberKey} reduction is incomplete`
    );
  }
  const allocationId = `palloc_v1_${await sha256Hex(
    `${COMPONENT_ID_DIGEST_DOMAIN}\0${work.memberDigest}`
  )}`;
  const allocationHash = await canonicalSha256({
    allocationAlgorithmVersion: PUBLIC_JOB_ALLOCATION_VERSION,
    componentMemberDigest: work.memberDigest,
    finalizationAlgorithmVersion: PUBLIC_DUPLICATE_FINALIZATION_VERSION,
    foundingSourcePositionId: work.foundingSourcePositionId,
    proposedPublicJobId: work.proposedPublicJobId,
    relationDigest: work.relationDigest,
    rootDigest: work.rootDigest,
    winningPublicJobId: work.winningPublicJobId,
  });
  let { allocationState, reasonCode } = work;
  if (
    allocationState === "promotable" &&
    reasonCode === "new_public_entity" &&
    work.proposedPublicJobId
  ) {
    const [collision] = await readPublicAllocationCollisions(db, [
      work.proposedPublicJobId,
    ]);
    if (
      collision?.publicJobPresent &&
      !(
        collision.allocationAlgorithmVersion ===
          PUBLIC_JOB_ALLOCATION_VERSION &&
        collision.foundingSourcePositionId === work.foundingSourcePositionId &&
        collision.allocationHash === allocationHash
      )
    ) {
      allocationState = "blocked";
      reasonCode = "public_job_id_collision";
    }
  }
  const artifactHash = await canonicalSha256({
    allocationHash,
    componentId: allocationId,
    foundingSourcePositionId: work.foundingSourcePositionId,
    proposedPublicJobId: work.proposedPublicJobId,
    reasonCode,
    state: allocationState,
    winningPublicJobId: work.winningPublicJobId,
  });
  const scalarArtifact = {
    allocationHash,
    allocationId,
    allocationState,
    artifactHash,
    foundingSourcePositionId: work.foundingSourcePositionId,
    proposedPublicJobId: work.proposedPublicJobId,
    reasonCode,
    winningPublicJobId: work.winningPublicJobId,
  };
  await commitFinalWorkPage(db, {
    activeComponentSeed: work.seedMemberKey,
    bytesAdded: 0,
    claim,
    counter: "component",
    nextCursor: claim.phaseCursor,
    nextOrdinal: claim.phaseOrdinal,
    nextPhase: "components",
    rowsAdded: 0,
    statements: finalizeComponentArtifactStatements(db, {
      ...scalarArtifact,
      encodedBytes: encodedJsonBytes(scalarArtifact),
      frozenAt: claim.frozenAt,
      losingRootCount: work.losingRootCount ?? work.rootCount,
      rootCount: work.rootCount,
      runId: claim.runId,
      seedMemberKey: work.seedMemberKey,
    }),
  });
}

export async function componentMemberFromInput(
  input: Awaited<ReturnType<typeof readComponentMemberPage>>[number]
): Promise<StoredFinalMember> {
  if (input.kind === "shadow") {
    if (
      !(
        input.inputHash &&
        input.memberHash &&
        input.positionItemId &&
        input.sourcePositionId
      )
    ) {
      throw new FinalDuplicateSnapshotError(
        `The shadow component member ${input.memberKey} is incomplete`
      );
    }
    return {
      inputHash: input.inputHash,
      kind: "shadow",
      memberHash: input.memberHash,
      memberKey: input.memberKey,
      positionItemId: input.positionItemId,
      sourcePositionId: input.sourcePositionId,
    };
  }
  if (
    !(
      input.publicJobId &&
      input.publicJobVersion &&
      input.eligibilityDecisionVersion
    )
  ) {
    throw new FinalDuplicateSnapshotError(
      `The public component member ${input.memberKey} is incomplete`
    );
  }
  return {
    eligibilityDecisionVersion: input.eligibilityDecisionVersion,
    kind: "public",
    memberHash: await canonicalSha256({
      eligibilityDecisionVersion: input.eligibilityDecisionVersion,
      kind: "public",
      memberKey: input.memberKey,
      publicJobId: input.publicJobId,
      publicJobVersion: input.publicJobVersion,
    }),
    memberKey: input.memberKey,
    publicJobId: input.publicJobId,
    publicJobVersion: input.publicJobVersion,
  };
}

export function parseCheckpoint(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new FinalDuplicateSnapshotError(
      "A canonical position checkpoint is invalid",
      { cause: error }
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FinalDuplicateSnapshotError(
      "A canonical position checkpoint is not an object"
    );
  }
  return parsed as Record<string, unknown>;
}
