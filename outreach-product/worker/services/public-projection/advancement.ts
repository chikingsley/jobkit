import {
  completeTerminalSelectionRun,
  completeTerminalSelectionRunAfterCandidates,
  projectionSnapshotDrift,
} from "./advancement/completion";
import type { PublicProjectionAdvanceOptions } from "./advancement/model";
import {
  awakenReadyAnalysisWaiters,
  recoverOneExpiredItem,
} from "./advancement/recovery";
import {
  advanceSelectedListings,
  finalDuplicateSealExists,
  finalizeRunDuplicateGraph,
  nextActiveRun,
  selectListingPage,
} from "./advancement/selection";
import {
  expandSourcePositions,
  failRun,
  processPositionIdentities,
  processPrerequisiteListings,
} from "./advancement/stages";
import { processNextProjectionCandidate } from "./candidates/store";
import { processProjectionCanonicalResolutionClaim } from "./canonical-resolution";
import {
  DuplicateComparisonSnapshotError,
  finalizeStableDuplicateComparisons,
} from "./duplicate-comparisons";
import type { PermanentLocationResolver } from "./mapbox-location-resolver";
import { claimProjectionPosition } from "./position-items";

async function startProjectionRun(
  db: D1Database,
  run: Awaited<ReturnType<typeof nextActiveRun>>,
  timestamp: string
) {
  if (run?.status === "queued") {
    await db
      .prepare(
        `UPDATE public_projection_runs
            SET status='running',started_at=?,updated_at=?
          WHERE id=? AND status='queued'`
      )
      .bind(timestamp, timestamp, run.id)
      .run();
  }
}

