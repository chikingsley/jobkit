import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { CountrySweepTaskOutput } from "../../../../src/features/countries/schema";
import { materializeOneCountrySweepItem } from "../../../../worker/services/country-materialization/materializer";
import {
  completeManifest,
  completeRawOutput,
  domainOrganizationCount,
  emptyOutput,
  oneOrganizationOutput,
  setupClaim,
  testEnv,
  uploadOutput,
} from "./support/model";
import { organization } from "./support/organization";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("country sweep output materialization", () => {
  it("resumes 1,001-record keyset fanout and fences racing finalizers", async () => {
    const setup = await setupClaim("materialization-pagination@example.test");
    const output: CountrySweepTaskOutput = {
      ...emptyOutput(),
      coverageSummary: {
        ...emptyOutput().coverageSummary,
        resultCount: 1001,
      },
      organizations: Array.from({ length: 1001 }, (_, index) =>
        organization(index)
      ),
    };
    const manifest = await uploadOutput(setup.runner.token, setup.task, output);
    const completion = await completeManifest(
      setup.runner.token,
      setup.task,
      output,
      manifest
    );
    expect(completion.response.status).toBe(200);

    for (let step = 0; step < 4; step += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: The test advances one bounded queue item per invocation.
      await materializeOneCountrySweepItem(
        testEnv,
        completion.outputId,
        `pagination:${step.toString()}`
      );
    }
    expect(
      await testEnv.DB.prepare(
        `SELECT status,processed_count,inserted_count,cursor_primary
           FROM country_sweep_materialization_items
          WHERE output_id=? AND kind='verification_fanout'`
      )
        .bind(completion.outputId)
        .first()
    ).toMatchObject({
      inserted_count: 1000,
      processed_count: 1000,
      status: "queued",
    });

    await materializeOneCountrySweepItem(
      testEnv,
      completion.outputId,
      "pagination:second-page"
    );
    expect(
      await testEnv.DB.prepare(
        `SELECT status,processed_count,inserted_count
           FROM country_sweep_materialization_items
          WHERE output_id=? AND kind='verification_fanout'`
      )
        .bind(completion.outputId)
        .first()
    ).toEqual({
      inserted_count: 1001,
      processed_count: 1001,
      status: "completed",
    });
    const finalizers = await Promise.all([
      materializeOneCountrySweepItem(
        testEnv,
        completion.outputId,
        "finalizer-one"
      ),
      materializeOneCountrySweepItem(
        testEnv,
        completion.outputId,
        "finalizer-two"
      ),
    ]);
    expect(finalizers.map((result) => result.outcome).sort()).toEqual([
      "committed",
      "duplicate_or_idle",
    ]);
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM country_sweep_tasks
          WHERE sweep_id=? AND phase='verification'`
      )
        .bind(setup.sweepId)
        .first("count")
    ).resolves.toBe(1001);
    await expect(
      testEnv.DB.prepare("SELECT status FROM country_sweep_outputs WHERE id=?")
        .bind(completion.outputId)
        .first("status")
    ).resolves.toBe("materialized");
  }, 20_000);

  it("exhausts a missing-object item without changing the completed agent run", async () => {
    const setup = await setupClaim("materialization-terminal@example.test");
    const completion = await completeRawOutput(
      setup.runner.token,
      setup.task,
      oneOrganizationOutput()
    );
    const objectKey = await testEnv.DB.prepare(
      `SELECT object_key FROM country_sweep_output_chunks
        WHERE output_id=? ORDER BY ordinal LIMIT 1`
    )
      .bind(completion.outputId)
      .first<string>("object_key");
    if (!objectKey) {
      throw new Error("Accepted output omitted its R2 object");
    }
    await testEnv.SWEEP_OUTPUTS.delete(objectKey);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: Each failure consumes one durable materialization attempt.
      await expect(
        materializeOneCountrySweepItem(
          testEnv,
          completion.outputId,
          `terminal:${attempt.toString()}`
        )
      ).rejects.toThrow("Materialization chunk object is unavailable");
    }
    expect(
      await testEnv.DB.prepare(
        `SELECT output.status,task.status task_status,run.status run_status,
                item.status item_status,item.attempt_count
           FROM country_sweep_outputs output
           JOIN country_sweep_tasks task ON task.id=output.task_id
           JOIN agent_task_runs run ON run.id=output.agent_run_id
           JOIN country_sweep_materialization_items item
             ON item.output_id=output.id AND item.kind='organizations_chunk'
          WHERE output.id=?`
      )
        .bind(completion.outputId)
        .first()
    ).toEqual({
      attempt_count: 3,
      item_status: "failed",
      run_status: "completed",
      status: "failed",
      task_status: "failed",
    });
    await expect(domainOrganizationCount(setup.sweepId)).resolves.toBe(0);
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM country_sweep_tasks
          WHERE sweep_id=? AND phase='coverage_audit' AND status='queued'`
      )
        .bind(setup.sweepId)
        .first("count")
    ).resolves.toBe(1);
  });
});
