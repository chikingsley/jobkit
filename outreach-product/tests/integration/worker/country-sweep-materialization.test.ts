import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type CountrySweepCanonicalChunk,
  type CountrySweepManifestSnapshot,
  canonicalCountrySweepChunkJson,
  createCountrySweepCanonicalChunks,
  INITIAL_COUNTRY_OUTPUT_ROLLING_SHA256,
  sha256Hex,
} from "../../../src/features/countries/materialization";
import type { CountrySweepTaskOutput } from "../../../src/features/countries/schema";
import type { AppEnv } from "../../../worker/env";
import { reapAgentTasks } from "../../../worker/services/agent-task-broker";
import type { CountryTaskLeaseContext } from "../../../worker/services/agent-tasks/country-sweep-leases";
import { cleanupAbandonedCountrySweepOutputObjects } from "../../../worker/services/country-materialization/cleanup";
import {
  materializeOneCountrySweepItem,
  reapExpiredCountryMaterializationItems,
} from "../../../worker/services/country-materialization/materializer";
import { uploadCountrySweepOutputChunk } from "../../../worker/services/country-materialization/output";
import {
  type CountryMaterializationQueueMessage,
  publishCountryMaterializationOutbox,
} from "../../../worker/services/country-materialization/queue";
import { createAuthenticatedUser } from "./auth";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

interface ClaimedCountryTask {
  attemptNumber: number;
  leaseToken: string;
  runId: string;
  taskType: string;
}

