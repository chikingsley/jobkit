import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type CountrySweepCanonicalChunk,
  canonicalCountrySweepChunkJson,
  createCountrySweepCanonicalChunks,
  sha256Hex,
} from "../../../../src/features/countries/materialization";
import type { AppEnv } from "../../../../worker/env";
import { reapAgentTasks } from "../../../../worker/services/agent-task-broker";
import { cleanupAbandonedCountrySweepOutputObjects } from "../../../../worker/services/country-materialization/cleanup";
import { uploadCountrySweepOutputChunk } from "../../../../worker/services/country-materialization/output";
import {
  countryLeaseContext,
  domainOrganizationCount,
  expireTaskPair,
  markOtherAbandonedOutputsCleaned,
  oneOrganizationOutput,
  setupClaim,
  testEnv,
  uploadChunkRequest,
  uploadOutput,
} from "./support/model";
import { organization, runnerRequest } from "./support/organization";

beforeEach(() => applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS));

describe("country sweep output materialization", () => {
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
});
