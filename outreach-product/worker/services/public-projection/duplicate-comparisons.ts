import {
  claimDuplicateWork,
  type DuplicateBatchSnapshot,
  type DuplicateWorkSnapshot,
  initializeDuplicateWork,
  PUBLIC_DUPLICATE_RETRIEVAL_VERSION,
  readDuplicateBatch,
  sealDuplicateBatch,
} from "../../repositories/public-projection-duplicate-comparisons";
import {
  completeResult,
  pendingResult,
} from "./duplicate-comparisons/classification";
import {
  DuplicateComparisonSnapshotError,
  MAX_PHASE_STEPS_PER_INVOCATION,
} from "./duplicate-comparisons/model";
import {
  processExistingPublicPage,
  processMemberPage,
  processSameRunPage,
  readStableBoundary,
} from "./duplicate-comparisons/pages";
import { canonicalSha256, compareUtf8Bytes, sha256Hex } from "./hash";

// biome-ignore lint/performance/noBarrelFile: This behavior-owning module preserves its stable public API after internal decomposition.
export {
  DuplicateComparisonSnapshotError,
  PUBLIC_DUPLICATE_PAGE_SIZE,
} from "./duplicate-comparisons/model";

export async function finalizeStableDuplicateComparisons(
  db: D1Database,
  runId: string,
  timestamp: string
) {
  const existingBatch = await readDuplicateBatch(db, runId);
  if (existingBatch) {
    return completeResult(existingBatch.comparisonCount, 0, true);
  }

  const boundary = await readStableBoundary(db, runId);
  if (!boundary) {
    throw new DuplicateComparisonSnapshotError(
      "The duplicate comparison run is unavailable"
    );
  }
  if (
    boundary.mode !== "shadow" ||
    boundary.status !== "running" ||
    boundary.selection_complete !== 1 ||
    boundary.active_listing_count > 0 ||
    boundary.active_identity_count > 0
  ) {
    return pendingResult(0, 0);
  }

  const [memberDigest, comparisonDigest] = await Promise.all([
    sha256Hex("jobkit-projection-duplicate-member-stream/v1"),
    sha256Hex("jobkit-projection-duplicate-comparison-stream/v1"),
  ]);
  await initializeDuplicateWork(db, {
    comparisonDigest,
    expectedMemberCount: boundary.canonical_count,
    memberDigest,
    runId,
    timestamp,
  });

  let comparisonsCreated = 0;
  for (let step = 0; step < MAX_PHASE_STEPS_PER_INVOCATION; step += 1) {
    const leaseToken = crypto.randomUUID();
    // biome-ignore lint/performance/noAwaitInLoops: Each phase owns one durable cursor transition and must commit before the next phase is claimed.
    const work = await claimDuplicateWork(db, {
      leaseToken,
      runId,
      timestamp,
    });
    if (!work) {
      return pendingResult(0, comparisonsCreated);
    }
    const outcome = await processWorkPhase(db, work, leaseToken, timestamp);
    comparisonsCreated += outcome.comparisonsCreated;
    if (outcome.batch) {
      return completeResult(
        outcome.batch.comparisonCount,
        comparisonsCreated,
        false
      );
    }
    if (!outcome.phaseAdvanced) {
      return pendingResult(outcome.comparisonCount, comparisonsCreated);
    }
  }
  return pendingResult(0, comparisonsCreated);
}

export function shadowDuplicateMemberKey(input: {
  inputHash: string;
  positionItemId: string;
  runId: string;
}) {
  return `shadow:${input.runId}:${input.positionItemId}:${input.inputHash}`;
}

export function publicDuplicateMemberKey(input: {
  publicJobVersion: number;
  redirectRootId: string;
}) {
  return `public:${input.redirectRootId}:${input.publicJobVersion}`;
}

export async function duplicateComparisonId(
  leftMemberKey: string,
  rightMemberKey: string
) {
  const [lower, higher] =
    compareUtf8Bytes(leftMemberKey, rightMemberKey) <= 0
      ? [leftMemberKey, rightMemberKey]
      : [rightMemberKey, leftMemberKey];
  return `pdup_v1_${await sha256Hex(
    `jobkit-projection-duplicate-pair/v1\0${lower}\0${higher}`
  )}`;
}

async function processWorkPhase(
  db: D1Database,
  work: DuplicateWorkSnapshot,
  leaseToken: string,
  timestamp: string
) {
  switch (work.phase) {
    case "members":
      return processMemberPage(db, work, leaseToken, timestamp);
    case "existing_public":
      return processExistingPublicPage(db, work, leaseToken, timestamp);
    case "same_run":
      return processSameRunPage(db, work, leaseToken, timestamp);
    case "ready": {
      const batch: DuplicateBatchSnapshot = {
        comparisonCount: work.comparisonCount,
        comparisonDigest: work.comparisonDigest,
        createdAt: work.createdAt,
        inputHash: await canonicalSha256({
          comparisonCount: work.comparisonCount,
          comparisonDigest: work.comparisonDigest,
          contractVersion: 2,
          memberDigest: work.memberDigest,
          positionMemberCount: work.memberCount,
          retrievalAlgorithmVersion: PUBLIC_DUPLICATE_RETRIEVAL_VERSION,
        }),
        memberDigest: work.memberDigest,
        positionMemberCount: work.memberCount,
        runId: work.runId,
      };
      await sealDuplicateBatch(db, { batch, leaseToken, timestamp });
      return {
        batch,
        comparisonCount: batch.comparisonCount,
        comparisonsCreated: 0,
        phaseAdvanced: true,
      };
    }
    case "sealed": {
      const batch = await readDuplicateBatch(db, work.runId);
      if (!batch) {
        throw new Error("Sealed duplicate work is missing its batch");
      }
      return {
        batch,
        comparisonCount: batch.comparisonCount,
        comparisonsCreated: 0,
        phaseAdvanced: false,
      };
    }
    default:
      throw new Error(`Unsupported duplicate work phase: ${work.phase}`);
  }
}