const testEnv = env as TestEnv;

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("country sweep output materialization", () => {
  it("publishes zero domain rows at acceptance and materializes idempotently", async () => {
    const setup = await setupClaim("materialization-happy@example.test");
    const output = oneOrganizationOutput();
    const manifest = await uploadOutput(setup.runner.token, setup.task, output);

    await expect(domainOrganizationCount(setup.sweepId)).resolves.toBe(0);
    const completion = await completeManifest(
      setup.runner.token,
      setup.task,
      output,
      manifest
    );
    expect(completion.response.status).toBe(200);
    expect(
      await testEnv.DB.prepare(
        `SELECT output.status,task.status task_status,run.status run_status
           FROM country_sweep_outputs output
           JOIN country_sweep_tasks task ON task.id=output.task_id
           JOIN agent_task_runs run ON run.id=output.agent_run_id
          WHERE output.id=?`
      )
        .bind(completion.outputId)
        .first()
    ).toEqual({
      run_status: "completed",
      status: "accepted",
      task_status: "materializing",
    });
    await expect(domainOrganizationCount(setup.sweepId)).resolves.toBe(0);

    const queueMessages: CountryMaterializationQueueMessage[] = [];
    const queue = {
      send(message: CountryMaterializationQueueMessage) {
        queueMessages.push(message);
        return Promise.resolve();
      },
    } as unknown as Queue<CountryMaterializationQueueMessage>;
    await expect(
      publishCountryMaterializationOutbox({
        COUNTRY_MATERIALIZATION_QUEUE: queue,
        DB: testEnv.DB,
      } as AppEnv)
    ).resolves.toEqual({ published: 1 });
    expect(queueMessages).toEqual([
      {
        aggregateId: completion.outputId,
        kind: "country_sweep_materialization",
        version: 1,
        workItemId: `country-materialization:${completion.outputId}:0:organizations_chunk`,
      },
    ]);
    await expect(
      publishCountryMaterializationOutbox({
        COUNTRY_MATERIALIZATION_QUEUE: queue,
        DB: testEnv.DB,
      } as AppEnv)
    ).resolves.toEqual({ published: 0 });

    const duplicate = await Promise.all([
      materializeOneCountrySweepItem(
        testEnv,
        completion.outputId,
        "duplicate-one"
      ),
      materializeOneCountrySweepItem(
        testEnv,
        completion.outputId,
        "duplicate-two"
      ),
    ]);
    expect(duplicate.map((result) => result.outcome).sort()).toEqual([
      "committed",
      "duplicate_or_idle",
    ]);
    await drainOutput(completion.outputId);

    expect(
      await testEnv.DB.prepare(
        `SELECT output.status,task.status task_status,run.status run_status
           FROM country_sweep_outputs output
           JOIN country_sweep_tasks task ON task.id=output.task_id
           JOIN agent_task_runs run ON run.id=output.agent_run_id
          WHERE output.id=?`
      )
        .bind(completion.outputId)
        .first()
    ).toEqual({
      run_status: "completed",
      status: "materialized",
      task_status: "completed",
    });
    expect(
      await testEnv.DB.prepare(
        `SELECT
          (SELECT COUNT(*) FROM organizations WHERE name='Example School') organizations,
          (SELECT COUNT(*) FROM organization_contact_points
            WHERE value='jobs@example-school.tj') contacts,
          (SELECT COUNT(*) FROM country_sweep_output_organizations
            WHERE output_id=?) organization_provenance,
          (SELECT COUNT(*) FROM country_sweep_output_contacts
            WHERE output_id=?) contact_provenance,
          (SELECT COUNT(*) FROM country_sweep_tasks
            WHERE sweep_id=? AND phase='verification') verification_tasks`
      )
        .bind(completion.outputId, completion.outputId, setup.sweepId)
        .first()
    ).toEqual({
      contact_provenance: 1,
      contacts: 1,
      organization_provenance: 1,
      organizations: 1,
      verification_tasks: 1,
    });
    const itemCounts = await testEnv.DB.prepare(
      `SELECT kind,processed_count,inserted_count,status
           FROM country_sweep_materialization_items WHERE output_id=?
          ORDER BY sequence`
    )
      .bind(completion.outputId)
      .all();
    expect(itemCounts.results.slice(0, 2)).toEqual([
      {
        inserted_count: 1,
        kind: "organizations_chunk",
        processed_count: 1,
        status: "completed",
      },
      {
        inserted_count: 1,
        kind: "contacts_chunk",
        processed_count: 1,
        status: "completed",
      },
    ]);
    await expect(
      materializeOneCountrySweepItem(testEnv, completion.outputId)
    ).resolves.toMatchObject({ outcome: "duplicate_or_idle" });
  });

  it("binds delayed queue work to the exact materialization item", async () => {
    const setup = await setupClaim("materialization-exact-item@example.test");
    const completion = await completeRawOutput(
      setup.runner.token,
      setup.task,
      oneOrganizationOutput()
    );
    const items = await testEnv.DB.prepare(
      `SELECT id,kind FROM country_sweep_materialization_items
        WHERE output_id=? ORDER BY sequence,id`
    )
      .bind(completion.outputId)
      .all<{ id: string; kind: string }>();
    const [organizationItem, contactItem] = items.results;
    if (!(organizationItem && contactItem)) {
      throw new Error("Expected organization and contact work items");
    }

    await expect(
      materializeOneCountrySweepItem(
        testEnv,
        completion.outputId,
        "premature-contact",
        contactItem.id
      )
    ).resolves.toEqual({
      outcome: "duplicate_or_idle",
      outputId: completion.outputId,
    });
    await expect(
      materializeOneCountrySweepItem(
        testEnv,
        completion.outputId,
        "exact-first",
        organizationItem.id
      )
    ).resolves.toMatchObject({
      itemId: organizationItem.id,
      outcome: "committed",
    });
    await expect(
      materializeOneCountrySweepItem(
        testEnv,
        completion.outputId,
        "delayed-duplicate",
        organizationItem.id
      )
    ).resolves.toEqual({
      outcome: "duplicate_or_idle",
      outputId: completion.outputId,
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT attempt_count FROM country_sweep_materialization_items
          WHERE id=?`
      )
        .bind(contactItem.id)
        .first("attempt_count")
    ).resolves.toBe(0);
    await expect(
      materializeOneCountrySweepItem(
        testEnv,
        completion.outputId,
        "exact-second",
        contactItem.id
      )
    ).resolves.toMatchObject({ itemId: contactItem.id, outcome: "committed" });
  });

  it("recovers expired processing leases and terminalizes exhausted work", async () => {
    const retrySetup = await setupClaim("materialization-reap@example.test");
    const retryCompletion = await completeRawOutput(
      retrySetup.runner.token,
      retrySetup.task,
      oneOrganizationOutput()
    );
    const retryItemId = await firstMaterializationItemId(
      retryCompletion.outputId
    );
    await simulateExpiredMaterializationLease(
      retryCompletion.outputId,
      retryItemId,
      1
    );
    await expect(
      reapExpiredCountryMaterializationItems(testEnv.DB)
    ).resolves.toEqual({ reaped: 1, selected: 1 });
    expect(
      await testEnv.DB.prepare(
        `SELECT status,attempt_count,lease_owner,lease_token,lease_expires_at,
                error_code FROM country_sweep_materialization_items WHERE id=?`
      )
        .bind(retryItemId)
        .first()
    ).toEqual({
      attempt_count: 1,
      error_code: "materialization_failed",
      lease_expires_at: null,
      lease_owner: null,
      lease_token: null,
      status: "queued",
    });
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM work_outbox
          WHERE topic='country_sweep_materialization' AND aggregate_id=?
            AND work_item_id=? AND id LIKE '%:expired:%'`
      )
        .bind(retryCompletion.outputId, retryItemId)
        .first("count")
    ).resolves.toBe(1);

    const terminalSetup = await setupClaim(
      "materialization-reap-terminal@example.test"
    );
    const terminalCompletion = await completeRawOutput(
      terminalSetup.runner.token,
      terminalSetup.task,
      oneOrganizationOutput()
    );
    const terminalItemId = await firstMaterializationItemId(
      terminalCompletion.outputId
    );
    await simulateExpiredMaterializationLease(
      terminalCompletion.outputId,
      terminalItemId,
      3
    );
    await expect(
      reapExpiredCountryMaterializationItems(testEnv.DB)
    ).resolves.toEqual({ reaped: 1, selected: 1 });
    expect(
      await testEnv.DB.prepare(
        `SELECT item.status item_status,output.status output_status,
                task.status task_status,run.status run_status
           FROM country_sweep_materialization_items item
           JOIN country_sweep_outputs output ON output.id=item.output_id
           JOIN country_sweep_tasks task ON task.id=output.task_id
           JOIN agent_task_runs run ON run.id=output.agent_run_id
          WHERE item.id=?`
      )
        .bind(terminalItemId)
        .first()
    ).toEqual({
      item_status: "failed",
      output_status: "failed",
      run_status: "completed",
      task_status: "failed",
    });
  });

  it("rejects stale acceptance and abandons its immutable uploaded output", async () => {
    const setup = await setupClaim("materialization-stale@example.test");
    const output = oneOrganizationOutput();
    const manifest = await uploadOutput(setup.runner.token, setup.task, output);
    await expireTaskPair(setup.task);

    const completion = await completeManifest(
      setup.runner.token,
      setup.task,
      output,
      manifest
    );
    expect(completion.response.status).toBe(409);
    await reapAgentTasks(testEnv, setup.userId);
    expect(
      await testEnv.DB.prepare(
        `SELECT output.status,task.status task_status,run.status run_status
           FROM country_sweep_outputs output
           JOIN country_sweep_tasks task ON task.id=output.task_id
           JOIN agent_task_runs run ON run.id=output.agent_run_id
          WHERE output.agent_run_id=?`
      )
        .bind(setup.task.runId)
        .first()
    ).toEqual({
      run_status: "failed",
      status: "abandoned",
      task_status: "queued",
    });
    await expect(domainOrganizationCount(setup.sweepId)).resolves.toBe(0);
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM country_sweep_output_chunks
          WHERE output_id=(SELECT id FROM country_sweep_outputs
            WHERE agent_run_id=?)`
      )
        .bind(setup.task.runId)
        .first("count")
    ).resolves.toBe(2);
  });

  it("cleans old abandoned output prefixes including unmanifested objects", async () => {
    const setup = await setupClaim("materialization-cleanup@example.test");
    const output = oneOrganizationOutput();
    await uploadOutput(setup.runner.token, setup.task, output);
    await expireTaskPair(setup.task);
    await reapAgentTasks(testEnv, setup.userId);
    const outputId = await testEnv.DB.prepare(
      "SELECT id FROM country_sweep_outputs WHERE agent_run_id=?"
    )
      .bind(setup.task.runId)
      .first<string>("id");
    if (!outputId) {
      throw new Error("Abandoned attempt omitted its output");
    }
    const unmanifestedKey = `country-sweeps/${outputId}/orphan-unmanifested.json`;
    await testEnv.SWEEP_OUTPUTS.put(unmanifestedKey, "orphan");
    await markOtherAbandonedOutputsCleaned(outputId);
    const cleanupTime = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

    await expect(
      cleanupAbandonedCountrySweepOutputObjects(testEnv, cleanupTime)
    ).resolves.toMatchObject({ completed: 1, deleted: 3, outputId });
    await expect(
      testEnv.SWEEP_OUTPUTS.list({ prefix: `country-sweeps/${outputId}/` })
    ).resolves.toMatchObject({ objects: [] });
    expect(
      await testEnv.DB.prepare(
        `SELECT status,deleted_object_count FROM country_sweep_output_cleanup
          WHERE output_id=?`
      )
        .bind(outputId)
        .first()
    ).toEqual({ deleted_object_count: 3, status: "completed" });
  });

  it("bounds each abandoned-output cleanup pass to one list and 100 deletes", async () => {
    const setup = await setupClaim(
      "materialization-cleanup-bounded@example.test"
    );
    await uploadOutput(setup.runner.token, setup.task, oneOrganizationOutput());
    await expireTaskPair(setup.task);
    await reapAgentTasks(testEnv, setup.userId);
    const outputId = await testEnv.DB.prepare(
      "SELECT id FROM country_sweep_outputs WHERE agent_run_id=?"
    )
      .bind(setup.task.runId)
      .first<string>("id");
    if (!outputId) {
      throw new Error("Abandoned attempt omitted its output");
    }
    await markOtherAbandonedOutputsCleaned(outputId);
    const cleanupTime = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const listedAt = new Date(cleanupTime.getTime() - 8 * 24 * 60 * 60 * 1000);
    const listCalls: R2ListOptions[] = [];
    const deleteCalls: string[][] = [];
    const fakeBucket = {
      delete(keys: string[]) {
        deleteCalls.push(keys);
        return Promise.resolve();
      },
      list(options: R2ListOptions) {
        listCalls.push(options);
        const prefix = options.prefix ?? "";
        return Promise.resolve({
          cursor: "next-page",
          delimitedPrefixes: [],
          objects: Array.from({ length: 100 }, (_, index) => ({
            key: `${prefix}orphan-${index.toString()}.json`,
            uploaded: listedAt,
          })),
          truncated: true,
        });
      },
    } as unknown as R2Bucket;

    const result = await cleanupAbandonedCountrySweepOutputObjects(
      { DB: testEnv.DB, SWEEP_OUTPUTS: fakeBucket },
      cleanupTime
    );
    expect(result).toEqual({
      completed: 0,
      deleted: 100,
      listed: 100,
      outputId,
    });
    expect(listCalls).toEqual([
      { limit: 100, prefix: `country-sweeps/${result.outputId}/` },
    ]);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toHaveLength(100);
    expect(
      await testEnv.DB.prepare(
        `SELECT status,deleted_object_count FROM country_sweep_output_cleanup
          WHERE output_id=?`
      )
        .bind(result.outputId)
        .first()
    ).toEqual({ deleted_object_count: 100, status: "pending" });
  });

  it("validates chunk bounds, counts, hashes, and ordinals before publication", async () => {
    const setup = await setupClaim("materialization-validation@example.test");
    const [chunk] = createCountrySweepCanonicalChunks(oneOrganizationOutput());
    if (!chunk) {
      throw new Error("Expected an organization chunk");
    }
    const json = canonicalCountrySweepChunkJson(chunk);
    const bytes = new TextEncoder().encode(json);
    const hash = await sha256Hex(bytes);

    expect(
      (
        await runnerRequest(
          `/api/agent-tasks/${setup.task.runId}/chunks`,
          setup.runner.token,
          {
            byteLength: bytes.byteLength,
            chunk,
            leaseToken: setup.task.leaseToken,
            ordinal: 0,
            recordCount: chunk.records.length,
            sha256: "f".repeat(64),
          }
        )
      ).status
    ).toBe(422);
    expect(
      (
        await runnerRequest(
          `/api/agent-tasks/${setup.task.runId}/chunks`,
          setup.runner.token,
          {
            byteLength: bytes.byteLength,
            chunk,
            leaseToken: setup.task.leaseToken,
            ordinal: 1,
            recordCount: chunk.records.length,
            sha256: hash,
          }
        )
      ).status
    ).toBe(409);
    expect(
      (
        await runnerRequest(
          `/api/agent-tasks/${setup.task.runId}/chunks`,
          setup.runner.token,
          {
            byteLength: bytes.byteLength,
            chunk,
            leaseToken: setup.task.leaseToken,
            ordinal: 0,
            recordCount: chunk.records.length + 1,
            sha256: hash,
          }
        )
      ).status
    ).toBe(422);

    const overRecordLimit = {
      kind: "organizations",
      records: Array.from({ length: 1001 }, (_, index) => ({
        ...organization(index),
        identityKey: `domain:validation-${index.toString()}.example.test`,
      })),
      schemaVersion: 1,
    };
    expect(
      (
        await runnerRequest(
          `/api/agent-tasks/${setup.task.runId}/chunks`,
          setup.runner.token,
          {
            byteLength: 1,
            chunk: overRecordLimit,
            leaseToken: setup.task.leaseToken,
            ordinal: 0,
            recordCount: 1001,
            sha256: hash,
          }
        )
      ).status
    ).toBe(400);
    expect(
      (
        await runnerRequest(
          `/api/agent-tasks/${setup.task.runId}/chunks`,
          setup.runner.token,
          {
            leaseToken: setup.task.leaseToken,
            padding: "x".repeat(1_200_000),
          }
        )
      ).status
    ).toBe(413);
    expect(
      (
        await runnerRequest(
          `/api/agent-tasks/${setup.task.runId}/complete`,
          setup.runner.token,
          {
            leaseToken: setup.task.leaseToken,
            output: { padding: "x".repeat(1_200_000) },
          }
        )
      ).status
    ).toBe(413);
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM country_sweep_output_chunks
          WHERE output_id=(SELECT id FROM country_sweep_outputs
            WHERE agent_run_id=?)`
      )
        .bind(setup.task.runId)
        .first("count")
    ).resolves.toBe(0);
    await expect(domainOrganizationCount(setup.sweepId)).resolves.toBe(0);
  });

  it("rejects reversed chunk stages before materialization", async () => {
    const setup = await setupClaim("materialization-stage-order@example.test");
    const chunks = createCountrySweepCanonicalChunks(oneOrganizationOutput());
    const organizationChunk = chunks.find(
      (chunk) => chunk.kind === "organizations"
    );
    const contactChunk = chunks.find((chunk) => chunk.kind === "contacts");
    if (!(organizationChunk && contactChunk)) {
      throw new Error("Expected organization and contact chunks");
    }
    expect(
      (
        await uploadChunkRequest(
          setup.runner.token,
          setup.task,
          contactChunk,
          0
        )
      ).status
    ).toBe(409);
    expect(
      (
        await uploadChunkRequest(
          setup.runner.token,
          setup.task,
          organizationChunk,
          0
        )
      ).status
    ).toBe(200);
    const scopeChunk: CountrySweepCanonicalChunk = {
      kind: "scopes",
      records: [
        {
          city: "Dushanbe",
          query: "schools",
          scopeKey: "search:dushanbe:schools",
          source: "search",
        },
      ],
      schemaVersion: 1,
    };
    expect(
      (await uploadChunkRequest(setup.runner.token, setup.task, scopeChunk, 1))
        .status
    ).toBe(200);
    expect(
      (
        await uploadChunkRequest(
          setup.runner.token,
          setup.task,
          contactChunk,
          2
        )
      ).status
    ).toBe(409);
  });

  it("leaves an orphan R2 object when the lease changes during upload", async () => {
    const setup = await setupClaim("materialization-orphan@example.test");
    const output = oneOrganizationOutput();
    const [chunk] = createCountrySweepCanonicalChunks(output);
    if (!chunk) {
      throw new Error("Expected an organization chunk");
    }
    const bytes = new TextEncoder().encode(
      canonicalCountrySweepChunkJson(chunk)
    );
    const orphanKeys: string[] = [];
    const fakeBucket = {
      async put(key: string) {
        orphanKeys.push(key);
        await expireTaskPair(setup.task);
        return {};
      },
    } as unknown as R2Bucket;
    const context = await countryLeaseContext(setup.task.runId);

    await expect(
      uploadCountrySweepOutputChunk(
        { DB: testEnv.DB, SWEEP_OUTPUTS: fakeBucket } as AppEnv,
        context,
        {
          byteLength: bytes.byteLength,
          chunk,
          ordinal: 0,
          recordCount: chunk.records.length,
          sha256: await sha256Hex(bytes),
        }
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(orphanKeys).toHaveLength(1);
    await expect(
      testEnv.DB.prepare(
        `SELECT COUNT(*) count FROM country_sweep_output_chunks
          WHERE output_id=?`
      )
        .bind(context.outputId)
        .first("count")
    ).resolves.toBe(0);
    await expect(domainOrganizationCount(setup.sweepId)).resolves.toBe(0);
  });

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

async function firstMaterializationItemId(outputId: string) {
  const itemId = await testEnv.DB.prepare(
    `SELECT id FROM country_sweep_materialization_items
      WHERE output_id=? ORDER BY sequence,id LIMIT 1`
  )
    .bind(outputId)
    .first<string>("id");
  if (!itemId) {
    throw new Error(
      `Output ${outputId} omitted its first materialization item`
    );
  }
  return itemId;
}

async function markOtherAbandonedOutputsCleaned(outputId: string) {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT OR IGNORE INTO country_sweep_output_cleanup
        (output_id,status,deleted_object_count,created_at,completed_at,updated_at)
       SELECT id,'completed',0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              strftime('%Y-%m-%dT%H:%M:%fZ','now')
         FROM country_sweep_outputs WHERE status='abandoned' AND id<>?`
    ).bind(outputId),
    testEnv.DB.prepare(
      `UPDATE country_sweep_output_cleanup
          SET status='completed',completed_at=COALESCE(
                completed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')
              ),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE output_id<>? AND status='pending'`
    ).bind(outputId),
  ]);
}

async function simulateExpiredMaterializationLease(
  outputId: string,
  itemId: string,
  attemptCount: number
) {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `UPDATE country_sweep_outputs
          SET status='materializing',updated_at=strftime(
            '%Y-%m-%dT%H:%M:%fZ','now'
          )
        WHERE id=? AND status='accepted'`
    ).bind(outputId),
    testEnv.DB.prepare(
      `UPDATE country_sweep_materialization_items
          SET status='processing',attempt_count=?,lease_owner='crashed-worker',
              lease_token='crashed-lease',
              lease_expires_at='2000-01-01T00:00:00.000Z',
              updated_at='2000-01-01T00:00:00.000Z'
        WHERE id=? AND output_id=? AND status='queued'`
    ).bind(attemptCount, itemId, outputId),
  ]);
}

async function uploadChunkRequest(
  token: string,
  task: ClaimedCountryTask,
  chunk: CountrySweepCanonicalChunk,
  ordinal: number
) {
  const bytes = new TextEncoder().encode(canonicalCountrySweepChunkJson(chunk));
  return runnerRequest(`/api/agent-tasks/${task.runId}/chunks`, token, {
    byteLength: bytes.byteLength,
    chunk,
    leaseToken: task.leaseToken,
    ordinal,
    recordCount: chunk.records.length,
    sha256: await sha256Hex(bytes),
  });
}

async function setupClaim(email: string) {
  const auth = await createAuthenticatedUser(email);
  const sweepResponse = await authenticatedRequest(
    "/api/countries/TJ/sweeps",
    auth.cookie,
    "POST",
    {
      includeDirectories: false,
      includeKnownSources: false,
      includeMaps: false,
      includeSearch: true,
    }
  );
  const sweepPayload = (await sweepResponse.json()) as {
    sweep: { id: string };
  };
  const runner = await createResearchRunner(auth.cookie, email);
  const task = await claimTask(runner.token);
  return {
    runner,
    sweepId: sweepPayload.sweep.id,
    task,
    userId: auth.userId,
  };
}

async function createResearchRunner(cookie: string, runnerName: string) {
  const pairingResponse = await authenticatedRequest(
    "/api/agent-runner-pairings",
    cookie,
    "POST",
    { capabilities: ["research"] }
  );
  const pairing = (await pairingResponse.json()) as {
    pairing: { code: string };
  };
  const response = await publicRequest("/api/agent-runner-pairings/exchange", {
    code: pairing.pairing.code,
    codexVersion: "codex-cli materialization-test",
    runnerName,
  });
  const payload = (await response.json()) as {
    runner: { runnerId: string; token: string };
  };
  return { id: payload.runner.runnerId, token: payload.runner.token };
}

async function claimTask(token: string) {
  const response = await runnerRequest("/api/agent-tasks/claim", token, {
    runnerVersion: "codex-cli materialization-test",
  });
  const payload = (await response.json()) as {
    task: ClaimedCountryTask | null;
  };
  if (!payload.task) {
    throw new Error("Country task was not claimed");
  }
  return payload.task;
}

async function uploadOutput(
  token: string,
  task: ClaimedCountryTask,
  output: CountrySweepTaskOutput
) {
  let manifest: CountrySweepManifestSnapshot = {
    chunkCount: 0,
    contactCount: 0,
    organizationCount: 0,
    rollingSha256: INITIAL_COUNTRY_OUTPUT_ROLLING_SHA256,
    scopeCount: 0,
    totalBytes: 0,
  };
  const chunks = createCountrySweepCanonicalChunks(output);
  for (let ordinal = 0; ordinal < chunks.length; ordinal += 1) {
    const chunk = chunks[ordinal];
    if (!chunk) {
      continue;
    }
    const bytes = new TextEncoder().encode(
      canonicalCountrySweepChunkJson(chunk)
    );
    // biome-ignore lint/performance/noAwaitInLoops: Upload ordinals and manifest hashes are strictly sequential.
    const response = await runnerRequest(
      `/api/agent-tasks/${task.runId}/chunks`,
      token,
      {
        byteLength: bytes.byteLength,
        chunk,
        leaseToken: task.leaseToken,
        ordinal,
        recordCount: chunk.records.length,
        sha256: await sha256Hex(bytes),
      }
    );
    if (!response.ok) {
      throw new Error(`Country chunk upload failed: ${await response.text()}`);
    }
    const payload = (await response.json()) as {
      result: { manifest: CountrySweepManifestSnapshot };
    };
    ({ manifest } = payload.result);
  }
  return manifest;
}

async function completeManifest(
  token: string,
  task: ClaimedCountryTask,
  output: CountrySweepTaskOutput,
  manifest: CountrySweepManifestSnapshot
) {
  return readCompletion(
    await runnerRequest(`/api/agent-tasks/${task.runId}/complete`, token, {
      leaseToken: task.leaseToken,
      output: {
        coverageSummary: output.coverageSummary,
        manifest,
        notes: output.notes,
      },
    }),
    task.runId
  );
}

async function completeRawOutput(
  token: string,
  task: ClaimedCountryTask,
  output: CountrySweepTaskOutput
) {
  return readCompletion(
    await runnerRequest(`/api/agent-tasks/${task.runId}/complete`, token, {
      leaseToken: task.leaseToken,
      output,
    }),
    task.runId
  );
}

async function readCompletion(response: Response, runId: string) {
  if (!response.ok) {
    return { outputId: "", response };
  }
  const payload = (await response.clone().json()) as {
    result: { domainResult: { outputId: string } };
  };
  const {
    result: {
      domainResult: { outputId },
    },
  } = payload;
  if (!outputId) {
    throw new Error(`Completion ${runId} omitted its output ID`);
  }
  return { outputId, response };
}

async function drainOutput(outputId: string) {
  for (let step = 0; step < 20; step += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: Each invocation owns one bounded materialization item.
    await materializeOneCountrySweepItem(
      testEnv,
      outputId,
      `drain:${step.toString()}`
    );
    const status = await testEnv.DB.prepare(
      "SELECT status FROM country_sweep_outputs WHERE id=?"
    )
      .bind(outputId)
      .first<string>("status");
    if (status === "materialized") {
      return;
    }
  }
  throw new Error("Country materialization drain exceeded its item bound");
}

function expireTaskPair(task: ClaimedCountryTask) {
  return testEnv.DB.batch([
    testEnv.DB.prepare(
      `UPDATE country_sweep_tasks
          SET lease_expires_at='2000-01-01T00:00:00.000Z'
        WHERE lease_token=?`
    ).bind(task.leaseToken),
    testEnv.DB.prepare(
      `UPDATE agent_task_runs
          SET lease_expires_at='2000-01-01T00:00:00.000Z'
        WHERE id=?`
    ).bind(task.runId),
  ]);
}

async function countryLeaseContext(runId: string) {
  const row = await testEnv.DB.prepare(
    `SELECT task.attempt_count attemptNumber,task.lease_token leaseToken,
            output.id outputId,run.id runId,run.runner_id runnerId,
            run.source_hash sourceHash,task.sweep_id sweepId,task.id taskId,
            run.task_type taskType,run.user_id userId
       FROM agent_task_runs run
       JOIN country_sweep_tasks task ON task.id=run.source_task_id
       JOIN country_sweep_outputs output ON output.agent_run_id=run.id
      WHERE run.id=?`
  )
    .bind(runId)
    .first<CountryTaskLeaseContext>();
  if (!row) {
    throw new Error(`Country run ${runId} omitted its output lease`);
  }
  return row;
}

function domainOrganizationCount(sweepId: string) {
  return testEnv.DB.prepare(
    "SELECT COUNT(*) count FROM organizations WHERE source_sweep_id=?"
  )
    .bind(sweepId)
    .first<number>("count");
}

function emptyOutput(): CountrySweepTaskOutput {
  return {
    coverageSummary: {
      citiesChecked: [],
      gaps: [],
      needsAnotherPass: false,
      nextScopes: [],
      queriesChecked: [],
      resultCount: 0,
      sourcesChecked: [],
    },
    notes: [],
    organizations: [],
  };
}

function oneOrganizationOutput(): CountrySweepTaskOutput {
  return {
    ...emptyOutput(),
    coverageSummary: {
      ...emptyOutput().coverageSummary,
      resultCount: 1,
    },
    organizations: [
      {
        ...organization(0),
        contactPoints: [
          {
            evidenceUrl: "https://example-school.tj/contact",
            kind: "email",
            label: "Hiring",
            status: "active",
            value: "jobs@example-school.tj",
          },
        ],
        name: "Example School",
      },
    ],
  };
}

function organization(index: number) {
  const suffix = index.toString();
  return {
    canonicalDomain: `school-${suffix}.example.test`,
    city: "Dushanbe",
    contactPoints: [],
    evidenceUrl: `https://school-${suffix}.example.test`,
    lastVerifiedAt: "2026-07-22T00:00:00.000Z",
    marketSegment: "private_school" as const,
    name: `School ${suffix}`,
    outreachEligibility: "eligible" as const,
    region: "Dushanbe",
    status: "active" as const,
    websiteUrl: `https://school-${suffix}.example.test`,
  };
}

function authenticatedRequest(
  path: string,
  cookie: string,
  method = "GET",
  body?: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      cookie,
    },
    method,
  });
}

function runnerRequest(
  path: string,
  token: string,
  body: Record<string, unknown>
) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

function publicRequest(path: string, body: Record<string, unknown>) {
  return exports.default.fetch(`https://outreach.test${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
