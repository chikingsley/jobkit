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
  finalDuplicateSealExists,
  finalizeRunDuplicateGraph,
  selectListingPage,
} from "./advancement/selection";
import {
  type ItemStageProgress,
  nextActiveRun,
  PROJECTION_ITEM_STAGES,
} from "./advancement/stage-machine";
import { failRun } from "./advancement/stages";
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

async function recoverProjectionRun(
  db: D1Database,
  options: PublicProjectionAdvanceOptions = {}
) {
  const recovery = await recoverOneExpiredItem(db);
  const requeued = recovery.recovered;
  if (recovery.inspected > 0) {
    const result = {
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
    return { kind: "complete" as const, result };
  }
  let run = await nextActiveRun(db, options.locationResolver !== undefined);
  const waiterRecovery = await awakenReadyAnalysisWaiters(db, run?.id ?? null);
  const { awakened } = waiterRecovery;
  if (waiterRecovery.drift) {
    const result = {
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
    return { kind: "complete" as const, result };
  }
  if (!run && awakened > 0) {
    run = await nextActiveRun(db, options.locationResolver !== undefined);
  }
  if (!run) {
    const result = {
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
    return { kind: "complete" as const, result };
  }
  return {
    awakened,
    kind: "run" as const,
    requeued,
    run,
    waiterInspected: waiterRecovery.inspected,
  };
}

export async function advancePublicProjectionRuns(
  db: D1Database,
  options: PublicProjectionAdvanceOptions = {}
) {
  const recovered = await recoverProjectionRun(db, options);
  if (recovered.kind === "complete") {
    return recovered.result;
  }
  const { awakened, requeued, run, waiterInspected } = recovered;

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

  // The item stages run in the order the stage machine declares. Duplicate
  // finalization has its own fixed statement budget, so a call that performed
  // item writes yields here and the resumable D2 pass begins in a clean
  // invocation with only read-only upstream probes ahead of it.
  for (const stage of PROJECTION_ITEM_STAGES) {
    // biome-ignore lint/performance/noAwaitInLoops: Each stage claims bounded work and the loop stops at the first stage that progressed.
    const progress = await stage.execute(db, run.id, timestamp);
    if (progress.processed > 0) {
      await completeTerminalSelectionRun(db, run.id, timestamp);
      return itemStageResult(progress, {
        awakened,
        requeued,
        runId: run.id,
        selection,
      });
    }
  }

  // A waiter inspection may serve a different run than the one selected for
  // advancement. It can share a bounded normal stage, while the fixed-budget
  // D2 finalizer always starts after an invocation with zero waiter work.
  if (waiterInspected > 0) {
    return {
      advanced: 0,
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
      blocked: selection.blocked,
      drift: error.code,
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

  return advanceAfterDuplicatePass(db, {
    awakened,
    blocked: selection.blocked,
    deferFinalDuplicate: options.deferFinalDuplicate ?? false,
    duplicateComparisons,
    identified: 0,
    locationResolver: options.locationResolver,
    requeued,
    runId: run.id,
    selected: selection.selected,
    timestamp,
  });
}

function itemStageResult(
  progress: ItemStageProgress,
  context: {
    awakened: number;
    requeued: number;
    runId: string;
    selection: { blocked: number; selected: number };
  }
) {
  return {
    advanced: progress.advanced,
    awakened: context.awakened,
    blocked: context.selection.blocked + progress.blockedDelta,
    expanded: progress.expanded,
    identified: progress.identified,
    invariantFailed: false,
    prerequisiteReady: progress.prerequisiteReady,
    prerequisiteWaiting: progress.prerequisiteWaiting,
    requeued: context.requeued,
    runId: context.runId,
    selected: context.selection.selected,
  };
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