export async function advancePublicProjectionRuns(
  db: D1Database,
  options: PublicProjectionAdvanceOptions = {}
) {
  const recovery = await recoverOneExpiredItem(db);
  const requeued = recovery.recovered;
  if (recovery.inspected > 0) {
    return {
      advanced: 0,
      awakened: 0,
      blocked: 0,
      expanded: 0,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: recovery.runId,
      selected: 0,
    };
  }
  const waiterRecovery = await awakenReadyAnalysisWaiters(db);
  const { awakened } = waiterRecovery;
  if (waiterRecovery.drift) {
    return {
      advanced: 0,
      awakened,
      blocked: 0,
      drift: waiterRecovery.drift.code,
      expanded: 0,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: waiterRecovery.drift.runId,
      selected: 0,
    };
  }
  const run = await nextActiveRun(db, options.locationResolver !== undefined);
  if (!run) {
    return {
      advanced: 0,
      awakened,
      blocked: 0,
      expanded: 0,
      identified: 0,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: null,
      selected: 0,
    };
  }

  const timestamp = new Date().toISOString();
  await startProjectionRun(db, run, timestamp);

  const initialDrift = await projectionSnapshotDrift(db, run);
  if (initialDrift) {
    await failRun(db, run.id, initialDrift, timestamp);
    return {
      advanced: 0,
      awakened,
      blocked: 0,
      drift: initialDrift,
      expanded: 0,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: run.id,
      selected: 0,
    };
  }

  const selection =
    run.selection_complete === 1
      ? { blocked: 0, selected: 0 }
      : await selectListingPage(db, run, timestamp);
  const advancementDrift = await projectionSnapshotDrift(db, run);
  if (advancementDrift) {
    await failRun(db, run.id, advancementDrift, timestamp);
    return {
      advanced: 0,
      awakened,
      blocked: selection.blocked,
      drift: advancementDrift,
      expanded: 0,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  const advanced = await advanceSelectedListings(db, run.id, timestamp);
  if (advanced > 0) {
    await completeTerminalSelectionRun(db, run.id, timestamp);
    return {
      advanced,
      awakened,
      blocked: selection.blocked,
      expanded: 0,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  const prerequisites = await processPrerequisiteListings(
    db,
    run.id,
    timestamp
  );
  if (prerequisites.processed > 0) {
    await completeTerminalSelectionRun(db, run.id, timestamp);
    return {
      advanced: 0,
      awakened,
      blocked: selection.blocked + prerequisites.blocked,
      expanded: 0,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: prerequisites.ready,
      prerequisiteWaiting: prerequisites.waiting,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  const sourcePositions = await expandSourcePositions(db, run.id, timestamp);
  if (sourcePositions.processed > 0) {
    await completeTerminalSelectionRun(db, run.id, timestamp);
    return {
      advanced: 0,
      awakened,
      blocked: selection.blocked + sourcePositions.blocked,
      expanded: sourcePositions.expanded,
      identified: 0,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: sourcePositions.waiting,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  const identities = await processPositionIdentities(db, run.id, timestamp);
  // Duplicate finalization has its own fixed statement budget. A call that
  // performed identity writes yields here so the resumable D2 pass begins in
  // a clean invocation with only read-only upstream probes ahead of it.
  if (identities.processed > 0) {
    await completeTerminalSelectionRun(db, run.id, timestamp);
    return {
      advanced: 0,
      awakened,
      blocked: selection.blocked + identities.blocked,
      expanded: 0,
      identified: identities.identified,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  // A waiter inspection may serve a different run than the one selected for
  // advancement. It can share a bounded normal stage, while the fixed-budget
  // D2 finalizer always starts after an invocation with zero waiter work.
  if (waiterRecovery.inspected > 0) {
    return {
      advanced: 0,
      awakened,
      blocked: selection.blocked + identities.blocked,
      expanded: 0,
      identified: identities.identified,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  let duplicateComparisons: Awaited<
    ReturnType<typeof finalizeStableDuplicateComparisons>
  >;
  try {
    duplicateComparisons = await finalizeStableDuplicateComparisons(
      db,
      run.id,
      timestamp
    );
  } catch (error) {
    if (!(error instanceof DuplicateComparisonSnapshotError)) {
      throw error;
    }
    await failRun(db, run.id, error.code, timestamp);
    return {
      advanced: 0,
      awakened,
      blocked: selection.blocked + identities.blocked,
      drift: error.code,
      expanded: 0,
      identified: identities.identified,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued,
      runId: run.id,
      selected: selection.selected,
    };
  }

  return advanceAfterDuplicatePass(db, {
    awakened,
    blocked: selection.blocked + identities.blocked,
    deferFinalDuplicate: options.deferFinalDuplicate ?? false,
    duplicateComparisons,
    identified: identities.identified,
    locationResolver: options.locationResolver,
    requeued,
    runId: run.id,
    selected: selection.selected,
    timestamp,
  });
}

async function advanceAfterDuplicatePass(
  db: D1Database,
  input: {
    awakened: number;
    blocked: number;
    duplicateComparisons: Awaited<
      ReturnType<typeof finalizeStableDuplicateComparisons>
    >;
    deferFinalDuplicate: boolean;
    identified: number;
    locationResolver: PermanentLocationResolver | undefined;
    requeued: number;
    runId: string;
    selected: number;
    timestamp: string;
  }
) {
  if (
    input.duplicateComparisons.replayed &&
    input.locationResolver !== undefined
  ) {
    const claim = await claimProjectionPosition(
      db,
      input.runId,
      "canonical_resolution",
      input.timestamp,
      { requireUnsealedCanonicalResolution: true }
    );
    if (claim) {
      const resolution = await processProjectionCanonicalResolutionClaim(
        db,
        claim,
        input.timestamp,
        input.locationResolver
      );
      await completeTerminalSelectionRun(db, input.runId, input.timestamp);
      return {
        advanced: 0,
        awakened: input.awakened,
        blocked: input.blocked + resolution.blocked,
        canonicalResolutionState: resolution.state,
        duplicateComparisons: input.duplicateComparisons.comparisonCount,
        duplicateState: input.duplicateComparisons.state,
        expanded: 0,
        identified: input.identified,
        invariantFailed: false,
        prerequisiteReady: 0,
        prerequisiteWaiting: 0,
        requeued: input.requeued,
        resolved: resolution.resolved,
        retried: resolution.retried,
        runId: input.runId,
        sealed: resolution.sealed,
        selected: input.selected,
      };
    }
  }

  if (!input.duplicateComparisons.replayed) {
    return {
      advanced: 0,
      awakened: input.awakened,
      blocked: input.blocked,
      duplicateComparisons: input.duplicateComparisons.comparisonCount,
      duplicateState: input.duplicateComparisons.state,
      expanded: 0,
      identified: input.identified,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued: input.requeued,
      runId: input.runId,
      selected: input.selected,
    };
  }

  if (
    input.deferFinalDuplicate &&
    !(await finalDuplicateSealExists(db, input.runId))
  ) {
    return {
      advanced: 0,
      allocations: 0,
      awakened: input.awakened,
      blocked: input.blocked,
      duplicateComparisons: input.duplicateComparisons.comparisonCount,
      duplicateState: input.duplicateComparisons.state,
      expanded: 0,
      finalDuplicateState: "pending" as const,
      identified: input.identified,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      promotableAllocations: 0,
      requeued: input.requeued,
      runId: input.runId,
      selected: input.selected,
    };
  }

  const finalization = await finalizeRunDuplicateGraph(
    db,
    input.runId,
    input.timestamp
  );
  if (finalization.errorCode) {
    return {
      advanced: 0,
      awakened: input.awakened,
      blocked: input.blocked,
      drift: finalization.errorCode,
      duplicateComparisons: input.duplicateComparisons.comparisonCount,
      duplicateState: input.duplicateComparisons.state,
      expanded: 0,
      identified: input.identified,
      invariantFailed: false,
      prerequisiteReady: 0,
      prerequisiteWaiting: 0,
      requeued: input.requeued,
      runId: input.runId,
      selected: input.selected,
    };
  }
  const { finalGraph } = finalization;
  const candidate =
    finalGraph.state === "complete"
      ? await processNextProjectionCandidate(db, input.runId, input.timestamp)
      : { blocked: 0, prepared: 0, processed: 0, sealed: false };
  if (candidate.sealed) {
    await completeTerminalSelectionRunAfterCandidates(
      db,
      input.runId,
      input.timestamp
    );
  }
  return {
    advanced: 0,
    allocations: finalGraph.allocationCount,
    awakened: input.awakened,
    blocked: input.blocked + finalGraph.blockedAllocationCount,
    candidateBlocked: candidate.blocked ?? 0,
    candidatePrepared: candidate.prepared ?? 0,
    candidateSealed: candidate.sealed,
    duplicateComparisons: input.duplicateComparisons.comparisonCount,
    duplicateState: input.duplicateComparisons.state,
    expanded: 0,
    finalDuplicateState: finalGraph.state,
    identified: input.identified,
    invariantFailed: false,
    prerequisiteReady: 0,
    prerequisiteWaiting: 0,
    promotableAllocations: finalGraph.promotableCount,
    requeued: input.requeued,
    runId: input.runId,
    selected: input.selected,
  };
}
