import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppEnv } from "../../../../worker/env";
import { reapAgentTasks } from "../../../../worker/services/agent-task-broker";
import {
  materializeOneCountrySweepItem,
  reapExpiredCountryMaterializationItems,
} from "../../../../worker/services/country-materialization/materializer";
import {
  type CountryMaterializationQueueMessage,
  publishCountryMaterializationOutbox,
} from "../../../../worker/services/country-materialization/queue";
import {
  completeManifest,
  completeRawOutput,
  domainOrganizationCount,
  drainOutput,
  expireTaskPair,
  firstMaterializationItemId,
  oneOrganizationOutput,
  setupClaim,
  simulateExpiredMaterializationLease,
  testEnv,
  uploadOutput,
} from "./support/model";

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
});
