import type { AppEnv } from "../../../../worker/env";
import {
  PROJECTION_RUN_STAGES,
  type ProjectionRunStageName,
} from "../../../../worker/services/public-projection/advancement/stage-machine";
import {
  consumePublicProjectionQueue,
  type PublicProjectionQueueMessage,
} from "../../../../worker/services/public-projection/queue";
import { testEnv } from "./support";

export const ADVANCE_MESSAGE: PublicProjectionQueueMessage = {
  kind: "advance_public_projection",
  version: 1,
};

export interface QueueHarness {
  env: AppEnv;
  sent: PublicProjectionQueueMessage[];
}

export function queueHarness(): QueueHarness {
  const sent: PublicProjectionQueueMessage[] = [];
  const env = {
    DB: testEnv.DB,
    MAPBOX_ACCESS_TOKEN: "test-mapbox-token",
    PUBLIC_PROJECTION_QUEUE: {
      send: (body: PublicProjectionQueueMessage) => {
        sent.push(body);
        return Promise.resolve();
      },
    },
  } as unknown as AppEnv;
  return { env, sent };
}

export async function deliver(
  harness: QueueHarness,
  body: PublicProjectionQueueMessage
) {
  const outcome = { acked: 0, retried: 0 };
  const message = {
    ack: () => {
      outcome.acked += 1;
    },
    attempts: 1,
    body,
    id: crypto.randomUUID(),
    retry: () => {
      outcome.retried += 1;
    },
    timestamp: new Date(),
  } as Message<PublicProjectionQueueMessage>;
  const batch = {
    ackAll: () => undefined,
    messages: [message],
    queue: "jobkit-public-projection",
    retryAll: () => undefined,
  } as unknown as MessageBatch<PublicProjectionQueueMessage>;
  await consumePublicProjectionQueue(batch, harness.env);
  return outcome;
}

/**
 * Follows the self-chaining queue from one wake until the chain halts,
 * exactly as production would: every message the consumer enqueues is the
 * next message delivered.
 */
export async function drainQueueChain(harness: QueueHarness, maxSteps = 400) {
  let steps = 0;
  await deliver(harness, ADVANCE_MESSAGE);
  while (harness.sent.length > 0) {
    steps += 1;
    if (steps > maxSteps) {
      throw new Error(`The queue chain exceeded ${maxSteps} steps`);
    }
    const next = harness.sent.shift();
    if (!next) {
      break;
    }
    // biome-ignore lint/performance/noAwaitInLoops: The chain is serial by design; each message owns one consumer invocation.
    await deliver(harness, next);
  }
  return steps;
}

/**
 * Evaluates every stage definition's pending-work predicate for the run,
 * straight from the shared stage machine SQL.
 */
export async function pendingStageNames(runId: string) {
  const names: ProjectionRunStageName[] = [];
  for (const stage of PROJECTION_RUN_STAGES) {
    const binds = stage.pendingWork.binds.map(() => 1);
    // biome-ignore lint/performance/noAwaitInLoops: Each stage predicate is evaluated in declaration order.
    const row = await testEnv.DB.prepare(
      `SELECT CASE WHEN ${stage.pendingWork.sql} THEN 1 ELSE 0 END pending
         FROM public_projection_runs run WHERE run.id=?`
    )
      .bind(...binds, runId)
      .first<{ pending: number }>();
    if (row?.pending === 1) {
      names.push(stage.name);
    }
  }
  return names;
}

/**
 * A durable-state fingerprint for the run: if an invocation changes nothing
 * here while the selector still selects the run, the pipeline is spinning.
 */
export async function runFingerprint(runId: string) {
  const [
    run,
    listings,
    positions,
    work,
    finalWork,
    componentWork,
    componentArtifacts,
    seals,
  ] = await Promise.all([
    testEnv.DB.prepare(
      `SELECT status,selection_cursor,selection_complete,error_code,
                listing_total,listing_completed,listing_blocked,listing_failed,
                listing_superseded,position_total,position_completed,
                position_blocked,position_failed,position_superseded
           FROM public_projection_runs WHERE id=?`
    )
      .bind(runId)
      .first(),
    testEnv.DB.prepare(
      `SELECT id,stage,status,attempt_count,error_code,checkpoint_json
           FROM public_projection_listing_items WHERE run_id=? ORDER BY id`
    )
      .bind(runId)
      .all(),
    testEnv.DB.prepare(
      `SELECT id,stage,status,attempt_count,error_code
           FROM public_projection_position_items WHERE run_id=? ORDER BY id`
    )
      .bind(runId)
      .all(),
    testEnv.DB.prepare(
      "SELECT * FROM public_projection_duplicate_work WHERE run_id=?"
    )
      .bind(runId)
      .first(),
    testEnv.DB.prepare(
      "SELECT * FROM public_projection_final_work WHERE run_id=?"
    )
      .bind(runId)
      .first(),
    testEnv.DB.prepare(
      `SELECT * FROM public_projection_final_component_work
          WHERE run_id=? ORDER BY seed_member_key`
    )
      .bind(runId)
      .all(),
    testEnv.DB.prepare(
      `SELECT
          (SELECT COUNT(*) FROM public_projection_final_component_frontier
            WHERE run_id=?1) frontier,
          (SELECT COUNT(*) FROM public_projection_final_work_component_members
            WHERE run_id=?1) members,
          (SELECT COUNT(*) FROM public_projection_final_work_component_roots
            WHERE run_id=?1) roots,
          (SELECT COUNT(*)
             FROM public_projection_final_work_component_relations
            WHERE run_id=?1) relations,
          (SELECT COUNT(*)
             FROM public_projection_final_component_root_candidates
            WHERE run_id=?1) root_candidates,
          (SELECT COUNT(*) FROM public_projection_final_work_position_updates
            WHERE run_id=?1) position_updates`
    )
      .bind(runId)
      .first(),
    testEnv.DB.prepare(
      `SELECT
          (SELECT COUNT(*) FROM public_projection_duplicate_batches
            WHERE run_id=?1) batches,
          (SELECT COUNT(*) FROM public_projection_resolution_seals
            WHERE run_id=?1) resolutions,
          (SELECT COUNT(*) FROM public_projection_final_duplicate_seals
            WHERE run_id=?1) final_seals,
          (SELECT COUNT(*) FROM public_projection_candidate_results
            WHERE run_id=?1) candidate_results,
          (SELECT COUNT(*) FROM public_projection_candidate_seals
            WHERE run_id=?1) candidate_seals`
    )
      .bind(runId)
      .first(),
  ]);
  return JSON.stringify({
    componentArtifacts,
    componentWork: componentWork.results,
    finalWork,
    listings: listings.results,
    positions: positions.results,
    run,
    seals,
    work,
  });
}

export function readRunRow(runId: string) {
  return testEnv.DB.prepare(
    `SELECT status,error_code,error_detail,selection_complete,
            advance_step_count,completed_at,updated_at
       FROM public_projection_runs WHERE id=?`
  )
    .bind(runId)
    .first<{
      advance_step_count: number;
      completed_at: string | null;
      error_code: string;
      error_detail: string;
      selection_complete: number;
      status: string;
      updated_at: string;
    }>();
}
