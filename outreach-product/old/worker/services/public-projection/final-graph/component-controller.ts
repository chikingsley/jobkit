import {
  expandComponentFrontierStatements,
  initializeComponentStatements,
  readComponentWork,
  readFrontierAssignments,
  readNextComponentFrontier,
  readNextUnassignedShadowSeed,
  readSameRelationNeighborPage,
} from "../../../repositories/public-projection-final-work/component-frontier";
import { initializeComponentArtifactStatements } from "../../../repositories/public-projection-final-work/component-relations";
import { commitFinalWorkPage } from "../../../repositories/public-projection-final-work/controller";
import {
  type FinalWorkClaim,
  PUBLIC_FINAL_WORK_PAGE_SIZE,
} from "../../../repositories/public-projection-final-work/types";
import { advanceComponentChildPage } from "./component-pages";
import { uniqueSorted } from "./identity";
import { FinalDuplicateSnapshotError } from "./model";
import {
  appendReductionDigest,
  COMPONENT_CONTROLLER_DIGEST_DOMAIN,
  reductionSeed,
} from "./reduction";

export async function advanceComponentWork(
  db: D1Database,
  claim: FinalWorkClaim
) {
  if (!claim.activeComponentSeed) {
    const seedMemberKey = await readNextUnassignedShadowSeed(db, claim.runId);
    if (!seedMemberKey) {
      await commitFinalWorkPage(db, {
        activeComponentSeed: null,
        bytesAdded: 0,
        claim,
        counter: "component",
        digest:
          claim.componentDigest ??
          (await reductionSeed(COMPONENT_CONTROLLER_DIGEST_DOMAIN)),
        lastRowCursor: claim.counterLastCursor,
        nextCursor: claim.phaseCursor,
        nextOrdinal: claim.phaseOrdinal,
        nextPhase: "allocation_digest",
        rowsAdded: 0,
        statements: [],
        terminalFence: {
          expectedCount: claim.counterCount,
          expectedLastCursor: claim.counterLastCursor,
        },
      });
      return;
    }
    await commitFinalWorkPage(db, {
      activeComponentSeed: seedMemberKey,
      bytesAdded: 0,
      claim,
      counter: "component",
      nextCursor: claim.phaseCursor,
      nextOrdinal: claim.phaseOrdinal,
      nextPhase: "components",
      rowsAdded: 0,
      statements: initializeComponentStatements(db, {
        frozenAt: claim.frozenAt,
        runId: claim.runId,
        seedMemberKey,
      }),
    });
    return;
  }
  const componentWork = await readComponentWork(db, {
    runId: claim.runId,
    seedMemberKey: claim.activeComponentSeed,
  });
  if (!componentWork) {
    throw new FinalDuplicateSnapshotError(
      `The active component ${claim.activeComponentSeed} is missing`
    );
  }
  if (componentWork.state === "expanding") {
    await advanceComponentFrontier(db, claim, componentWork.seedMemberKey);
    return;
  }
  if (componentWork.state === "sealed") {
    if (
      !(
        componentWork.allocationHash &&
        componentWork.allocationId &&
        componentWork.artifactHash
      )
    ) {
      throw new FinalDuplicateSnapshotError(
        `The sealed component ${componentWork.seedMemberKey} lost its scalar artifact`
      );
    }
    const componentDigest = await appendReductionDigest(
      COMPONENT_CONTROLLER_DIGEST_DOMAIN,
      claim.componentDigest,
      [
        {
          allocationHash: componentWork.allocationHash,
          artifactHash: componentWork.artifactHash,
          id: componentWork.allocationId,
          seedMemberKey: componentWork.seedMemberKey,
        },
      ]
    );
    await commitFinalWorkPage(db, {
      activeComponentSeed: null,
      bytesAdded: componentWork.encodedBytes,
      claim,
      counter: "component",
      digest: componentDigest,
      lastRowCursor: componentWork.seedMemberKey,
      nextCursor: componentWork.seedMemberKey,
      nextOrdinal: claim.phaseOrdinal + 1,
      nextPhase: "components",
      rowsAdded: 1,
      statements: [],
    });
    return;
  }
  await advanceComponentChildPage(db, claim, componentWork);
}

async function advanceComponentFrontier(
  db: D1Database,
  claim: FinalWorkClaim,
  seedMemberKey: string
) {
  const frontier = await readNextComponentFrontier(db, {
    runId: claim.runId,
    seedMemberKey,
  });
  if (frontier) {
    const neighbors = await readSameRelationNeighborPage(db, {
      leftCursor: frontier.left_edge_cursor,
      limit: PUBLIC_FINAL_WORK_PAGE_SIZE,
      memberKey: frontier.member_key,
      rightCursor: frontier.right_edge_cursor,
      runId: claim.runId,
    });
    const page = uniqueSorted(neighbors.neighborKeys);
    const assignments = await readFrontierAssignments(db, {
      memberKeys: page,
      runId: claim.runId,
    });
    for (const assignedSeed of assignments.values()) {
      if (assignedSeed !== seedMemberKey) {
        throw new FinalDuplicateSnapshotError(
          "A sealed same edge crossed durable component ownership"
        );
      }
    }
    const newMemberKeys = page.filter((key) => !assignments.has(key));
    await commitFinalWorkPage(db, {
      activeComponentSeed: seedMemberKey,
      bytesAdded: 0,
      claim,
      counter: "component",
      nextCursor: claim.phaseCursor,
      nextOrdinal: claim.phaseOrdinal,
      nextPhase: "components",
      rowsAdded: 0,
      statements: expandComponentFrontierStatements(db, {
        expanded: neighbors.complete,
        frozenAt: claim.frozenAt,
        leftEdgeCursor: neighbors.leftCursor,
        memberKey: frontier.member_key,
        newMemberKeys,
        priorLeftEdgeCursor: frontier.left_edge_cursor,
        priorRightEdgeCursor: frontier.right_edge_cursor,
        rightEdgeCursor: neighbors.rightCursor,
        runId: claim.runId,
        seedMemberKey,
      }),
    });
    return;
  }
  await commitFinalWorkPage(db, {
    activeComponentSeed: seedMemberKey,
    bytesAdded: 0,
    claim,
    counter: "component",
    nextCursor: claim.phaseCursor,
    nextOrdinal: claim.phaseOrdinal,
    nextPhase: "components",
    rowsAdded: 0,
    statements: initializeComponentArtifactStatements(db, {
      frozenAt: claim.frozenAt,
      runId: claim.runId,
      seedMemberKey,
    }),
  });
}
