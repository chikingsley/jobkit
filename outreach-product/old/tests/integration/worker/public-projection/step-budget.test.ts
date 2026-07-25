import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { AppEnv } from "../../../../worker/env";
import { PUBLIC_PROJECTION_RUN_STEP_BUDGET } from "../../../../worker/services/public-projection/contracts";
import {
  consumePublicProjectionQueue,
  type PublicProjectionQueueMessage,
} from "../../../../worker/services/public-projection/queue";
import { createAuthenticatedUser } from "../auth";
import { createRun, getRun, seedListings, testEnv } from "./support";

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare(
    `DELETE FROM public_projection_duplicate_work
      WHERE run_id NOT IN (
        SELECT run_id FROM public_projection_duplicate_batches
      )`
  ).run();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `DELETE FROM public_projection_position_items
        WHERE run_id NOT IN (
          SELECT run_id FROM public_projection_duplicate_work
        )`
    ),
    testEnv.DB.prepare(
      `DELETE FROM public_projection_listing_items
        WHERE run_id NOT IN (
          SELECT run_id FROM public_projection_duplicate_work
        )`
    ),
    testEnv.DB.prepare(
      `DELETE FROM public_projection_runs
        WHERE id NOT IN (
          SELECT run_id FROM public_projection_duplicate_work
        )`
    ),
  ]);
});

interface ConsumerHarness {
  env: AppEnv;
  sent: PublicProjectionQueueMessage[];
}

function consumerHarness(): ConsumerHarness {
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

async function deliver(env: AppEnv, body: PublicProjectionQueueMessage) {
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
  await consumePublicProjectionQueue(batch, env);
  return outcome;
}

function setRunStepCount(runId: string, steps: number) {
  return testEnv.DB.prepare(
    "UPDATE public_projection_runs SET advance_step_count=? WHERE id=?"
  )
    .bind(steps, runId)
    .run();
}

function readRunRow(runId: string) {
  return testEnv.DB.prepare(
    `SELECT advance_step_count,completed_at,error_code,status,updated_at
       FROM public_projection_runs WHERE id=?`
  )
    .bind(runId)
    .first<{
      advance_step_count: number;
      completed_at: string | null;
      error_code: string;
      status: string;
      updated_at: string;
    }>();
}

const ADVANCE: PublicProjectionQueueMessage = {
  kind: "advance_public_projection",
  version: 1,
};

describe("public projection run step budget", () => {
  it("terminalizes an exhausted run, stops re-enqueueing, and survives cron wakes", async () => {
    await seedListings(1, "budget-exhausted");
    const operator = await createAuthenticatedUser(
      "projection-budget-exhausted@example.test"
    );
    const created = await createRun(operator.cookie, {
      mode: "shadow",
      scope: { boards: ["budget-exhausted"], listingIds: [] },
    });
    await setRunStepCount(created.run.id, PUBLIC_PROJECTION_RUN_STEP_BUDGET);

    const { env, sent } = consumerHarness();
    const outcome = await deliver(env, ADVANCE);
    expect(outcome).toEqual({ acked: 1, retried: 0 });
    expect(sent).toEqual([]);

    const failedRow = await readRunRow(created.run.id);
    expect(failedRow).toMatchObject({
      advance_step_count: PUBLIC_PROJECTION_RUN_STEP_BUDGET + 1,
      error_code: "advance_budget_exhausted",
      status: "failed",
    });
    expect(failedRow?.completed_at).not.toBeNull();

    const status = await getRun(operator.cookie, created.run.id);
    expect(status.run).toMatchObject({
      budget: {
        stepLimit: PUBLIC_PROJECTION_RUN_STEP_BUDGET,
        steps: PUBLIC_PROJECTION_RUN_STEP_BUDGET + 1,
      },
      error: { code: "advance_budget_exhausted" },
      status: "failed",
    });

    const cronWake = await deliver(env, ADVANCE);
    expect(cronWake).toEqual({ acked: 1, retried: 0 });
    expect(sent).toEqual([]);
    await expect(readRunRow(created.run.id)).resolves.toEqual(failedRow);
  });

  it("stops a final duplicate page chain once the budget is exhausted", async () => {
    await seedListings(1, "budget-final-page");
    const operator = await createAuthenticatedUser(
      "projection-budget-final@example.test"
    );
    const created = await createRun(operator.cookie, {
      mode: "shadow",
      scope: { boards: ["budget-final-page"], listingIds: [] },
    });
    await setRunStepCount(created.run.id, PUBLIC_PROJECTION_RUN_STEP_BUDGET);

    const { env, sent } = consumerHarness();
    const outcome = await deliver(env, {
      kind: "final_duplicate_page",
      runId: created.run.id,
      version: 1,
    });
    expect(outcome).toEqual({ acked: 1, retried: 0 });
    expect(sent).toEqual([]);
    await expect(readRunRow(created.run.id)).resolves.toMatchObject({
      error_code: "advance_budget_exhausted",
      status: "failed",
    });
  });

  it("counts steps without disturbing a normal run", async () => {
    await seedListings(1, "budget-normal");
    const operator = await createAuthenticatedUser(
      "projection-budget-normal@example.test"
    );
    const created = await createRun(operator.cookie, {
      mode: "shadow",
      scope: { boards: ["budget-normal"], listingIds: [] },
    });

    const { env, sent } = consumerHarness();
    const outcome = await deliver(env, ADVANCE);
    expect(outcome).toEqual({ acked: 1, retried: 0 });
    expect(sent).toEqual([ADVANCE]);
    await expect(readRunRow(created.run.id)).resolves.toMatchObject({
      advance_step_count: 1,
      error_code: "",
      status: "running",
    });
    const status = await getRun(operator.cookie, created.run.id);
    expect(status.run).toMatchObject({
      budget: { stepLimit: PUBLIC_PROJECTION_RUN_STEP_BUDGET, steps: 1 },
      status: "running",
    });
  });
});
